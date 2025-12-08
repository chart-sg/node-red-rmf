module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, validateBasicInputs, handleValidationResult } = require('../lib/rmfValidation');

  function EndEventsNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.start_events_node = config.start_events_node;

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      node.status({ fill: fill, shape: shape, text: text });
    }

    // Get metadata from selected start-events node
    function getStartEventsMetadata() {
      if (!node.start_events_node || node.start_events_node === '') {
        return null;
      }
      
      const startEventsNode = RED.nodes.getNode(node.start_events_node);
      if (!startEventsNode || startEventsNode.type !== 'start-events') {
        console.log(`[END-EVENTS] Selected start-events node not found or invalid: ${node.start_events_node}`);
        return null;
      }
      
      // Check if the start-events node has active task metadata stored
      // This would be populated when the start-events node successfully creates a task
      const metadata = {
        nodeId: startEventsNode.id,
        robotName: null,
        robotFleet: null,
        taskId: null,
        dynamicEventSeq: null
      };
      
      // Try to get robot info from the start-events node configuration
      if (startEventsNode.robot_name && startEventsNode.robot_name !== '' && 
          startEventsNode.robot_name !== '__RMF_DEFINED__' && startEventsNode.robot_name !== '__AUTO_DEFINED__') {
        metadata.robotName = startEventsNode.robot_name;
      }
      
      if (startEventsNode.robot_fleet && startEventsNode.robot_fleet !== '') {
        metadata.robotFleet = startEventsNode.robot_fleet;
      }
      
      // Try to get runtime task information from the start-events node's context
      // This is where active task metadata would be stored after task creation
      if (startEventsNode.context) {
        const taskId = startEventsNode.context().get('current_task_id');
        const dynamicEventSeq = startEventsNode.context().get('current_dynamic_event_seq');
        const runtimeRobotName = startEventsNode.context().get('current_robot_name');
        const runtimeRobotFleet = startEventsNode.context().get('current_robot_fleet');
        
        if (taskId) metadata.taskId = taskId;
        if (dynamicEventSeq !== undefined) metadata.dynamicEventSeq = dynamicEventSeq;
        if (runtimeRobotName) metadata.robotName = runtimeRobotName;
        if (runtimeRobotFleet) metadata.robotFleet = runtimeRobotFleet;
      }
      
      console.log(`[END-EVENTS] Retrieved metadata from start-events node:`, metadata);
      return metadata;
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
        console.error('[END-EVENTS] Error in updateRMFStatus:', error);
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

        // Get metadata from selected start-events node if configured
        const startEventsMetadata = getStartEventsMetadata();
        
        // Get configuration values (prefer RMF metadata from message, then start-events node, then payload, then direct message, then node config)
        let robotName = msg.rmf_robot_name || msg._rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name;
        let robotFleet = msg.rmf_robot_fleet || msg._rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet;
        let taskId = msg.rmf_task_id || msg._rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;
        
        // Use start-events metadata as fallback if message doesn't contain the required info
        if (startEventsMetadata) {
          if (!robotName && startEventsMetadata.robotName) {
            robotName = startEventsMetadata.robotName;
            console.log(`[END-EVENTS] Using robot name from start-events node: ${robotName}`);
          }
          if (!robotFleet && startEventsMetadata.robotFleet) {
            robotFleet = startEventsMetadata.robotFleet;
            console.log(`[END-EVENTS] Using robot fleet from start-events node: ${robotFleet}`);
          }
          if (!taskId && startEventsMetadata.taskId) {
            taskId = startEventsMetadata.taskId;
            console.log(`[END-EVENTS] Using task ID from start-events node: ${taskId}`);
          }
        }
        
        // Final fallback to node configuration
        if (!robotName) robotName = node.robot_name;
        if (!robotFleet) robotFleet = node.robot_fleet;

        // Validate basic inputs using shared utility
        const basicValidation = validateBasicInputs({
          robotName,
          robotFleet,
          nodeType: 'END-EVENTS'
        });
        
        if (!handleValidationResult(basicValidation, setStatus, send, done, msg)) {
          return;
        }

        // Validate robot and fleet using shared utility
        const robotValidation = validateRobotAndFleet({
          robotName,
          robotFleet,
          rmfContextManager,
          nodeType: 'END-EVENTS',
          skipIfEmpty: false // end-events requires both robot and fleet
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg)) {
          return;
        }

        setStatus('blue', 'dot', 'Ending events');

        // Get robot context to find current task state
        const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        if (!robotContext) {
          setStatus('red', 'ring', 'Robot context not found');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot context not available for ${robotName} in fleet ${robotFleet}` 
          };
          send([null, msg]);
          return done();
        }

        console.log(`[END-EVENTS] Robot context for ${robotName}:`, {
          currentTaskId: robotContext.current_task_id,
          requestedTaskId: taskId,
          state: robotContext.state,
          fleet: robotContext.fleet,
          mode: robotContext.mode
        });

        // Validate robot context has required fields for end event
        if (!robotContext.dynamic_event_seq) {
          setStatus('red', 'ring', 'No active events');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot ${robotName} (${robotFleet}) has no active dynamic event sequence.`,
            robot_context: robotContext,
            help: 'Ensure the robot has an active task from start-events nodes before calling end-events.'
          };
          send([null, msg]);
          return done();
        }

        // Note: dynamic_event_id might not be available immediately after task start
        // RMF typically uses the feedback id as the dynamic_event_id
        // If not available, we'll try to end using just the sequence number
        let dynamicEventId = robotContext.dynamic_event_id;
        if (!dynamicEventId) {
          console.log(`[END-EVENTS] No dynamic_event_id available for ${robotName}, will attempt end with sequence ${robotContext.dynamic_event_seq}`);
          // Use sequence number as fallback (common in RMF implementations)
          dynamicEventId = robotContext.dynamic_event_seq;
        }

        // Send end event using dynamic event control
        try {
          // Format robot context for sendDynamicEventControl (expects robot_name, robot_fleet)
          const formattedRobotContext = {
            robot_name: robotContext.name || robotName,
            robot_fleet: robotContext.fleet || robotFleet,
            dynamic_event_seq: robotContext.dynamic_event_seq,
            dynamic_event_id: dynamicEventId
          };
          
          console.log(`[END-EVENTS] Formatted robot context for end event:`, formattedRobotContext);
          
          const endResult = await rmfContextManager.sendDynamicEventControl('end', formattedRobotContext);
          
          if (endResult.success) {
            setStatus('green', 'dot', 'Events ended');
            
            msg.payload = {
              status: 'completed',
              action: 'end',
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
            setStatus('red', 'ring', 'End failed');
            msg.payload = { 
              status: 'failed', 
              reason: `Failed to send end event: ${endResult.error || 'Unknown error'}`,
              robot_name: robotName,
              robot_fleet: robotFleet
            };
            send(msg);
          }

        } catch (error) {
          console.error('[END-EVENTS] Error during end event:', error);
          setStatus('red', 'ring', 'End error');
          msg.payload = { 
            status: 'error', 
            reason: `Exception during end event: ${error.message}`,
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

  RED.nodes.registerType('end-events', EndEventsNode);
};