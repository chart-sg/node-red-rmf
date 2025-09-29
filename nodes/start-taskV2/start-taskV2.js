module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, handleValidationResult } = require('../lib/rmfValidation');

  function StartTaskV2Node(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.task_category = config.task_category;
    node.task_detail = config.task_detail;
    node.events = config.events || [];

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[START-TASKV2] Setting node status: ${text}`);
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
        console.error('[START-TASKV2] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[START-TASKV2] RMF config ready, checking connection...');
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
    rmfEvents.on('data_updated', onDataUpdated);

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

        // Get configuration values (prefer message properties, then node config)
        let robotName = msg.rmf_robot_name || msg.robot_name || node.robot_name;
        let robotFleet = msg.rmf_robot_fleet || msg.robot_fleet || node.robot_fleet;
        let taskCategory = msg.task_category || node.task_category || 'User Task';
        let taskDetail = msg.task_detail || node.task_detail || '';
        let events = msg.events || node.events || [];

        // Validate robot and fleet using shared utility
        const robotValidation = validateRobotAndFleet({
          robotName,
          robotFleet,
          rmfContextManager,
          nodeType: 'START-TASKV2',
          skipIfEmpty: !robotName && !robotFleet // Allow empty for dispatch_task_request
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg, [null, msg])) {
          return;
        }

        // Validate events
        if (!events || events.length === 0) {
          setStatus('red', 'ring', 'No events specified');
          msg.payload = { 
            status: 'failed', 
            reason: 'At least one event must be specified' 
          };
          send([null, msg]);
          return done();
        }

        setStatus('blue', 'dot', 'Creating Task V2');

        // Build task request payload
        const taskRequest = buildTaskV2Request(robotName, robotFleet, taskCategory, taskDetail, events);
        
        const createResult = await createTaskV2(taskRequest);
        if (!createResult.success) {
          setStatus('red', 'ring', 'Task creation failed');
          msg.payload = { 
            status: 'failed', 
            reason: `Task creation failed: ${createResult.error}` 
          };
          send([null, msg]);
          return done();
        }

        setStatus('yellow', 'dot', 'Monitoring task');

        // Monitor task until completion
        const monitorResult = await monitorTaskV2(createResult.taskId, robotName, robotFleet);
        
        if (monitorResult.success) {
          setStatus('green', 'dot', 'Task completed');
          msg.payload = {
            status: 'completed',
            rmf_task_id: createResult.taskId,
            rmf_robot_name: robotName,
            rmf_robot_fleet: robotFleet,
            final_status: monitorResult.finalStatus,
            timestamp: new Date().toISOString()
          };
          send([msg, null, null]); // Send to success output
        } else {
          setStatus('red', 'ring', 'Task failed');
          msg.payload = {
            status: 'failed',
            rmf_task_id: createResult.taskId,
            reason: monitorResult.error,
            timestamp: new Date().toISOString()
          };
          send([null, msg, null]); // Send to failed output
        }
        
        done();

      } catch (error) {
        setStatus('red', 'ring', 'Task error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send([null, msg]);
        done(error);
      }
    });

    // Build Task V2 request payload according to the schema
    function buildTaskV2Request(robotName, robotFleet, taskCategory, taskDetail, events) {
      // Build activities from events
      const activities = events.map(event => {
        if (event.category === 'go_to_place') {
          return {
            category: 'go_to_place',
            description: event.description // Should be a place name or place object
          };
        } else if (event.category === 'go_to_zone') {
          const description = {
            zone: event.zone
          };
          
          // Add optional fields according to zone schema
          if (event.types && event.types.length > 0) {
            description.types = event.types;
          }
          if (event.places && event.places.length > 0) {
            description.places = event.places;
          }
          if (event.facing !== undefined) {
            description.facing = event.facing;
          }
          
          return {
            category: 'zone',
            description: description
          };
        } else if (event.category === 'perform_action') {
          return {
            category: 'perform_action',
            description: {
              category: event.action_category || 'custom',
              description: event.action_description || '',
              unix_millis_action_duration_estimate: event.duration_estimate || 30000
            }
          };
        } else {
          // Generic event
          return {
            category: event.category,
            description: event.description || {}
          };
        }
      });

      // Build the compose task structure
      const request = {
        category: 'compose',
        description: {
          category: taskCategory,
          detail: taskDetail,
          phases: [{
            activity: {
              category: 'sequence',
              description: {
                activities: activities
              }
            }
          }]
        }
      };

      // Determine request type based on robot specification
      if (robotName && robotFleet) {
        return {
          type: 'robot_task_request',
          robot: robotName,
          fleet: robotFleet,
          request: request
        };
      } else {
        return {
          type: 'dispatch_task_request',
          request: request
        };
      }
    }

    // Create Task V2 via RMF Web API
    async function createTaskV2(taskRequest) {
      try {
        return await rmfContextManager.createTaskV2(taskRequest, node.configNode);
      } catch (error) {
        return {
          success: false,
          error: error.message
        };
      }
    }

    // Monitor task until completion or failure
    async function monitorTaskV2(taskId, robotName, fleetName) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          rmfContextManager.unsubscribeFromTaskStatus(taskId);
          resolve({
            success: false,
            error: 'Task monitoring timeout'
          });
        }, 300000); // 5 minute timeout
        
        const onStatusUpdate = (data) => {
          try {
            console.log(`[START-TASKV2] Task ${taskId} status update:`, data.status);
            
            // Send status data to status output
            const statusMsg = {
              payload: data, // Send the raw data from rmfTaskManager status handler
              topic: `task/${taskId}/status`,
              timestamp: new Date().toISOString()
            };
            node.send([null, null, statusMsg]);
            
            // Check for terminal states
            if (data.status && ['completed', 'failed', 'canceled', 'cancelled'].includes(data.status.toLowerCase())) {
              console.log(`[START-TASKV2] Task ${taskId} reached terminal state: ${data.status}`);
              clearTimeout(timeout);
              
              // Send final result based on status
              if (data.status.toLowerCase() === 'completed') {
                setStatus('green', 'dot', 'Task completed');
                resolve({
                  success: true,
                  taskId: taskId,
                  status: data.status,
                  result: data
                });
              } else {
                setStatus('yellow', 'ring', `Task ${data.status}`);
                resolve({
                  success: false,
                  taskId: taskId,
                  status: data.status,
                  error: `Task ${data.status}`,
                  result: data
                });
              }
              return;
            }
            
            // Continue monitoring for other statuses (active, queued, etc.)
          } catch (error) {
            clearTimeout(timeout);
            rmfContextManager.unsubscribeFromTaskStatus(taskId);
            resolve({
              success: false,
              error: error.message
            });
          }
        };
        
        // Enhanced options to leverage rmfTaskManager's enhanced status handler
        const options = {
          onGoalFeedback: (feedbackData) => {
            // Send feedback data to status output
            const feedbackMsg = {
              payload: feedbackData,
              topic: `task/${taskId}/feedback`,
              timestamp: new Date().toISOString()
            };
            node.send([null, null, feedbackMsg]);
          },
          onGoalComplete: (goalResponse) => {
            // Send goal completion data to status output
            const completeMsg = {
              payload: goalResponse,
              topic: `task/${taskId}/complete`,
              timestamp: new Date().toISOString()
            };
            node.send([null, null, completeMsg]);
          }
        };
        
        // Subscribe to task status updates with enhanced options
        rmfContextManager.subscribeToTaskStatus(taskId, onStatusUpdate, node.configNode, options)
          .then(result => {
            if (!result.success) {
              clearTimeout(timeout);
              resolve({
                success: false,
                error: result.error
              });
            }
          })
          .catch(error => {
            clearTimeout(timeout);
            resolve({
              success: false,
              error: error.message
            });
          });
      });
    }
  }

  RED.nodes.registerType('start-taskV2', StartTaskV2Node, {
    outputs: 3  // Success, Failed, Status
  });
};
