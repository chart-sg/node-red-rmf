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
        // Check if RMF socket is connected
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          node.status({ fill: 'yellow', shape: 'ring', text: 'Waiting for RMF connection...' });
          msg.payload = { status: 'waiting', reason: 'RMF socket not connected yet' };
          send(msg);
          return done();
        }

        // Get configuration values (from node config or message)
        const robotName = node.robot_name || msg.robot_name;
        const robotFleet = node.robot_fleet || msg.robot_fleet;

        // Validate inputs
        const validationResult = await validateInputs(robotName, robotFleet);
        if (!validationResult.valid) {
          node.error(validationResult.error);
          node.status({ fill: 'red', shape: 'ring', text: validationResult.error });
          msg.payload = { status: 'error', reason: validationResult.error };
          send(msg);
          return done();
        }

        const { validatedRobot, validatedFleet } = validationResult;

        node.status({ fill: 'blue', shape: 'dot', text: 'Processing end...' });

        // Get the latest robot context to retrieve dynamic event information
        const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        if (!robotContext) {
          const error = `Robot ${robotName} from fleet ${robotFleet} not found in context`;
          node.error(error);
          node.status({ fill: 'red', shape: 'ring', text: 'Robot not found' });
          msg.payload = { status: 'error', reason: error };
          send(msg);
          return done();
        }

        node.log(`[RMF][DEBUG] Robot context for end:`, robotContext);
        node.log(`[RMF][DEBUG] Robot context dynamic_event_seq:`, robotContext.dynamic_event_seq);
        node.log(`[RMF][DEBUG] Robot context dynamic_event_status:`, robotContext.dynamic_event_status);
        node.log(`[RMF][DEBUG] Robot context keys:`, Object.keys(robotContext));

        // Check if robot has an active dynamic event
        if (!robotContext.dynamic_event_seq) {
          const error = `Robot ${robotName} has no active dynamic event (no dynamic_event_seq)`;
          node.warn(error);
          node.status({ fill: 'yellow', shape: 'ring', text: 'No active task' });
          msg.payload = { status: 'warning', reason: error };
          send(msg);
          return done();
        }

        // Check if robot is in standby state (required for end events)
        // RMF only accepts end events when robot is in "standby", not "underway"
        if (robotContext.state && robotContext.state !== 'standby') {
          const warning = `Robot ${robotName} is in "${robotContext.state}" state. End events only work when robot is in "standby" state. Use cancel-task to stop active robots.`;
          node.warn(warning);
          node.status({ fill: 'yellow', shape: 'ring', text: `Robot ${robotContext.state}, not standby` });
          msg.payload = { 
            status: 'warning', 
            reason: warning,
            robot_state: robotContext.state,
            suggestion: 'Use cancel-task node to stop active robots' 
          };
          send(msg);
          return done();
        }

        // Log diagnostic information
        node.log(`[RMF][DEBUG] Ending dynamic event for robot ${robotName}:`);
        node.log(`[RMF][DEBUG] - dynamic_event_seq: ${robotContext.dynamic_event_seq}`);
        node.log(`[RMF][DEBUG] - dynamic_event_status: ${robotContext.dynamic_event_status}`);

        try {
          // Prepare robot context with correct field names for sendDynamicEventControl
          // The function expects robot_name and robot_fleet, but our context has name and fleet
          const robotContextForEnd = {
            robot_name: robotContext.name,
            robot_fleet: robotContext.fleet,
            dynamic_event_seq: robotContext.dynamic_event_seq,
            dynamic_event_status: robotContext.dynamic_event_status
          };

          node.log(`[RMF][DEBUG] Robot context prepared for end:`, robotContextForEnd);

          // Send end event using rmfContextManager
          const endResult = await rmfContextManager.sendDynamicEventControl('end', robotContextForEnd);
          
          node.log(`[RMF][DEBUG] End result:`, endResult);

          if (endResult.success) {
            node.status({ fill: 'green', shape: 'dot', text: 'End sent successfully' });
            
            // Prepare success output payload
            const outputPayload = {
              status: 'success',
              action: 'end',
              robot_name: robotName,
              robot_fleet: robotFleet,
              dynamic_event_seq: robotContext.dynamic_event_seq,
              result: endResult,
              timestamp: new Date().toISOString()
            };

            msg.payload = outputPayload;
            send(msg);
            node.log(`[RMF][INFO] End event sent successfully for robot ${robotName}`);
            
          } else {
            const error = `Failed to send end event: ${endResult.error || 'Unknown error'}`;
            node.error(error);
            node.status({ fill: 'red', shape: 'ring', text: 'End failed' });
            
            msg.payload = { 
              status: 'error', 
              reason: error,
              robot_name: robotName,
              robot_fleet: robotFleet,
              result: endResult
            };
            send(msg);
          }

        } catch (endError) {
          const error = `Exception during end event: ${endError.message}`;
          node.error(error);
          node.status({ fill: 'red', shape: 'ring', text: 'End exception' });
          
          msg.payload = { 
            status: 'exception', 
            reason: error,
            robot_name: robotName,
            robot_fleet: robotFleet 
          };
          send(msg);
        }

        done();
        
      } catch (error) {
        node.error('Error processing end-task request: ' + error.message);
        node.status({ fill: 'red', shape: 'ring', text: 'Error: ' + error.message });
        msg.payload = { status: 'error', reason: error.message };
        send(msg);
        done(error);
      }
    });
    
    // Validation function
    async function validateInputs(robotName, robotFleet) {
      try {
        // Get RMF data
        let rmfData = rmfContextManager.getRMFData();
        
        if (!rmfData || (rmfData.robots.length === 0 && rmfData.locations.length === 0)) {
          return { valid: false, error: 'RMF context not available. Ensure RMF Config node is deployed and connected.' };
        }
        
        // Validate required fields
        if (!robotName) {
          return { valid: false, error: 'Robot name is required' };
        }
        
        if (!robotFleet) {
          return { valid: false, error: 'Robot fleet is required' };
        }
        
        // Validate robot exists
        const validatedRobot = rmfData.robots.find(r => {
          const nameMatch = r.name === robotName || r.robot_name === robotName;
          const fleetMatch = r.fleet === robotFleet || r.fleet_name === robotFleet;
          return nameMatch && fleetMatch;
        });
        
        if (!validatedRobot) {
          return { valid: false, error: `Robot "${robotName}" from fleet "${robotFleet}" not found in RMF data` };
        }
        
        // Validate fleet exists
        const validatedFleet = robotFleet;
        
        return {
          valid: true,
          validatedRobot,
          validatedFleet
        };
        
      } catch (error) {
        return { valid: false, error: 'Validation error: ' + error.message };
      }
    }
  }

  RED.nodes.registerType('end-task', EndTaskNode);
};
