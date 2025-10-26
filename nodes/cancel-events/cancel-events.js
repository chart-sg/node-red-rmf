module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, validateBasicInputs, handleValidationResult } = require('../lib/rmfValidation');

  function CancelEventsNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[CANCEL-EVENTS] Setting node status: ${text}`);
      node.status({ fill: fill, shape: shape, text: text });
    }

    // Simple RMF context validation for control nodes
    function validateRMFContext() {
      // 1. Check if rmfContextManager exists
      if (!rmfContextManager || !rmfContextManager.context) {
        return {
          valid: false,
          error: 'RMF context not available. Ensure an RMF Config node is deployed and connected to a start-events node.',
          error_type: 'rmf_context_missing'
        };
      }

      // 2. Check RMF socket connection
      if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
        return {
          valid: false,
          error: 'RMF socket not connected. Check RMF server status and config.',
          error_type: 'rmf_connection_waiting'
        };
      }

      return { valid: true };
    }
    
    function updateRMFStatus() {
      try {
        if (!rmfContextManager || !rmfContextManager.context) {
          setStatus('red', 'ring', 'RMF context unavailable');
          return;
        }
        
        const socket = rmfContextManager.context.socket;
        if (!socket || !socket.connected) {
          setStatus('red', 'ring', 'RMF connection failed');
        } else {
          setStatus('green', 'dot', 'Ready');
        }
      } catch (error) {
        console.error('[CANCEL-EVENTS] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
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
      setStatus('red', 'ring', 'RMF disconnected');
    }
    function onCleanedUp() {
      setStatus('red', 'ring', 'RMF cleaned up');
    }
    function onError(err) {
      setStatus('red', 'ring', 'RMF error: ' + (err && err.message ? err.message : 'unknown'));
    }

    rmfEvents.on('ready', onReady);
    rmfEvents.on('socket_connected', onSocketConnected);
    rmfEvents.on('socket_disconnected', onSocketDisconnected);
    rmfEvents.on('cleanedUp', onCleanedUp);
    rmfEvents.on('error', onError);

    // Initialize status check
    setStatus('yellow', 'ring', 'Waiting for RMF context...');
    setTimeout(updateRMFStatus, 1000);

    // Clear listeners on close
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
        // Validate global RMF context first
        const contextValidation = validateRMFContext();
        if (!contextValidation.valid) {
          setStatus('red', 'ring', 'No RMF context');
          msg.payload = { 
            status: 'failed', 
            reason: contextValidation.error,
            error_type: contextValidation.error_type
          };
          send([null, msg]); // Send to failed output 
          return done();
        }

        // Get configuration values (prefer RMF metadata, then payload, then direct message, then node config)
        const robotName = msg.rmf_robot_name || msg._rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name || node.robot_name;
        const robotFleet = msg.rmf_robot_fleet || msg._rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet || node.robot_fleet;
        const taskId = msg.rmf_task_id || msg._rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;

        // Validate basic inputs using shared utility
        const basicValidation = validateBasicInputs({
          robotName,
          robotFleet,
          nodeType: 'CANCEL-EVENTS'
        });
        
        if (!handleValidationResult(basicValidation, setStatus, send, done, msg)) {
          return;
        }

        // Validate robot and fleet using shared utility
        const robotValidation = validateRobotAndFleet({
          robotName,
          robotFleet,
          rmfContextManager,
          nodeType: 'CANCEL-EVENTS',
          skipIfEmpty: false // cancel-events requires both robot and fleet
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg)) {
          return;
        }

        setStatus('blue', 'dot', 'Canceling events');

        // Get robot context to find current task state
        const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        if (!robotContext) {
          setStatus('red', 'ring', 'Robot context not found');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot context not found for ${robotName} (${robotFleet})` 
          };
          send(msg);
          return done();
        }

        // Validate robot context has required fields for cancel event
        if (!robotContext.dynamic_event_seq) {
          setStatus('red', 'ring', 'No active dynamic event');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot ${robotName} (${robotFleet}) has no active dynamic event sequence. Current robot context: ${JSON.stringify(robotContext, null, 2)}`,
            robot_context: robotContext,
            help: 'Ensure the robot has an active task from start-events/goto-place nodes before calling cancel-events.'
          };
          send(msg);
          return done();
        }

        // Note: dynamic_event_id might not be available immediately after task start
        // RMF typically uses the feedback id as the dynamic_event_id
        // If not available, we'll try to cancel using just the sequence number
        let dynamicEventId = robotContext.dynamic_event_id;
        if (!dynamicEventId) {
          console.log(`[CANCEL-EVENTS] No dynamic_event_id available for ${robotName}, will attempt cancel with sequence ${robotContext.dynamic_event_seq}`);
          // Use sequence number as fallback (common in RMF implementations)
          dynamicEventId = robotContext.dynamic_event_seq;
        }

        // Send cancel event using dynamic event control
        try {
          // Format robot context for sendDynamicEventControl (expects robot_name, robot_fleet)
          const formattedRobotContext = {
            robot_name: robotContext.name || robotName,
            robot_fleet: robotContext.fleet || robotFleet,
            dynamic_event_seq: robotContext.dynamic_event_seq,
            dynamic_event_id: dynamicEventId
          };
          
          console.log(`[CANCEL-EVENTS] Formatted robot context for cancel event:`, formattedRobotContext);
          
          const cancelResult = await rmfContextManager.sendDynamicEventControl('cancel', formattedRobotContext);
          
          if (cancelResult.success) {
            setStatus('green', 'dot', 'Events canceled');
            
            msg.payload = {
              status: 'completed',
              action: 'cancel',
              rmf_robot_name: robotName,
              rmf_robot_fleet: robotFleet,
              rmf_task_id: taskId,
              rmf_dynamic_event_seq: robotContext.dynamic_event_seq,
              rmf_dynamic_event_id: dynamicEventId,
              timestamp: new Date().toISOString()
            };
            
            // Set RMF metadata for potential next node
            msg.rmf_task_id = taskId;
            msg.rmf_robot_name = robotName;
            msg.rmf_robot_fleet = robotFleet;
            msg.rmf_dynamic_event_seq = robotContext.dynamic_event_seq;
            
            send(msg);
            
          } else {
            setStatus('red', 'ring', 'Cancel failed');
            msg.payload = { 
              status: 'failed', 
              reason: `Failed to send cancel event: ${cancelResult.error || 'Unknown error'}`,
              robot_name: robotName,
              robot_fleet: robotFleet
            };
            send(msg);
          }

        } catch (error) {
          console.error('[CANCEL-EVENTS] Error during cancel event:', error);
          setStatus('red', 'ring', 'Cancel error');
          msg.payload = { 
            status: 'error', 
            reason: `Exception during cancel event: ${error.message}`,
            robot_name: robotName,
            robot_fleet: robotFleet,
            debug_info: {
              robot_context_available: !!robotContext,
              dynamic_event_seq: robotContext?.dynamic_event_seq,
              dynamic_event_id: robotContext?.dynamic_event_id,
              dynamic_event_status: robotContext?.dynamic_event_status,
              task_id: robotContext?.task_id
            }
          };
          send(msg);
        }

        done();

      } catch (error) {
        setStatus('red', 'ring', 'Events error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send(msg);
        done(error);
      }
    });
  }

  RED.nodes.registerType('cancel-events', CancelEventsNode);
};