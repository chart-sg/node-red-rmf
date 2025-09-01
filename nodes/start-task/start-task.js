module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, handleValidationResult } = require('../lib/rmfValidation');

  function StartTaskNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.estimate = config.estimate;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[START-TASK] Setting node status: ${text}`);
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
        console.error('[START-TASK] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[START-TASK] RMF config ready, checking connection...');
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
          nodeType: 'START-TASK',
          skipIfEmpty: true // start-task allows empty robot/fleet for auto-assignment
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg, [null, msg])) {
          return;
        }

        setStatus('blue', 'dot', 'Creating task');

        // Check if robot already has a task (only for specific robot assignments)
        if (robotName && robotFleet) {
          const latestRobotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
          if (latestRobotContext && latestRobotContext.task_id && latestRobotContext.dynamic_event_seq) {
            console.log(`[START-TASK] Robot ${robotName} already has task_id: ${latestRobotContext.task_id} and dynamic_event_seq: ${latestRobotContext.dynamic_event_seq}`);
            
            // Robot already has a complete task setup - reuse it
            setStatus('green', 'dot', 'Task ready');
            msg.payload = {
              status: 'ready',
              robot_name: robotName,
              robot_fleet: robotFleet,
              task_id: latestRobotContext.task_id,
              dynamic_event_seq: latestRobotContext.dynamic_event_seq,
              message: `Reusing existing task for robot ${robotName}`
            };
            
            // Add RMF metadata for persistence through the flow
            msg.rmf_task_id = latestRobotContext.task_id;
            msg.rmf_robot_name = robotName;
            msg.rmf_robot_fleet = robotFleet;
            
            send([msg, null]); // Send to success output
            return done();
          }
        }

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
        const standbyResult = await waitForTaskStandby(createResult.taskId, robotName, robotFleet);
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
          task_id: createResult.taskId,
          dynamic_event_seq: standbyResult.dynamicEventSeq,
          estimate: estimate
        };
        
        // Include robot info if specified
        if (robotName) {
          msg.payload.robot_name = robotName;
        }
        if (robotFleet) {
          msg.payload.robot_fleet = robotFleet;
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
    async function waitForTaskStandby(taskId, robotName, fleetName) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          rmfContextManager.unsubscribeFromTaskStatus(taskId);
          reject(new Error('Task standby timeout'));
        }, 30000); // 30 second timeout
        
        const onStatusUpdate = (data) => {
          try {
            console.log(`[START-TASK] Task ${taskId} status update:`, data);
            
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

  RED.nodes.registerType('start-task', StartTaskNode, {
    outputs: 2  // Success, Failed
  });
};
