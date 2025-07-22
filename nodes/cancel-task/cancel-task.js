module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;

  function CancelTaskNode(config) {
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

        node.status({ fill: 'blue', shape: 'dot', text: 'Processing cancel...' });

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

        node.log(`[RMF][DEBUG] Robot context for cancel:`, robotContext);
        node.log(`[RMF][DEBUG] Robot context dynamic_event_id:`, robotContext.dynamic_event_id, typeof robotContext.dynamic_event_id);
        node.log(`[RMF][DEBUG] Robot context keys:`, Object.keys(robotContext));
        
        // Let's also check the raw rmfContextManager context to see if the data is there
        const rawContext = rmfContextManager.context;
        const rawRobot = rawContext.robots.find(r => r.name === robotName && r.fleet === robotFleet);
        node.log(`[RMF][DEBUG] Raw robot from rmfContextManager.context:`, rawRobot);
        if (rawRobot) {
          node.log(`[RMF][DEBUG] Raw robot dynamic_event_id:`, rawRobot.dynamic_event_id, typeof rawRobot.dynamic_event_id);
          node.log(`[RMF][DEBUG] Raw robot keys:`, Object.keys(rawRobot));
        }

        // Check if robot has an active dynamic event
        if (!robotContext.dynamic_event_seq) {
          const error = `Robot ${robotName} has no active dynamic event (no dynamic_event_seq)`;
          node.warn(error);
          node.status({ fill: 'yellow', shape: 'ring', text: 'No active task' });
          msg.payload = { status: 'warning', reason: error };
          send(msg);
          return done();
        }

        if (!robotContext.dynamic_event_id) {
          // Try to wait a bit and check again - there might be a race condition with context updates
          node.log(`[RMF][DEBUG] dynamic_event_id missing, waiting 500ms and retrying...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          
          const retryRobotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
          node.log(`[RMF][DEBUG] Retry robot context:`, retryRobotContext);
          node.log(`[RMF][DEBUG] Retry robot context dynamic_event_id:`, retryRobotContext?.dynamic_event_id, typeof retryRobotContext?.dynamic_event_id);
          
          // Also check the raw context again after retry
          const retryRawContext = rmfContextManager.context;
          const retryRawRobot = retryRawContext.robots.find(r => r.name === robotName && r.fleet === robotFleet);
          node.log(`[RMF][DEBUG] Retry raw robot from rmfContextManager.context:`, retryRawRobot);
          if (retryRawRobot) {
            node.log(`[RMF][DEBUG] Retry raw robot dynamic_event_id:`, retryRawRobot.dynamic_event_id, typeof retryRawRobot.dynamic_event_id);
          }
          
          if (retryRobotContext && retryRobotContext.dynamic_event_id) {
            // Update robotContext with the retry result
            Object.assign(robotContext, retryRobotContext);
            node.log(`[RMF][DEBUG] Successfully retrieved dynamic_event_id on retry: ${robotContext.dynamic_event_id}`);
          } else {
            const error = `Robot ${robotName} has no dynamic_event_id for cancel operation (even after retry)`;
            node.error(error);
            node.status({ fill: 'red', shape: 'ring', text: 'Missing event ID' });
            msg.payload = { status: 'error', reason: error };
            send(msg);
            return done();
          }
        }

        // Log diagnostic information
        node.log(`[RMF][DEBUG] Canceling dynamic event for robot ${robotName}:`);
        node.log(`[RMF][DEBUG] - dynamic_event_seq: ${robotContext.dynamic_event_seq}`);
        node.log(`[RMF][DEBUG] - dynamic_event_id: ${robotContext.dynamic_event_id}`);
        node.log(`[RMF][DEBUG] - dynamic_event_status: ${robotContext.dynamic_event_status}`);

        try {
          // Prepare robot context with correct field names for sendDynamicEventControl
          // The function expects robot_name and robot_fleet, but our context has name and fleet
          const robotContextForCancel = {
            robot_name: robotContext.name,
            robot_fleet: robotContext.fleet,
            dynamic_event_seq: robotContext.dynamic_event_seq,
            dynamic_event_id: robotContext.dynamic_event_id,
            dynamic_event_status: robotContext.dynamic_event_status
          };

          node.log(`[RMF][DEBUG] Robot context prepared for cancel:`, robotContextForCancel);

          // Send cancel event using rmfContextManager
          const cancelResult = await rmfContextManager.sendDynamicEventControl('cancel', robotContextForCancel);
          
          node.log(`[RMF][DEBUG] Cancel result:`, cancelResult);

          if (cancelResult.success) {
            node.status({ fill: 'green', shape: 'dot', text: 'Cancel sent successfully' });
            
            // Prepare success output payload
            const outputPayload = {
              status: 'success',
              action: 'cancel',
              robot_name: robotName,
              robot_fleet: robotFleet,
              dynamic_event_seq: robotContext.dynamic_event_seq,
              dynamic_event_id: robotContext.dynamic_event_id,
              result: cancelResult,
              timestamp: new Date().toISOString()
            };

            msg.payload = outputPayload;
            send(msg);
            node.log(`[RMF][INFO] Cancel event sent successfully for robot ${robotName}`);
            
          } else {
            const error = `Failed to send cancel event: ${cancelResult.error || 'Unknown error'}`;
            node.error(error);
            node.status({ fill: 'red', shape: 'ring', text: 'Cancel failed' });
            
            msg.payload = { 
              status: 'error', 
              reason: error,
              robot_name: robotName,
              robot_fleet: robotFleet,
              result: cancelResult
            };
            send(msg);
          }

        } catch (cancelError) {
          const error = `Exception during cancel event: ${cancelError.message}`;
          node.error(error);
          node.status({ fill: 'red', shape: 'ring', text: 'Cancel exception' });
          
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
        node.error('Error processing cancel-task request: ' + error.message);
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

  RED.nodes.registerType('cancel-task', CancelTaskNode);
};
