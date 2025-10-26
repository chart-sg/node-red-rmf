module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, validateBasicInputs, handleValidationResult } = require('../lib/rmfValidation');

  function StartEventsNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.estimate = config.estimate;
    node.timeout = config.timeout || 300; // Default 5 minutes
    node.parallel_behaviour = config.parallel_behaviour || 'ignore';

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      node.status({ fill: fill, shape: shape, text: text });
    }
    
    // Initialize with waiting status
    setStatus('yellow', 'ring', 'Waiting for RMF config...');
    
    function updateRMFStatus() {
      try {
        if (!rmfContextManager || !rmfContextManager.context) {
          setStatus('red', 'ring', 'RMF context unavailable');
          return;
        }
        
        const socket = rmfContextManager.context.socket;
        if (!socket || !socket.connected) {
          setStatus('red', 'ring', 'RMF connection failed');
          return;
        }
        
        // Also check if we have RMF data (building map, robot data)
        const rmfData = rmfContextManager.getRMFData();
        if (!rmfData || rmfData.robots.length === 0) {
          setStatus('yellow', 'ring', 'RMF connected, loading data...');
          return;
        }
        
        // All good - socket connected and data available
        setStatus('green', 'dot', 'Ready');
      } catch (error) {
        console.error('[START-EVENTS] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[START-EVENTS] RMF config ready, checking connection...');
        rmfConfigReady = true;
        setStatus('yellow', 'ring', 'Connecting to RMF...');
        // Small delay to allow RMF context to fully initialize
        setTimeout(updateRMFStatus, 1000);
      });
    }

    // Listen for RMF context events - but only after config is ready
    function onReady() {
      if (rmfConfigReady) updateRMFStatus();
    }
    function onSocketConnected() {
      if (rmfConfigReady) updateRMFStatus();
    }
    function onSocketDisconnected() {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF disconnected');
    }
    function onCleanedUp() {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF cleaned up');
    }
    function onError(err) {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF error: ' + (err && err.message ? err.message : 'unknown'));
    }
    function onDataUpdated() {
      // Called when RMF data (building map, robots) is updated
      if (rmfConfigReady) {
        updateRMFStatus();
      }
    }

    rmfEvents.on('ready', onReady);
    rmfEvents.on('socket_connected', onSocketConnected);
    rmfEvents.on('socket_disconnected', onSocketDisconnected);
    rmfEvents.on('cleanedUp', onCleanedUp);
    rmfEvents.on('error', onError);
    rmfEvents.on('data_updated', onDataUpdated); // Listen for data updates

    // Don't call updateRMFStatus() immediately - wait for rmf-ready event

    // Clear listeners on close
    node.on('close', async (removed, done) => {
      rmfEvents.off('ready', onReady);
      rmfEvents.off('socket_connected', onSocketConnected);
      rmfEvents.off('socket_disconnected', onSocketDisconnected);
      rmfEvents.off('cleanedUp', onCleanedUp);
      rmfEvents.off('error', onError);
      rmfEvents.off('data_updated', onDataUpdated);
      if (done) done();
    });

    node.on('input', async (msg, send, done) => {
      try {
        // Check RMF connection
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          setStatus('yellow', 'ring', 'Waiting for RMF connection');
          msg.payload = { 
            status: 'waiting', 
            reason: 'RMF socket not connected yet' 
          };
          send([null, msg]); // Send to failed output
          return done();
        }

        // Get configuration values (prefer rmf message properties, then fallback, then node config)
        let robotName = msg.rmf_robot_name || msg.robot_name || node.robot_name;
        let robotFleet = msg.rmf_robot_fleet || msg.robot_fleet || node.robot_fleet;
        let estimate = node.estimate || msg.estimate || '{}';

        // Note: robotName and robotFleet are optional - if both are empty, 
        // will use general dispatch_task_request

        // Validate estimate is valid JSON
        if (typeof estimate === 'string') {
          try {
            estimate = JSON.parse(estimate);
          } catch (error) {
            setStatus('red', 'ring', 'Invalid estimate JSON');
            msg.payload = { 
              status: 'failed', 
              reason: 'Invalid JSON in estimate field: ' + error.message 
            };
            send([null, msg]); // Send to failed output
            return done();
          }
        }

        // Validate robot and fleet using shared utility (only if specific robot/fleet specified)
        const robotValidation = validateRobotAndFleet({
          robotName,
          robotFleet,
          rmfContextManager,
          nodeType: 'START-EVENTS',
          skipIfEmpty: true // start-events allows empty robot/fleet for auto-assignment
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg, [null, msg])) {
          return;
        }

        // Handle parallel behavior if robot name and fleet are specified
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'queue';
        
        if (robotName && robotFleet) {
          const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
          
          // Check if robot has an active RMF task with dynamic events
          // Active means: has task_id, dynamic_event_seq, and status is NOT 'completed'
          const hasActiveTask = robotContext && 
                               robotContext.task_id && 
                               robotContext.dynamic_event_seq && 
                               robotContext.dynamic_event_status && 
                               robotContext.dynamic_event_status !== 'completed';
          
          console.log(`[START-EVENTS] Robot ${robotName} has active task: ${hasActiveTask}, parallel behavior: ${parallelBehaviour}`);
          
          if (hasActiveTask) {
            const currentStatus = robotContext.dynamic_event_status;
            const currentEventId = robotContext.dynamic_event_id;
            
            console.log(`[START-EVENTS] Robot has active task with status: ${currentStatus}, event ID: ${currentEventId}, applying parallel behavior: ${parallelBehaviour}`);
            
            if (parallelBehaviour === 'ignore') {
              // Ignore this new request, let existing task continue
              setStatus('yellow', 'ring', 'Request ignored');
              console.log(`[START-EVENTS] Ignoring new request due to parallel behavior: ignore (robot has active task)`);
              
              msg.payload = { 
                status: 'ignored', 
                reason: `Robot has active RMF task with dynamic events. New request ignored due to parallel behavior: ${parallelBehaviour}`,
                rmf_robot_name: robotName,
                rmf_robot_fleet: robotFleet
              };
              
              send([null, msg]); // Send to failed output
              return done();
              
            } else if (parallelBehaviour === 'continue') {
              // Continue with existing task regardless of robot status
              console.log(`[START-EVENTS] Continuing with existing task context (status: ${currentStatus})`);
              
              setStatus('green', 'dot', 'Task ready');
              msg.payload = {
                status: 'ready',
                rmf_robot_name: robotName,
                rmf_robot_fleet: robotFleet,
                rmf_task_id: robotContext.task_id,
                dynamic_event_seq: robotContext.dynamic_event_seq,
                message: `Continuing with existing task for robot ${robotName} (current status: ${currentStatus})`
              };
              
              // Add RMF metadata for persistence through the flow
              msg.rmf_task_id = robotContext.task_id;
              msg.rmf_robot_name = robotName;
              msg.rmf_robot_fleet = robotFleet;
              msg.rmf_dynamic_event_seq = robotContext.dynamic_event_seq;
              
              send([msg, null]); // Send to success output
              return done();
              
            } else if (parallelBehaviour === 'overwrite') {
              // 3-Step overwrite process:
              // Step 1: Cancel current dynamic event (if active)
              // Step 2: Cancel entire RMF task 
              // Step 3: Create new RMF task
              setStatus('yellow', 'dot', 'Overwriting task');
              console.log(`[START-EVENTS] Overwriting: cancelling current dynamic event and RMF task`);
              
              try {
                // Step 1: Cancel current dynamic event (if underway)
                if (currentEventId && currentStatus === 'underway') {
                  console.log(`[START-EVENTS] Step 1: Cancelling current dynamic event ${currentEventId}`);
                  setStatus('yellow', 'dot', 'Cancelling dynamic event');
                  
                  const eventCancelResult = await rmfContextManager.sendDynamicEventControl('cancel', {
                    robot_name: robotName,
                    robot_fleet: robotFleet,
                    dynamic_event_seq: robotContext.dynamic_event_seq,
                    dynamic_event_id: currentEventId
                  });
                  
                  if (!eventCancelResult.success) {
                    console.warn(`[START-EVENTS] Warning: Failed to cancel dynamic event: ${eventCancelResult.error}`);
                    // Continue anyway - we'll cancel the whole task
                  } else {
                    console.log(`[START-EVENTS] Dynamic event cancelled successfully`);
                  }
                  
                  // Brief delay for dynamic event cancellation
                  await new Promise(resolve => setTimeout(resolve, 100));
                } else if (currentStatus === 'standby') {
                  console.log(`[START-EVENTS] Step 1: Robot in standby, skipping dynamic event cancellation`);
                }
                
                // Step 2: Cancel entire RMF task
                console.log(`[START-EVENTS] Step 2: Cancelling RMF task ${robotContext.task_id}`);
                setStatus('yellow', 'dot', 'Cancelling RMF task');
                
                const taskCancelResult = await rmfContextManager.cancelRMFTask(robotContext.task_id, node.configNode);
                
                if (!taskCancelResult.success) {
                  setStatus('red', 'ring', 'Task cancel failed');
                  msg.payload = { 
                    status: 'failed', 
                    reason: `Failed to cancel RMF task for overwrite: ${taskCancelResult.error || 'Unknown error'}` 
                  };
                  send([null, msg]);
                  return done();
                }
                
                console.log(`[START-EVENTS] RMF task cancelled successfully, proceeding with new task`);
                setStatus('yellow', 'dot', 'Creating new task');
                
                // Step 3: Wait for task cancellation to propagate
                await new Promise(resolve => setTimeout(resolve, 500));
                
              } catch (error) {
                setStatus('red', 'ring', 'Cancel error');
                msg.payload = { 
                  status: 'failed', 
                  reason: `Error during task cancellation for overwrite: ${error.message}` 
                };
                send([null, msg]);
                return done();
              }
              
              // Continue to Step 3 (create new task) - falls through to normal task creation
            }
            // For 'queue' behavior, proceed to create new task (no early return)
            console.log(`[START-EVENTS] Queue behavior: proceeding to create new RMF task despite active task`);
          }
        }

        setStatus('blue', 'dot', 'Creating task');

        // Create new RMF task
        const taskData = {
          estimate: estimate
        };
        
        // Only include robot info if specified
        if (robotName) {
          taskData.robot_name = robotName;
        }
        if (robotFleet) {
          taskData.robot_fleet = robotFleet;
        }

        const createResult = await createRMFTask(taskData);
        if (!createResult.success) {
          setStatus('red', 'ring', 'Task creation failed');
          msg.payload = { 
            status: 'failed', 
            reason: `Task creation failed: ${createResult.error}` 
          };
          send([null, msg]); // Send to failed output
          return done();
        }

        setStatus('yellow', 'dot', 'Waiting for standby');

        // Wait for task to reach standby status
        const standbyResult = await waitForTaskStandby(createResult.taskId, robotName, robotFleet, node.timeout);
        if (!standbyResult.success) {
          setStatus('red', 'ring', 'Standby failed');
          msg.payload = { 
            status: 'failed', 
            reason: `Task standby failed: ${standbyResult.error}` 
          };
          send([null, msg]); // Send to failed output
          return done();
        }

        // Update robot info from task assignment (for dispatch cases)
        if (standbyResult.assignedRobot) {
          if (!robotName) robotName = standbyResult.assignedRobot.name;
          if (!robotFleet) robotFleet = standbyResult.assignedRobot.fleet;
        }

        setStatus('green', 'dot', 'Task ready');

        // Send success output with task information
        msg.payload = {
          status: 'ready',
          rmf_task_id: createResult.taskId,
          dynamic_event_seq: standbyResult.dynamicEventSeq,
          estimate: estimate
        };
        
        // Include robot info if specified
        if (robotName) {
          msg.payload.rmf_robot_name = robotName;
        }
        if (robotFleet) {
          msg.payload.rmf_robot_fleet = robotFleet;
        }
        
        // Add RMF metadata for persistence through the flow
        msg.rmf_task_id = createResult.taskId;
        if (robotName) {
          msg.rmf_robot_name = robotName;
        }
        if (robotFleet) {
          msg.rmf_robot_fleet = robotFleet;
        }
        
        send([msg, null]); // Send to success output
        done();

      } catch (error) {
        setStatus('red', 'ring', 'Task error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send([null, msg]); // Send to failed output
        done(error);
      }
    });

    // Create RMF task via API
    async function createRMFTask(taskData) {
      try {
        return await rmfContextManager.createRMFTask(taskData, node.configNode);
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }

    // Wait for task to reach standby status
    async function waitForTaskStandby(taskId, robotName, fleetName, timeoutSeconds = 300) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          rmfContextManager.unsubscribeFromTaskStatus(taskId);
          reject(new Error(`Task standby timeout after ${timeoutSeconds} seconds`));
        }, timeoutSeconds * 1000); // Convert to milliseconds
        
        const onStatusUpdate = (data) => {
          try {
            console.log(`[START-EVENTS] Task ${taskId} status update:`, data);
            
            if (data.status === 'standby') {
              clearTimeout(timeout);
              rmfContextManager.unsubscribeFromTaskStatus(taskId);
              
              // Extract assigned robot info from task data
              let assignedRobot = null;
              if (data.assigned_to) {
                assignedRobot = {
                  name: data.assigned_to.name,
                  fleet: data.assigned_to.group
                };
              }
              
              // Get robot context to find dynamic_event_seq
              let dynamicEventSeq = null;
              if (assignedRobot || (robotName && fleetName)) {
                const robotForContext = assignedRobot || { name: robotName, fleet: fleetName };
                const robot = rmfContextManager.getRobotContext(robotForContext.name, robotForContext.fleet);
                dynamicEventSeq = robot ? robot.dynamic_event_seq : null;
              }
              
              resolve({
                success: true,
                dynamicEventSeq: dynamicEventSeq,
                assignedRobot: assignedRobot
              });
            } else if (data.status === 'failed' || data.status === 'cancelled') {
              clearTimeout(timeout);
              rmfContextManager.unsubscribeFromTaskStatus(taskId);
              reject(new Error(`Task ${data.status}: ${data.error || 'Unknown error'}`));
            }
          } catch (error) {
            clearTimeout(timeout);
            rmfContextManager.unsubscribeFromTaskStatus(taskId);
            reject(error);
          }
        };
        
        // Subscribe to task status updates
        rmfContextManager.subscribeToTaskStatus(taskId, onStatusUpdate, node.configNode)
          .then(result => {
            if (!result.success) {
              clearTimeout(timeout);
              reject(new Error(result.error));
            }
          })
          .catch(error => {
            clearTimeout(timeout);
            reject(error);
          });
      });
    }
  }

  RED.nodes.registerType('start-events', StartEventsNode);
};