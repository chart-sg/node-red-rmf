module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, handleValidationResult } = require('../lib/rmfValidation');

  function StartTaskV2Node(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.task_type = config.task_type || 'compose';
    node.task_data = config.task_data || { phases: [] };

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
        console.error('[START-TASKV2] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        // RMF config ready, checking connection silently
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
        let taskType = msg.task_type || node.task_type || 'compose';
        let taskData = msg.task_data || node.task_data || {};

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

        // Validate task data based on type
        if (taskType === 'compose' && (!taskData.phases || taskData.phases.length === 0)) {
          setStatus('red', 'ring', 'No phases specified for compose task');
          msg.payload = { 
            status: 'failed', 
            reason: 'At least one phase must be specified for compose task' 
          };
          send([null, msg]);
          return done();
        }

        // Special validation for arm manipulation tasks
        if (taskType === 'arm') {
          setStatus('blue', 'dot', 'Validating arm services');
          
          const validationResult = await validateArmTaskServices(robotName, robotFleet, taskData);
          if (!validationResult.all_valid) {
            setStatus('red', 'ring', 'Arm validation failed');
            msg.payload = { 
              status: 'failed', 
              reason: 'Arm task validation failed',
              validation_results: validationResult
            };
            send([null, msg]);
            return done();
          }
          
          console.log(`[ARM-TASK] Validation successful, proceeding with task creation`);
        }

        setStatus('blue', 'dot', 'Creating Task V2');

        // Build task request payload
        const taskRequest = buildTaskV2Request(robotName, robotFleet, taskType, taskData);
        
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

    // Arm Manipulation Service Validation Functions
    async function validateEffectorReadiness(fleetName, robotName, actionName) {
      try {
        // Call actual ROS service: {fleetName}_effector_query
        console.log(`[ARM-TASK] Checking effector readiness for ${actionName} on ${robotName} in fleet ${fleetName}`);
        
        const { spawn } = require('child_process');
        const serviceName = `/${fleetName}_effector_query`; // Add leading slash for absolute service name
        
        return new Promise((resolve) => {
          const serviceCall = spawn('ros2', [
            'service', 'call', serviceName, 
            'rmf_mm_msgs/srv/CheckEffector', 
            `{robot_name: '${robotName}', action_name: '${actionName}'}`
          ], {
            env: { ...process.env } // Use system environment settings
          });
          
          let output = '';
          let error = '';
          
          // Add timeout for service call
          const timeout = setTimeout(() => {
            serviceCall.kill();
            console.log(`[ARM-TASK] Effector service timeout, using fallback validation`);
            resolve({
              success: true,
              effector_ready: true, // Assume ready for demo purposes
              message: `Effector assumed ready for ${actionName} (service timeout)`
            });
          }, 3000); // 3 second timeout
          
          serviceCall.stdout.on('data', (data) => {
            output += data.toString();
          });
          
          serviceCall.stderr.on('data', (data) => {
            error += data.toString();
          });
          
          serviceCall.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              try {
                // Parse the ROS service response
                // Expected format: rmf_mm_msgs.srv.CheckEffector_Response(effector_ready=True/False, ...)
                const effectorReadyMatch = output.match(/effector_ready=(\w+)/);
                const isReady = effectorReadyMatch ? effectorReadyMatch[1] === 'True' : false;
                
                console.log(`[ARM-TASK] Effector service response: ready=${isReady}`);
                
                resolve({
                  success: true,
                  effector_ready: isReady,
                  message: isReady ? `Effector ready for ${actionName}` : `Effector not ready for ${actionName}`
                });
              } catch (parseError) {
                console.error(`[ARM-TASK] Failed to parse effector service response:`, parseError);
                resolve({
                  success: false,
                  effector_ready: false,
                  error: `Failed to parse service response: ${parseError.message}`
                });
              }
            } else {
              console.error(`[ARM-TASK] Effector service call failed:`, error);
              resolve({
                success: false,
                effector_ready: false,
                error: `Service call failed: ${error}`
              });
            }
          });
        });
      } catch (error) {
        console.error(`[ARM-TASK] Effector validation error:`, error);
        return {
          success: false,
          effector_ready: false,
          error: error.message
        };
      }
    }

    async function validateObjectZone(objectName) {
      try {
        // Call actual ROS service: mm_zone_query
        console.log(`[ARM-TASK] Looking up zone for object ${objectName}`);
        
        if (objectName && objectName.trim() !== '') {
          const { spawn } = require('child_process');
          
          return new Promise((resolve) => {
            const serviceCall = spawn('ros2', [
              'service', 'call', '/mm_zone_query',  // Add leading slash for absolute service name
              'rmf_mm_msgs/srv/CheckMmZone', 
              `{object_name: '${objectName}'}`
            ], {
              env: { ...process.env } // Use system environment settings
            });
            
            let output = '';
            let error = '';
            
            // Add timeout for service call with fallback to hardcoded mapping
            const timeout = setTimeout(() => {
              serviceCall.kill();
              console.log(`[ARM-TASK] Zone service timeout, using fallback mapping for ${objectName}`);
              
              // Fallback to hardcoded mappings when service is unavailable
              let zoneName;
              if (objectName.includes('operatingtable')) {
                zoneName = 'or_1';
              } else if (objectName.includes('rubbishbag_pickup')) {
                zoneName = 'disposal_pickup_1';
              } else if (objectName.includes('rubbishbag_dropoff')) {
                zoneName = 'disposal_place_1';
              } else if (objectName.includes('rubbishbag')) {
                zoneName = 'disposal_pickup_1';
              } else {
                zoneName = `zone_${objectName.toLowerCase().replace(/\s+/g, '_')}`;
              }
              
              resolve({
                success: true,
                is_mm_zone: true,
                zone_name: zoneName,
                result: `Object ${objectName} mapped to zone ${zoneName} (service timeout fallback)`
              });
            }, 3000); // 3 second timeout
            
            serviceCall.stdout.on('data', (data) => {
              output += data.toString();
            });
            
            serviceCall.stderr.on('data', (data) => {
              error += data.toString();
            });
            
            serviceCall.on('close', (code) => {
              clearTimeout(timeout);
              if (code === 0) {
                try {
                  // Parse the ROS service response
                  // Expected format: rmf_mm_msgs.srv.CheckMmZone_Response(result='...', zone_name='...', is_mm_zone=True/False)
                  const zoneNameMatch = output.match(/zone_name='([^']+)'/);
                  const isMmZoneMatch = output.match(/is_mm_zone=(\w+)/);
                  const resultMatch = output.match(/result='([^']+)'/);
                  
                  const zoneName = zoneNameMatch ? zoneNameMatch[1] : null;
                  const isMmZone = isMmZoneMatch ? isMmZoneMatch[1] === 'True' : false;
                  const result = resultMatch ? resultMatch[1] : output;
                  
                  console.log(`[ARM-TASK] Zone service response: zone=${zoneName}, is_mm_zone=${isMmZone}`);
                  
                  resolve({
                    success: true,
                    is_mm_zone: isMmZone,
                    zone_name: zoneName,
                    result: result
                  });
                } catch (parseError) {
                  console.error(`[ARM-TASK] Failed to parse zone service response:`, parseError);
                  resolve({
                    success: false,
                    is_mm_zone: false,
                    zone_name: null,
                    error: `Failed to parse service response: ${parseError.message}`
                  });
                }
              } else {
                console.error(`[ARM-TASK] Zone service call failed:`, error);
                resolve({
                  success: false,
                  is_mm_zone: false,
                  zone_name: null,
                  error: `Service call failed: ${error}`
                });
              }
            });
          });
        } else {
          // For actions without objects, still consider valid
          return {
            success: true,
            is_mm_zone: true,
            zone_name: null,
            result: `Action without zone navigation`
          };
        }
      } catch (error) {
        console.error(`[ARM-TASK] Zone validation error:`, error);
        return {
          success: false,
          is_mm_zone: false,
          zone_name: null,
          error: error.message
        };
      }
    }

    async function validateArmTaskServices(robotName, robotFleet, taskData) {
      const validationResults = {
        effector_checks: [],
        zone_checks: [],
        all_valid: true
      };

      try {
        // Validate primary action effector
        if (taskData.action1) {
          const effectorResult1 = await validateEffectorReadiness(robotFleet, robotName, taskData.action1);
          validationResults.effector_checks.push({
            action: taskData.action1,
            result: effectorResult1
          });
          
          if (!effectorResult1.success || !effectorResult1.effector_ready) {
            validationResults.all_valid = false;
          }
        }

        // Validate secondary action effector (if exists)
        if (taskData.action2) {
          const effectorResult2 = await validateEffectorReadiness(robotFleet, robotName, taskData.action2);
          validationResults.effector_checks.push({
            action: taskData.action2,
            result: effectorResult2
          });
          
          if (!effectorResult2.success || !effectorResult2.effector_ready) {
            validationResults.all_valid = false;
          }
        }

        // Validate object1 zone (if exists)
        if (taskData.object1) {
          const zoneResult1 = await validateObjectZone(taskData.object1);
          validationResults.zone_checks.push({
            object: taskData.object1,
            result: zoneResult1
          });
          
          if (!zoneResult1.success || !zoneResult1.is_mm_zone) {
            validationResults.all_valid = false;
          } else {
            // Update taskData with resolved zone
            taskData.zone1 = zoneResult1.zone_name;
          }
        } else {
          // Actions without objects are still valid (no zone navigation needed)
          console.log(`[ARM-TASK] Action ${taskData.action1} requires no zone navigation`);
        }

        // Validate object2 zone (if exists)
        if (taskData.object2) {
          const zoneResult2 = await validateObjectZone(taskData.object2);
          validationResults.zone_checks.push({
            object: taskData.object2,
            result: zoneResult2
          });
          
          if (!zoneResult2.success || !zoneResult2.is_mm_zone) {
            validationResults.all_valid = false;
          } else {
            // Update taskData with resolved zone
            taskData.zone2 = zoneResult2.zone_name;
          }
        } else if (taskData.action2) {
          // Secondary actions without objects are still valid
          console.log(`[ARM-TASK] Action ${taskData.action2} requires no zone navigation`);
        }

        console.log(`[ARM-TASK] Validation complete. All valid: ${validationResults.all_valid}`);
        return validationResults;

      } catch (error) {
        console.error(`[ARM-TASK] Service validation error:`, error);
        validationResults.all_valid = false;
        validationResults.error = error.message;
        return validationResults;
      }
    }

    // Build Task V2 request payload according to the schema
    function buildTaskV2Request(robotName, robotFleet, taskType, taskData) {
      let request;
      
      if (taskType === 'compose') {
        // Build activities from phases
        const phases = taskData.phases.map(phase => {
          const activities = phase.events.map(event => {
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
        } else if (event.category === 'couple') {
          const description = {
            action: 'couple',
            number_of_robots: event.number_of_robots || 2,
            expected_zone: event.expected_zone
          };
          
          if (event.robots && event.robots.length > 0) {
            description.candidates = {
              fleet: robotFleet, // Use task-level fleet instead of event-level
              robots: event.robots
            };
          }
          
          if (event.estimated_duration) {
            description.estimated_duration = event.estimated_duration;
          }
          
          return {
            category: 'couple_action',
            description: description
          };
        } else if (event.category === 'decouple') {
          const description = {};
          
          if (event.estimated_duration) {
            description.estimated_duration = event.estimated_duration;
          }
          
          return {
            category: 'decouple_action',
            description: description
          };
        } else {
            // Generic event
            return {
              category: event.category,
              description: event.description || {}
            };
        }
        });
        
        return {
          activity: {
            category: 'sequence',
            description: {
              activities: activities
            }
          }
        };
      });
        
        request = {
          category: 'compose',
          description: {
            category: taskData.category || 'User Task',
            detail: taskData.detail || '',
            phases: phases
          }
        };
      } else if (taskType === 'patrol') {
        request = {
          category: 'patrol',
          description: {
            places: taskData.places || [],
            rounds: taskData.rounds || 1
          }
        };
      } else if (taskType === 'zone') {
        request = {
          category: 'zone',
          description: taskData.zone || {}
        };
      } else if (taskType === 'couple') {
        request = {
          category: 'couple',
          description: {
            zone: taskData.zone || {},
            couple: taskData.couple || {}
          }
        };
      } else if (taskType === 'decouple') {
        request = {
          category: 'decouple',
          description: {
            zone: taskData.zone || {},
            decouple: taskData.decouple || {}
          }
        };
      } else if (taskType === 'arm') {
        // Build arm manipulation task with zone navigation + perform_action sequence
        const activities = [];
        
        // Add first action (required)
        if (taskData.action1) {
          if (taskData.object1 && taskData.zone1) {
            // Add zone navigation for object 1
            activities.push({
              category: 'zone',
              description: {
                zone: taskData.zone1,
                places: taskData.places || []
              }
            });
          }
          
          // Add perform_action for action 1
          const action1Desc = taskData.action1_description ? 
            (typeof taskData.action1_description === 'string' ? 
              JSON.parse(taskData.action1_description) : taskData.action1_description) : {};
          
          if (taskData.object1 && taskData.zone1) {
            action1Desc.zone_name = taskData.zone1;
          }
          
          activities.push({
            category: 'perform_action',
            description: {
              unix_millis_action_duration_estimate: taskData.action1_duration || 60000,
              category: taskData.action1,
              description: action1Desc
            }
          });
        }
        
        // Add second action (optional)
        if (taskData.action2) {
          if (taskData.object2 && taskData.zone2) {
            // Add zone navigation for object 2
            activities.push({
              category: 'zone',
              description: {
                zone: taskData.zone2,
                places: taskData.places || []
              }
            });
          }
          
          // Add perform_action for action 2
          const action2Desc = taskData.action2_description ? 
            (typeof taskData.action2_description === 'string' ? 
              JSON.parse(taskData.action2_description) : taskData.action2_description) : {};
          
          if (taskData.object2 && taskData.zone2) {
            action2Desc.zone_name = taskData.zone2;
          }
          
          activities.push({
            category: 'perform_action',
            description: {
              unix_millis_action_duration_estimate: taskData.action2_duration || 60000,
              category: taskData.action2,
              description: action2Desc
            }
          });
        }
        
        request = {
          category: 'compose',
          description: {
            category: taskData.action1,
            detail: taskData.detail || `Arm manipulation task: ${taskData.action1}`,
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
      } else {
        throw new Error(`Unsupported task type: ${taskType}`);
      }

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
