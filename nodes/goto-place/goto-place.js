module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;

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

    // --- Event-driven RMF status handling ---
    let lastSocketConnected = false;
    function updateRMFStatus() {
      try {
        const socket = rmfContextManager.context && rmfContextManager.context.socket;
        if (!socket || !socket.connected) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for RMF connection...' });
          lastSocketConnected = false;
        } else {
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

    // Listen for RMF context events
    function onReady() {
      updateRMFStatus();
    }
    function onSocketConnected() {
      updateRMFStatus();
    }
    function onSocketDisconnected() {
      node.status({ fill: 'yellow', shape: 'ring', text: 'RMF disconnected' });
      lastSocketConnected = false;
    }
    function onCleanedUp() {
      node.status({ fill: 'grey', shape: 'ring', text: 'RMF cleaned up' });
      lastSocketConnected = false;
    }
    function onError(err) {
      node.status({ fill: 'red', shape: 'ring', text: 'RMF error: ' + (err && err.message ? err.message : 'unknown') });
    }

    rmfEvents.on('ready', onReady);
    rmfEvents.on('socket_connected', onSocketConnected);
    rmfEvents.on('socket_disconnected', onSocketDisconnected);
    rmfEvents.on('cleanedUp', onCleanedUp);
    rmfEvents.on('error', onError);

    // Initial status
    updateRMFStatus();

    // Clear listeners and interval on close
    node.on('close', async (removed, done) => {
      rmfEvents.off('ready', onReady);
      rmfEvents.off('socket_connected', onSocketConnected);
      rmfEvents.off('socket_disconnected', onSocketDisconnected);
      rmfEvents.off('cleanedUp', onCleanedUp);
      rmfEvents.off('error', onError);
      if (done) done();
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
        const zoneType = node.zone_type || msg.zone_type || '';
        let estimate = node.estimate || msg.estimate || '{}';
        const stubbornPeriod = node.stubborn_period !== undefined ? node.stubborn_period : 
                               (msg.stubborn_period !== undefined ? msg.stubborn_period : 0);
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'abort';
        // Handle checkbox properly - explicitly check for boolean true, default to false
        const lastEvent = (node.last_event === true) || (msg.last_event === true);

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

        // Helper to assign a new RMF dynamic event task and update rmfData
        async function assignNewDynamicEventTask(rmfData) {
          const result = await createRMFTask(rmfData);
          if (!result.success) {
            node.error(`Failed to create RMF task: ${result.error}`);
            node.status({ fill: 'red', shape: 'ring', text: 'Task creation failed' });
            return { success: false };
          }
          const standbyResult = await waitForTaskStandby(result.taskId, rmfData.robot_name, rmfData.robot_fleet);
          if (!standbyResult.success) {
            node.error(`Task failed to reach standby: ${standbyResult.error}`);
            node.status({ fill: 'red', shape: 'ring', text: 'Task standby failed' });
            return { success: false };
          }
          rmfData.task_id = result.taskId;
          rmfData.dynamic_event_seq = standbyResult.dynamicEventSeq;
          return { success: true };
        }


        // --- Refactored logic: task_id and dynamic_event_seq handling ---
        // Always use the latest robot context for status checks
        const latestRobotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        node.log(`[RMF][DEBUG] Latest robot context:`, latestRobotContext);
        if (latestRobotContext && latestRobotContext.task_id) {
          node.log(`[RMF][INFO] Robot ${robotName} already has task_id: ${latestRobotContext.task_id}`);
          if (latestRobotContext.dynamic_event_seq) {
            node.log(`[RMF][DEBUG] Robot ${robotName} dynamic_event_seq: ${latestRobotContext.dynamic_event_seq}`);
            node.log(`[RMF][DEBUG] Robot ${robotName} dynamic_event_status: ${latestRobotContext.dynamic_event_status}`);
            // Robot has a dynamic event task, handle as existing dynamic event
            const result = await handleExistingDynamicEvent(latestRobotContext, parallelBehaviour, rmfData);
            node.log(`[RMF][DEBUG] handleExistingDynamicEvent result:`, result);
            // --- Diagnostics: log context and dynamic_event_id before cancel/overwrite ---
            if (result.action === 'cancel') {
              node.status({ fill: 'yellow', shape: 'ring', text: result.message });
              node.log(`[RMF][DIAG] Cancel/overwrite about to use latestRobotContext:`, latestRobotContext);
              node.log(`[RMF][DIAG] dynamic_event_id in latestRobotContext:`, latestRobotContext.dynamic_event_id, typeof latestRobotContext.dynamic_event_id);
              if (!latestRobotContext.dynamic_event_id || latestRobotContext.dynamic_event_id === 0n) {
                node.warn(`[RMF][WARN] dynamic_event_id is missing or 0n at cancel/overwrite! Full context:`, latestRobotContext);
              }
              msg.payload = { status: 'cancelled', reason: result.message };
              send(msg);
              return done();
            }
            if (result.action === 'send_dynamic_event_goal') {
              node.log(`[RMF][INFO] Bypassing RMF task assignment, sending dynamic event goal directly (action: send_dynamic_event_goal)`);
              // Do NOT assign new task, proceed to send goal
            } else if (result.action === 'assign_new_task') {
              node.log(`[RMF][INFO] Assigning new dynamic event task for robot ${robotName}`);
              const assignResult = await assignNewDynamicEventTask(rmfData);
              node.log(`[RMF][DEBUG] assignNewDynamicEventTask result:`, assignResult);
              if (!assignResult.success) return done();
            } else if (parallelBehaviour === 'overwrite' && result.action === 'send_dynamic_event_goal') {
              node.log(`[RMF][INFO] Overwrite: cancelling existing dynamic event before sending new event for robot ${robotName}`);
              node.log(`[RMF][DIAG] Cancel/overwrite about to use latestRobotContext:`, latestRobotContext);
              node.log(`[RMF][DIAG] dynamic_event_id in latestRobotContext:`, latestRobotContext.dynamic_event_id, typeof latestRobotContext.dynamic_event_id);
              if (!latestRobotContext.dynamic_event_id || latestRobotContext.dynamic_event_id === 0n) {
                node.warn(`[RMF][WARN] dynamic_event_id is missing or 0n at cancel/overwrite! Full context:`, latestRobotContext);
              }
              try {
                const cancelResult = await rmfContextManager.sendDynamicEventControl('cancel', latestRobotContext);
                node.log(`[RMF][DEBUG] Cancel event result:`, cancelResult);
                if (!cancelResult.success) {
                  node.error(`[RMF][ERROR] Failed to cancel dynamic event before overwrite: ${cancelResult.error || 'Unknown error'}`);
                  node.status({ fill: 'red', shape: 'ring', text: 'Cancel event failed' });
                  msg.payload = { status: 'cancel_failed', reason: cancelResult.error };
                  send(msg);
                  return done();
                }
                node.log(`[RMF][INFO] Cancel event sent successfully before overwrite for robot ${robotName}`);
              } catch (cancelError) {
                node.error(`[RMF][ERROR] Exception during cancel event: ${cancelError.message}`);
                node.status({ fill: 'red', shape: 'ring', text: 'Cancel event exception' });
                msg.payload = { status: 'cancel_exception', reason: cancelError.message };
                send(msg);
                return done();
              }
            }
          } else {
            node.log(`[RMF][INFO] Robot ${robotName} has task_id but no dynamic_event_seq. Creating new RMF task.`);
            const assignResult = await assignNewDynamicEventTask(rmfData);
            node.log(`[RMF][DEBUG] assignNewDynamicEventTask result:`, assignResult);
            if (!assignResult.success) return done();
          }
        } else {
          node.log(`[RMF][INFO] Robot ${robotName} has no task_id. Creating new RMF task.`);
          const assignResult = await assignNewDynamicEventTask(rmfData);
          node.log(`[RMF][DEBUG] assignNewDynamicEventTask result:`, assignResult);
          if (!assignResult.success) return done();
        }

        // Update flow context with latest rmf_data
        flowContext.set('rmf_data', rmfData);
        
        // Step 4: Send goal to dynamic event action server with safe callback handling
        console.log('RMF: Sending dynamic event goal with safe callbacks...');
        
        const robot = rmfContextManager.getRobotContext(rmfData.robot_name, rmfData.robot_fleet);
        // Set up callbacks for goal completion and feedback
        const goalCallbacks = {
          onGoalComplete: (goalResponse) => {
            console.log('RMF: Goal completed, sending Node-RED output:', goalResponse);
            
            // Return dynamic event status back to 'active'
            validatedRobot.dynamic_event_status = 'active';

            
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
            validatedRobot.dynamic_event_status = feedbackData.status;
            // Store dynamic event id if present, and ensure type is BigInt
            let eventId = undefined;
            if (feedbackData.id !== undefined) {
              const idStr = feedbackData.id.toString();
              eventId = BigInt(idStr);
              validatedRobot.dynamic_event_id = eventId;
              node.log(`[RMF][DEBUG] dynamic_event_id from feedbackData.id:`, eventId, typeof eventId);
            }
            if (feedbackData.dynamic_event_id !== undefined) {
              const idStr = feedbackData.dynamic_event_id.toString();
              eventId = BigInt(idStr);
              validatedRobot.dynamic_event_id = eventId;
              node.log(`[RMF][DEBUG] dynamic_event_id from feedbackData.dynamic_event_id:`, eventId, typeof eventId);
            }
            // Always update robot context with validatedRobot.dynamic_event_id if available
            let contextEventId = validatedRobot.dynamic_event_id !== undefined ? validatedRobot.dynamic_event_id : (feedbackData.id !== undefined ? feedbackData.id : feedbackData.dynamic_event_id);
            if (contextEventId !== undefined) {
              try {
                contextEventId = BigInt(contextEventId.toString());
              } catch (e) {
                node.warn(`[RMF][WARN] Could not convert dynamic_event_id to BigInt: ${contextEventId}`);
              }
            }
            rmfContextManager.updateRobotContext(
              validatedRobot.robot_name || validatedRobot.name,
              validatedRobot.robot_fleet || validatedRobot.fleet,
              {
                dynamic_event_status: feedbackData.status,
                dynamic_event_id: contextEventId
              }
            );
            node.log(`[RMF][DEBUG] Updated robot context with dynamic_event_id:`, contextEventId, typeof contextEventId);
            // Immediately log robot context after update for diagnostics
            const updatedRobotCtx = rmfContextManager.getRobotContext(validatedRobot.robot_name || validatedRobot.name, validatedRobot.robot_fleet || validatedRobot.fleet);
            node.log(`[RMF][DEBUG] Robot context after update:`, updatedRobotCtx);
            let statusText = `${feedbackData.status}`;
            if (feedbackData.progress) {
              statusText += ` (${feedbackData.progress}%)`;
            }
            if (feedbackData.current_phase) {
              statusText += ` - ${feedbackData.current_phase}`;
            }
            node.status({ fill: 'blue', shape: 'dot', text: statusText });
            // Update flow context with feedback and dynamic_event_id
            const currentRmfData = flowContext.get('rmf_data') || rmfData;
            flowContext.set('rmf_data', {
              ...currentRmfData,
              current_feedback: feedbackData,
              last_feedback_time: feedbackData.timestamp,
              dynamic_event_status: feedbackData.status,
              dynamic_event_id: contextEventId !== undefined ? contextEventId : currentRmfData.dynamic_event_id
            });
            node.log(`[RMF][DEBUG] Updated flow context with dynamic_event_id:`, contextEventId, typeof contextEventId);
          }
        };
        
        // Send goal with callbacks
        const actionResult = await sendDynamicEventGoal(rmfData);

        console.log('RMF: Action result received in goto-place:', actionResult);

        if (!actionResult.success) {
          const errorMsg = actionResult.error || 'Unknown error';
          node.error(`Failed to send dynamic event goal: ${errorMsg}`);
          node.status({ fill: 'red', shape: 'ring', text: 'Goal sending failed' });
          return done();
        }

        console.log('RMF: Dynamic event goal sent successfully');

        // Handle different completion statuses
        let statusText = 'Goal sent successfully';
        let statusColor = 'green';
        let statusShape = 'dot';
        
        if (actionResult.status === 'canceled') {
          statusText = 'Goal was canceled';
          statusColor = 'yellow';
          statusShape = 'ring';
        } else if (actionResult.status === 'aborted') {
          statusText = 'Goal was aborted';
          statusColor = 'yellow';
          statusShape = 'ring';
        } else if (actionResult.status === 'failed') {
          statusText = 'Goal failed';
          statusColor = 'red';
          statusShape = 'ring';
        } else if (actionResult.status === 'succeeded') {
          statusText = 'Goal completed successfully';
          statusColor = 'green';
          statusShape = 'dot';
        }

        node.status({ fill: statusColor, shape: statusShape, text: statusText });

        // Prepare output payload with enhanced status information
        const outputPayload = {
          ...rmfData,
          goal_result: actionResult,
          status: actionResult.status || 'goal_sent',
          success: actionResult.success,
          completion_status: actionResult.status,
          timestamp: new Date().toISOString()
        };

        msg.payload = outputPayload;
        send(msg);

        // Update flow context with final state
        flowContext.set('rmf_data', outputPayload);

        // If last_event is true, send end event after new event completes
        if (lastEvent) {
          node.log('last_event is true: sending end event after new event completes');
          // Ensure all required properties are set before sending end event
          const latestRmfData = flowContext.get('rmf_data') || rmfData;
          if (latestRmfData) {
            validatedRobot.robot_name = latestRmfData.robot_name;
            validatedRobot.robot_fleet = latestRmfData.robot_fleet;
            validatedRobot.dynamic_event_seq = latestRmfData.dynamic_event_seq;
            if (latestRmfData.dynamic_event_id) {
              validatedRobot.dynamic_event_id = latestRmfData.dynamic_event_id;
            }
          }
          // Log validatedRobot properties for troubleshooting (avoid JSON.stringify on BigInt)
          node.log('[End Event Debug] robot_name:', validatedRobot.robot_name);
          node.log('[End Event Debug] robot_fleet:', validatedRobot.robot_fleet);
          node.log('[End Event Debug] dynamic_event_seq:', validatedRobot.dynamic_event_seq ? validatedRobot.dynamic_event_seq.toString() : validatedRobot.dynamic_event_seq);
          node.log('[End Event Debug] dynamic_event_id:', validatedRobot.dynamic_event_id);
          try {
            const endResult = await rmfContextManager.sendDynamicEventControl('end', validatedRobot);
            if (!endResult.success) {
              node.error('Failed to send end event: ' + (endResult.error || 'Unknown error'));
              node.status({ fill: 'red', shape: 'ring', text: 'End event failed' });
              msg.payload = { status: 'end_failed', reason: endResult.error };
              send(msg);
              return done();
            }
            node.log('End event sent successfully after last event');
          } catch (endError) {
            node.error('Exception during end event: ' + endError.message);
            node.status({ fill: 'red', shape: 'ring', text: 'End event exception' });
            msg.payload = { status: 'end_exception', reason: endError.message };
            send(msg);
            return done();
          }
        }

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
    // Helper to get dynamic event status (stub: replace with actual RMF query if available)
function getDynamicEventStatus(robot) {
  // Prefer most recent feedback status if available in robot or flow context
  if (robot.dynamic_event_status) return robot.dynamic_event_status;
  if (robot.current_feedback && robot.current_feedback.status) return robot.current_feedback.status;
  if (robot.status) return robot.status;
  return null;
}

    async function handleExistingDynamicEvent(robot, parallelBehaviour, rmfData) {
      try {
        const eventStatus = getDynamicEventStatus(robot);
        node.log(`Robot ${robot.name} dynamic event status: ${eventStatus}`);

        if (!eventStatus) {
          // Status unknown, treat as error or decide default behaviour
          return {
            action: 'cancel',
            message: `Cannot determine dynamic event status for robot ${robot.name}.`
          };
        }

        // Only allow sending a new goal if eventStatus is a terminal state or 'active'
        if (
          eventStatus === 'completed' ||
          eventStatus === 'done' ||
          eventStatus === 'cancelled' ||
          eventStatus === 'canceled' ||
          eventStatus === 'failed'
        ) {
          // Dynamic event is completed, safe to proceed
          return {
            action: 'send_dynamic_event_goal',
            message: `Previous dynamic event completed for robot ${robot.name}`
          };
        }
        if (eventStatus === 'active') {
          // Robot is ready for new event
          return {
            action: 'send_dynamic_event_goal',
            message: `Dynamic event status is active for robot ${robot.name}`
          };
        }
        if (eventStatus === 'underway') {
          // If event is underway, handle according to parallel behaviour
          switch (parallelBehaviour) {
            case 'abort':
              return {
                action: 'cancel',
                message: `Aborted: Robot ${robot.name} already has an active dynamic event underway.`
              };
            case 'overwrite':
              node.log(`Overwriting existing dynamic event for robot ${robot.name}`);
              // Perform cancel goal before overwrite
              try {
                // Build cancel goal payload with robot_name and robot_fleet
                // Ensure id is present and log its value
                let cancelId = robot.dynamic_event_id;
                node.log(`[RMF][DEBUG] Cancel/overwrite: robot.dynamic_event_id value:`, cancelId, typeof cancelId);
                if (cancelId === undefined || cancelId === null) {
                  node.warn(`[RMF][WARN] dynamic_event_id missing for cancel goal, using fallback id: 0n`);
                  node.warn(`[RMF][WARN] Full robot context:`, robot);
                  cancelId = 0n;
                } else {
                  node.log(`[RMF][INFO] dynamic_event_id for cancel goal:`, cancelId);
                }
                const cancelGoal = {
                  robot_name: robot.robot_name || robot.name,
                  robot_fleet: robot.robot_fleet || robot.fleet,
                  event_type: 2,
                  dynamic_event_seq: robot.dynamic_event_seq,
                  id: cancelId
                };
                node.log(`[RMF][INFO] Sending cancel goal for overwrite:`, cancelGoal);
                const cancelResult = await rmfContextManager.sendDynamicEventGoal(cancelGoal);
                node.log(`[RMF][DEBUG] Cancel goal result for overwrite:`, cancelResult);
                if (!cancelResult.success) {
                  return {
                    action: 'cancel',
                    message: `Failed to cancel existing dynamic event for overwrite: ${cancelResult.error}`
                  };
                }
                node.log(`[RMF][INFO] Cancel goal sent successfully for overwrite, proceeding to send new event.`);
              } catch (cancelError) {
                return {
                  action: 'cancel',
                  message: `Exception during cancel for overwrite: ${cancelError.message}`
                };
              }
              return {
                action: 'send_dynamic_event_goal',
                message: `Overwriting existing dynamic event for robot ${robot.name}`
              };
            case 'queue':
              node.log(`Queuing new dynamic event for robot ${robot.name}`);
              // Just signal to caller to create a new task
              return {
                action: 'assign_new_task',
                message: `Queueing new dynamic event for robot ${robot.name}`
              };
            default:
              return {
                action: 'cancel',
                message: `Invalid parallel behaviour: ${parallelBehaviour}`
              };
          }
        }
        // Unknown status, treat as error
        return {
          action: 'cancel',
          message: `Unknown dynamic event status: ${eventStatus} for robot ${robot.name}`
        };
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
