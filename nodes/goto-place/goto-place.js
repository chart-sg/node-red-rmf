module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  
  function GoToPlaceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.location_level = config.location_level;
    node.location_name = config.location_name;
    node.zone_type = config.zone_type;
    node.estimate = config.estimate;
    node.stubborn_period = config.stubborn_period;
    node.parallel_behaviour = config.parallel_behaviour;
    node.last_event = config.last_event;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);
    

    // Robust RMF socket connection status handling
    let lastSocketConnected = false;
    function updateRMFStatus() {
      try {
        const socket = rmfContextManager.context && rmfContextManager.context.socket;
        if (!socket || !socket.connected) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for RMF connection...' });
          lastSocketConnected = false;
        } else {
          // Show RMF data status if available
          let rmfData = rmfContextManager.getRMFData();
          if (!rmfData || (rmfData.robots.length === 0 && rmfData.locations.length === 0)) {
            node.status({ fill: 'yellow', shape: 'dot', text: 'RMF connected, no data' });
          } else {
            node.status({ fill: 'green', shape: 'dot', text: `${rmfData.robots.length} robots, ${rmfData.locations.length} locations` });
          }
          lastSocketConnected = true;
        }
      } catch (error) {
        node.status({ fill: 'red', shape: 'ring', text: 'RMF context error' });
      }
    }

    // Poll for RMF connection status every 2s
    updateRMFStatus();
    const statusInterval = setInterval(updateRMFStatus, 2000);
    
    // Clear interval on close and implement proper shutdown
    node.on('close', async (removed, done) => {
      console.log('GoToPlace node closing...');
      
      if (statusInterval) {
        clearInterval(statusInterval);
      }
      
      // Implement proper shutdown pattern to prevent nullptr crash
      try {
        console.log('Implementing graceful shutdown pattern...');
        
        // Only trigger cleanup if this is the last node being removed
        if (removed) {
          console.log('Node removed, triggering RMF context cleanup...');
          
          // Use a timeout to ensure cleanup happens but doesn't block Node-RED
          setTimeout(async () => {
            try {
              await rmfContextManager.cleanup();
              console.log('RMF context cleanup completed');
            } catch (error) {
              console.error('Error during RMF cleanup:', error);
            }
          }, 100);
        }
        
        // Call done immediately to not block Node-RED
        if (done) done();
        
      } catch (error) {
        console.error('Error during goto-place node close:', error);
        if (done) done(error);
      }
    });

    node.on('input', async (msg, send, done) => {
      try {
        // Robust: If RMF socket is not connected, set waiting status and return without error
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for RMF connection...' });
          msg.payload = { status: 'waiting', reason: 'RMF socket not connected yet' };
          send(msg);
          return done();
        }

        // Always define flowContext before use
        const flowContext = node.context().flow;

        // Get all configuration values (from node config or message)
        const robotName = node.robot_name || msg.robot_name;
        const robotFleet = node.robot_fleet || msg.robot_fleet;
        const locationName = node.location_name || msg.location_name;
        const zoneType = node.zone_type || msg.zone_type || 'center';
        let estimate = node.estimate || msg.estimate || '{}';
        const stubbornPeriod = node.stubborn_period !== undefined ? node.stubborn_period : 
                               (msg.stubborn_period !== undefined ? msg.stubborn_period : 0);
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'abort';
        const lastEvent = node.last_event !== undefined ? node.last_event : (msg.last_event !== undefined ? msg.last_event : true);

        // Validate estimate is valid JSON
        if (typeof estimate === 'string') {
          try {
            estimate = JSON.parse(estimate);
          } catch (error) {
            node.error('Invalid JSON in estimate field: ' + error.message);
            return done();
          }
        }

        // Step 1: Input Validation
        const validationResult = await validateInputs(robotName, robotFleet, locationName, zoneType, estimate, stubbornPeriod, parallelBehaviour, lastEvent);
        if (!validationResult.valid) {
          node.error(validationResult.error);
          node.status({ fill: 'red', shape: 'ring', text: validationResult.error });
          return done();
        }

        const { validatedRobot, validatedFleet, validatedLocation } = validationResult;

        // Initialize flow rmf_data
        const rmfData = {
          robot_name: validatedRobot ? (validatedRobot.name || validatedRobot.robot_name) : robotName,
          robot_fleet: validatedFleet,
          location_name: validatedLocation.name,
          location_type: validatedLocation.type || 'waypoint',
          is_charger: validatedLocation.is_charger || false,
          zone_type: zoneType,
          estimate: estimate,
          stubborn_period: Number(stubbornPeriod), // Ensure it's a number
          parallel_behaviour: parallelBehaviour,
          last_event: lastEvent,
          task_id: validatedRobot ? (validatedRobot.task_id || '') : '',
          battery_percent: validatedRobot ? (validatedRobot.battery_percent || 0) : 0,
          dynamic_event_seq: validatedRobot ? (validatedRobot.dynamic_event_seq || null) : null
        };

        flowContext.set('rmf_data', rmfData);
        node.status({ fill: 'blue', shape: 'dot', text: 'Processing...' });

        // Step 2: Check if robot already has a task_id
        if (validatedRobot.task_id) {
          node.log(`Robot ${robotName} already has task_id: ${validatedRobot.task_id}`);
          // TODO: Handle existing task scenario
        }
        
        // Step 3: Check if robot has dynamic_event_seq
        if (validatedRobot.dynamic_event_seq) {
          // Robot is currently in a dynamic event session
          const result = await handleExistingDynamicEvent(validatedRobot, parallelBehaviour, rmfData);
          if (!result.proceed) {
            node.status({ fill: 'yellow', shape: 'ring', text: result.message });
            msg.payload = { status: 'cancelled', reason: result.message };
            send(msg);
            return done();
          }
          
          // If we need to create a new task (queue mode), it's already handled
          if (result.shouldCreateNewTask) {
            const taskResult = await createRMFTask(rmfData);
            if (!taskResult.success) {
              node.error(`Failed to create RMF task: ${taskResult.error}`);
              node.status({ fill: 'red', shape: 'ring', text: 'Task creation failed' });
              return done();
            }
            
            // Wait for task to become standby
            const standbyResult = await waitForTaskStandby(taskResult.taskId, rmfData.robot_name, rmfData.robot_fleet);
            if (!standbyResult.success) {
              node.error(`Task failed to reach standby: ${standbyResult.error}`);
              node.status({ fill: 'red', shape: 'ring', text: 'Task standby failed' });
              return done();
            }
            
            // Update rmf_data with task information
            rmfData.task_id = taskResult.taskId;
            rmfData.dynamic_event_seq = standbyResult.dynamicEventSeq;
          }
        } else {
          // Robot doesn't have dynamic event session, create one
          const result = await createRMFTask(rmfData);
          if (!result.success) {
            node.error(`Failed to create RMF task: ${result.error}`);
            node.status({ fill: 'red', shape: 'ring', text: 'Task creation failed' });
            return done();
          }
          
          // Wait for task to become standby
          const standbyResult = await waitForTaskStandby(result.taskId, rmfData.robot_name, rmfData.robot_fleet);
          if (!standbyResult.success) {
            node.error(`Task failed to reach standby: ${standbyResult.error}`);
            node.status({ fill: 'red', shape: 'ring', text: 'Task standby failed' });
            return done();
          }
          
          // Update rmf_data with task information
          rmfData.task_id = result.taskId;
          rmfData.dynamic_event_seq = standbyResult.dynamicEventSeq;
        }
        
        // Update flow context with latest rmf_data
        flowContext.set('rmf_data', rmfData);
        
        // Step 4: Send goal to dynamic event action server with safe callback handling
        console.log('RMF: Sending dynamic event goal with safe callbacks...');
        
        // Set up callbacks for goal completion and feedback
        const goalCallbacks = {
          onGoalComplete: (goalResponse) => {
            console.log('RMF: Goal completed, sending Node-RED output:', goalResponse);
            
            // Update node status based on goal result
            if (goalResponse.success) {
              node.status({ fill: 'green', shape: 'dot', text: `Completed: ${goalResponse.status}` });
            } else {
              node.status({ fill: 'red', shape: 'ring', text: `Failed: ${goalResponse.status}` });
            }
            
            // Prepare comprehensive output payload
            const outputPayload = {
              ...rmfData,
              goal_response: goalResponse,
              status: goalResponse.status,
              success: goalResponse.success,
              task_id: goalResponse.task_id,
              timestamp: goalResponse.timestamp,
              execution_time: goalResponse.execution_time,
              result: goalResponse.result,
              final_state: goalResponse.final_state
            };
            
            // Send output to Node-RED
            msg.payload = outputPayload;
            send(msg);
            
            // Update flow context with final state
            flowContext.set('rmf_data', outputPayload);
            
            console.log('RMF: Node-RED output sent successfully');
            done();
          },
          
          onGoalFeedback: (feedbackData) => {
            console.log('RMF: Goal feedback received:', feedbackData);
            
            // Update node status with progress information
            let statusText = `${feedbackData.status}`;
            if (feedbackData.progress) {
              statusText += ` (${feedbackData.progress}%)`;
            }
            if (feedbackData.current_phase) {
              statusText += ` - ${feedbackData.current_phase}`;
            }
            
            node.status({ fill: 'blue', shape: 'dot', text: statusText });
            
            // Update flow context with feedback
            const currentRmfData = flowContext.get('rmf_data') || rmfData;
            flowContext.set('rmf_data', {
              ...currentRmfData,
              current_feedback: feedbackData,
              last_feedback_time: feedbackData.timestamp
            });
          }
        };
        
        // Send goal with callbacks
        const actionResult = await sendDynamicEventGoal(rmfData);
        
        if (!actionResult.success) {
          node.error(`Failed to send dynamic event goal: ${actionResult.error}`);
          node.status({ fill: 'red', shape: 'ring', text: 'Goal sending failed' });
          return done();
        }
        
        console.log('RMF: Dynamic event goal sent successfully');
        
        // For now, use immediate success response to avoid crashes
        // TODO: Implement proper callback handling once action client is stable
        node.status({ fill: 'green', shape: 'dot', text: 'Goal sent successfully' });
        
        // Prepare output payload
        const outputPayload = {
          ...rmfData,
          goal_result: actionResult,
          status: 'goal_sent',
          success: true,
          timestamp: new Date().toISOString()
        };
        
        msg.payload = outputPayload;
        send(msg);
        
        // Update flow context with final state
        flowContext.set('rmf_data', outputPayload);
        
        done();
        
      } catch (error) {
        node.error('Error processing goto-place request: ' + error.message);
        node.status({ fill: 'red', shape: 'ring', text: 'Error: ' + error.message });
        done(error);
      }
    });
    
    // Validation function
    async function validateInputs(robotName, robotFleet, locationName, zoneType, estimate, stubbornPeriod, parallelBehaviour, lastEvent) {
      try {
        // Get RMF data
        let rmfData = rmfContextManager.getRMFData();
        
        if (!rmfData || (rmfData.robots.length === 0 && rmfData.locations.length === 0)) {
          return { valid: false, error: 'RMF context not available. Ensure RMF Config node is deployed and connected.' };
        }
        
        // Validate required fields
        if (!locationName) {
          return { valid: false, error: 'Location name is required' };
        }
        
        // Validate location exists
        const validatedLocation = rmfData.locations.find(l => l.name === locationName);
        if (!validatedLocation) {
          return { valid: false, error: `Location "${locationName}" not found in RMF data` };
        }
        
        // Validate robot if provided
        let validatedRobot = null;
        let validatedFleet = robotFleet;
        
        if (robotName) {
          // Look for robot by name (and optionally fleet)
          validatedRobot = rmfData.robots.find(r => {
            const nameMatch = r.name === robotName || r.robot_name === robotName;
            if (validatedFleet) {
              const fleetMatch = r.fleet === validatedFleet || r.fleet_name === validatedFleet;
              return nameMatch && fleetMatch;
            }
            return nameMatch;
          });
          
          if (!validatedRobot) {
            return { valid: false, error: `Robot "${robotName}" not found in RMF data` };
          }
          
          // Auto-derive fleet if not provided
          if (!validatedFleet) {
            validatedFleet = validatedRobot.fleet || validatedRobot.fleet_name;
          } else {
            const robotFleetName = validatedRobot.fleet || validatedRobot.fleet_name;
            if (robotFleetName !== validatedFleet) {
              return { valid: false, error: `Robot "${robotName}" does not belong to fleet "${validatedFleet}". Robot belongs to fleet "${robotFleetName}"` };
            }
          }
        }
        
        // Validate stubborn_period
        if (stubbornPeriod === undefined || stubbornPeriod === null || stubbornPeriod === '') {
          return { valid: false, error: 'stubborn_period is required' };
        }
        
        const stubbornPeriodNum = Number(stubbornPeriod);
        if (isNaN(stubbornPeriodNum) || stubbornPeriodNum < 0) {
          return { valid: false, error: `stubborn_period must be a non-negative number, got: ${stubbornPeriod} (type: ${typeof stubbornPeriod})` };
        }
        
        // Validate parallel_behaviour
        const validBehaviours = ['abort', 'overwrite', 'queue'];
        if (!validBehaviours.includes(parallelBehaviour)) {
          return { valid: false, error: `Invalid parallel_behaviour "${parallelBehaviour}". Must be one of: ${validBehaviours.join(', ')}` };
        }
        
        return {
          valid: true,
          validatedRobot,
          validatedFleet,
          validatedLocation
        };
        
      } catch (error) {
        return { valid: false, error: 'Validation error: ' + error.message };
      }
    }
    
    // Handle existing dynamic event
    async function handleExistingDynamicEvent(robot, parallelBehaviour, rmfData) {
      try {
        // Check if there's an active task by looking at the robot's task_id
        if (robot.task_id) {
          // TODO: Get task status from RMF API or context
          // For now, assume task is active if task_id exists
          node.log(`Robot ${robot.name} has active task: ${robot.task_id}`);
          
          switch (parallelBehaviour) {
            case 'abort':
              return { 
                proceed: false, 
                message: `Aborted: Robot ${robot.name} already has active task ${robot.task_id}` 
              };
            
            case 'overwrite':
              // Cancel existing dynamic event
              node.log(`Overwriting existing dynamic event for robot ${robot.name}`);
              
              // TODO: Cancel existing goal if we have a goal handle
              // For now, just proceed with new task
              return { 
                proceed: true, 
                message: `Overwriting existing task for robot ${robot.name}`,
                shouldCreateNewTask: false  // Use existing dynamic event session
              };
            
            case 'queue':
              // Create new task and wait for it to become standby
              node.log(`Queuing new task for robot ${robot.name}`);
              
              const queuedTask = await createRMFTask(rmfData);
              if (!queuedTask.success) {
                return { 
                  proceed: false, 
                  message: `Failed to queue task: ${queuedTask.error}` 
                };
              }                // Wait for queued task to become standby
                try {
                  const standbyResult = await waitForTaskStandby(queuedTask.taskId, rmfData.robot_name, rmfData.robot_fleet);
                  if (!standbyResult.success) {
                    return { 
                      proceed: false, 
                      message: `Queued task failed to reach standby: ${standbyResult.error}` 
                    };
                  }
                  
                  // Update rmfData with new task info
                  rmfData.task_id = queuedTask.taskId;
                  rmfData.dynamic_event_seq = standbyResult.dynamicEventSeq;
                  
                  return { 
                    proceed: true, 
                    message: `Task queued and ready for robot ${robot.name}`,
                    shouldCreateNewTask: false  // Task already created
                  };
                } catch (error) {
                  return { 
                    proceed: false, 
                    message: `Queued task standby failed: ${error.message}` 
                  };
                }
            
            default:
              return { 
                proceed: false, 
                message: `Invalid parallel behaviour: ${parallelBehaviour}` 
              };
          }
        } else {
          // Robot has dynamic_event_seq but no task_id - this shouldn't happen
          node.warn(`Robot ${robot.name} has dynamic_event_seq but no task_id`);
          return { 
            proceed: true, 
            message: `Proceeding with robot ${robot.name} (inconsistent state)`,
            shouldCreateNewTask: true
          };
        }
      } catch (error) {
        return { 
          proceed: false, 
          message: `Error handling existing dynamic event: ${error.message}` 
        };
      }
    }
    
    // Create RMF task via API
    async function createRMFTask(rmfData) {
      try {
        return await rmfContextManager.createRMFTask(rmfData, node.configNode);
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
            console.log(`RMF: Task ${taskId} status update:`, data);
            
            if (data.status === 'standby') {
              clearTimeout(timeout);
              rmfContextManager.unsubscribeFromTaskStatus(taskId);
              
              // Get robot context to find dynamic_event_seq
              const robot = rmfContextManager.getRobotContext(robotName, fleetName);
              
              resolve({
                success: true,
                dynamicEventSeq: robot ? robot.dynamic_event_seq : null
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

    // Send goal to dynamic event action server
    async function sendDynamicEventGoal(rmfData) {
      try {
        return await rmfContextManager.sendDynamicEventGoal(rmfData);
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }

    // (Legacy sendDynamicEventGoalWithCallback removed; only robust sendDynamicEventGoal is used)
  }

  RED.nodes.registerType('goto-place', GoToPlaceNode);
  
  // API endpoint to provide RMF data for dropdown population
  RED.httpAdmin.get('/rmf/data', RED.auth.needsPermission('goto-place.read'), function(req, res) {
    try {
      // Get data directly from rmfContextManager
      let rmfData = rmfContextManager.getRMFData();
      
      // If no data available, try to force refresh
      if (!rmfData || (rmfData.robots.length === 0 && rmfData.locations.length === 0)) {
        // Try to force-refresh the data
        rmfContextManager.forceProcessAllLatest();
        
        // Re-check after forcing refresh
        rmfData = rmfContextManager.getRMFData();
      }
      
      // Check if RMF context is initialized and has data
      if (!rmfData) {
        return res.json({
          robots: [],
          locations: [],
          fleets: [],
          lastUpdated: {},
          status: 'not_initialized',
          message: 'RMF context not initialized'
        });
      }
      
      // Extract unique fleets from robots
      const fleets = [...new Set(rmfData.robots.map(robot => robot.fleet))];
      
      // Prepare response data
      const responseData = {
        robots: rmfData.robots.map(robot => ({
          name: robot.name,
          fleet: robot.fleet,
          battery: robot.battery_percent,
          status: robot.status
        })),
        locations: rmfData.locations.map(location => ({
          name: location.name,
          level: location.level,
          x: location.x,
          y: location.y
        })),
        fleets: fleets,
        lastUpdated: rmfData.lastUpdated,
        status: 'ready',
        message: 'RMF data available'
      };
      
      res.json(responseData);
    } catch (error) {
      console.error('Error fetching RMF data:', error);
      res.status(500).json({ 
        error: 'Failed to fetch RMF data',
        robots: [],
        locations: [],
        fleets: [],
        lastUpdated: {},
        status: 'error',
        message: error.message
      });
    }
  });
};
