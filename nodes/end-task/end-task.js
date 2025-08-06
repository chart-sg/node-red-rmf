module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;

  function EndTaskNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[END-TASK] Setting node status: ${text}`);
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
        } else {
          setStatus('green', 'dot', 'Ready');
        }
      } catch (error) {
        console.error('[END-TASK] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[END-TASK] RMF config ready, checking connection...');
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

    rmfEvents.on('ready', onReady);
    rmfEvents.on('socket_connected', onSocketConnected);
    rmfEvents.on('socket_disconnected', onSocketDisconnected);
    rmfEvents.on('cleanedUp', onCleanedUp);
    rmfEvents.on('error', onError);

    // Don't call updateRMFStatus() immediately - wait for rmf-ready event

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
        // Check RMF connection
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          setStatus('yellow', 'ring', 'Waiting for RMF connection');
          msg.payload = { 
            status: 'waiting', 
            reason: 'RMF socket not connected yet' 
          };
          send(msg);
          return done();
        }

        // Get configuration values (prefer RMF metadata, then payload, then direct message, then node config)
        const robotName = msg.rmf_robot_name || msg._rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name || node.robot_name;
        const robotFleet = msg.rmf_robot_fleet || msg._rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet || node.robot_fleet;
        const taskId = msg.rmf_task_id || msg._rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;

        // Validate inputs
        if (!robotName || !robotFleet) {
          setStatus('red', 'ring', 'Missing robot info');
          msg.payload = { 
            status: 'failed', 
            reason: 'Robot name and fleet are required' 
          };
          send(msg);
          return done();
        }

        // Validate robot exists in RMF data
        const rmfData = rmfContextManager.getRMFData();
        if (!rmfData || rmfData.robots.length === 0) {
          setStatus('red', 'ring', 'No RMF data');
          msg.payload = { 
            status: 'failed', 
            reason: 'RMF context not available. Ensure RMF Config node is deployed and connected.' 
          };
          send(msg);
          return done();
        }

        const validatedRobot = rmfData.robots.find(r => {
          const nameMatch = r.name === robotName || r.robot_name === robotName;
          const fleetMatch = r.fleet === robotFleet || r.fleet_name === robotFleet;
          return nameMatch && fleetMatch;
        });

        if (!validatedRobot) {
          setStatus('red', 'ring', 'Robot not found');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot "${robotName}" not found in fleet "${robotFleet}"` 
          };
          send(msg);
          return done();
        }

        setStatus('blue', 'dot', 'Ending task');

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

        // Validate robot context has required fields for end event
        if (!robotContext.dynamic_event_seq) {
          setStatus('red', 'ring', 'No active task');
          msg.payload = { 
            status: 'failed', 
            reason: `Robot ${robotName} has no active dynamic event sequence. Ensure the robot has an active task from start-task/goto-place nodes.` 
          };
          send(msg);
          return done();
        }

        // Send end event using dynamic event control
        try {
          // Format robot context for sendDynamicEventControl (expects robot_name, robot_fleet)
          const formattedRobotContext = {
            robot_name: robotContext.name || robotName,
            robot_fleet: robotContext.fleet || robotFleet,
            dynamic_event_seq: robotContext.dynamic_event_seq
          };
          
          console.log(`[END-TASK] Formatted robot context for end event:`, formattedRobotContext);
          
          const endResult = await rmfContextManager.sendDynamicEventControl('end', formattedRobotContext);
          
          if (endResult.success) {
            setStatus('green', 'dot', 'Task ended');
            
            msg.payload = {
              status: 'completed',
              action: 'end',
              robot_name: robotName,
              robot_fleet: robotFleet,
              task_id: taskId,
              dynamic_event_seq: robotContext.dynamic_event_seq,
              timestamp: new Date().toISOString()
            };
            
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
          console.error('[END-TASK] Error during end event:', error);
          setStatus('red', 'ring', 'End error');
          msg.payload = { 
            status: 'error', 
            reason: `Exception during end event: ${error.message}`,
            robot_name: robotName,
            robot_fleet: robotFleet,
            debug_info: {
              robot_context_available: !!robotContext,
              dynamic_event_seq: robotContext?.dynamic_event_seq,
              dynamic_event_status: robotContext?.dynamic_event_status,
              task_id: robotContext?.task_id
            }
          };
          send(msg);
        }

        done();

      } catch (error) {
        setStatus('red', 'ring', 'Task error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send(msg);
        done(error);
      }
    });
  }

  RED.nodes.registerType('end-task', EndTaskNode);
};
