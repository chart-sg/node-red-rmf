module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;

  function GoToPlaceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.location_name = config.location_name;
    node.zone_type = config.zone_type;
    node.stubborn_period = config.stubborn_period;
    node.parallel_behaviour = config.parallel_behaviour;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[GOTO-PLACE] Setting node status: ${text}`);
      node.status({ fill: fill, shape: shape, text: text });
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
          setStatus('grey', 'ring', 'Ready');
        }
      } catch (error) {
        console.error('[GOTO-PLACE] Error in updateRMFStatus:', error);
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
      let isCompleted = false; // Flag to track if goal has completed
      
      try {
        // Check RMF connection
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          setStatus('yellow', 'ring', 'Waiting for RMF connection');
          msg.payload = { 
            status: 'waiting', 
            reason: 'RMF socket not connected yet' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        // Get configuration values (prefer RMF metadata, then payload, then direct message, then node config)
        const robotName = msg.rmf_robot_name || msg._rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name || node.robot_name;
        const robotFleet = msg.rmf_robot_fleet || msg._rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet || node.robot_fleet;
        const locationName = node.location_name || msg.location_name;
        const zoneType = node.zone_type || msg.zone_type || '';
        const stubbornPeriod = node.stubborn_period !== undefined ? node.stubborn_period : 
                               (msg.stubborn_period !== undefined ? msg.stubborn_period : 0);
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'abort';
        
        // Validate parallel behaviour (queue is not supported - use multiple start-task → goto-place chains)
        if (parallelBehaviour === 'queue') {
          setStatus('red', 'ring', 'Queue not supported');
          msg.payload = { 
            status: 'failed', 
            reason: 'Queue behavior is not supported. Use multiple start-task → goto-place chains instead.' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }
        
        // Extract task information from previous start-task node (prefer RMF metadata)
        const taskId = msg.rmf_task_id || msg._rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;
        const dynamicEventSeq = msg.dynamic_event_seq || (msg.payload && msg.payload.dynamic_event_seq);

        // Validate inputs
        if (!robotName || !robotFleet || !locationName) {
          setStatus('red', 'ring', 'Missing input');
          msg.payload = { 
            status: 'failed', 
            reason: 'Robot name, fleet, and location name are required' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        // Validate that we have task information (should come from start-task node)
        if (!taskId || !dynamicEventSeq) {
          setStatus('red', 'ring', 'No task info');
          msg.payload = { 
            status: 'failed', 
            reason: 'No task_id or dynamic_event_seq found. Connect this node after start-task node.' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        // Validate location exists
        const rmfData = rmfContextManager.getRMFData();
        if (!rmfData || rmfData.locations.length === 0) {
          setStatus('red', 'ring', 'No RMF data');
          msg.payload = { 
            status: 'failed', 
            reason: 'RMF context not available. Ensure RMF Config node is deployed and connected.' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        const validatedLocation = rmfData.locations.find(l => l.name === locationName);
        if (!validatedLocation) {
          setStatus('red', 'ring', 'Location not found');
          msg.payload = { 
            status: 'failed', 
            reason: `Location "${locationName}" not found in RMF data` 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        setStatus('blue', 'dot', 'processing');

        // Check robot's current dynamic event status for parallel behavior handling
        const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        const currentStatus = robotContext?.dynamic_event_status;
        const currentEventId = robotContext?.dynamic_event_id;
        
        console.log(`[GOTO-PLACE] Robot current status: ${currentStatus}, parallel behavior: ${parallelBehaviour}`);
        
        // Handle parallel behavior if robot is currently busy with another dynamic event
        if (currentStatus === 'underway' || currentStatus === 'standby') {
          console.log(`[GOTO-PLACE] Robot is currently ${currentStatus} with event ID ${currentEventId}, applying parallel behavior: ${parallelBehaviour}`);
          
          if (parallelBehaviour === 'abort') {
            // Abort this new request, let existing event continue
            setStatus('yellow', 'ring', 'Request aborted');
            console.log(`[GOTO-PLACE] Aborting new request due to parallel behavior: abort (letting existing event continue)`);
            
            msg.payload = { 
              status: 'aborted', 
              reason: `Robot is busy with existing dynamic event. New request aborted due to parallel behavior: ${parallelBehaviour}`,
              robot_name: robotName,
              robot_fleet: robotFleet,
              location_name: locationName
            };
            
            // Preserve RMF metadata even for aborted requests
            msg.rmf_task_id = taskId;
            msg.rmf_robot_name = robotName;
            msg.rmf_robot_fleet = robotFleet;
            
            send([null, msg, null]); // Send to failed output
            return done();
            
          } else if (parallelBehaviour === 'overwrite') {
            // Cancel the current dynamic event first, then proceed with new request
            setStatus('yellow', 'dot', 'Cancelling current task');
            console.log(`[GOTO-PLACE] Cancelling current dynamic event to overwrite with new request`);
            
            try {
              const cancelResult = await rmfContextManager.sendDynamicEventControl('cancel', {
                robot_name: robotName,
                robot_fleet: robotFleet,
                dynamic_event_seq: robotContext.dynamic_event_seq,
                dynamic_event_id: currentEventId
              });
              
              if (!cancelResult.success) {
                setStatus('red', 'ring', 'Cancel failed');
                msg.payload = { 
                  status: 'failed', 
                  reason: `Failed to cancel current task for overwrite: ${cancelResult.error || 'Unknown error'}` 
                };
                send([null, msg, null]);
                return done();
              }
              
              console.log(`[GOTO-PLACE] Current dynamic event cancelled successfully, proceeding with new request`);
              // Small delay to let the cancellation complete
              await new Promise(resolve => setTimeout(resolve, 100));
              
            } catch (error) {
              setStatus('red', 'ring', 'Cancel error');
              msg.payload = { 
                status: 'failed', 
                reason: `Error cancelling current task for overwrite: ${error.message}` 
              };
              send([null, msg, null]);
              return done();
            }
            
          } else {
            // This shouldn't happen as we validate parallel_behaviour earlier, but just in case
            setStatus('red', 'ring', 'Invalid parallel behavior');
            msg.payload = { 
              status: 'failed', 
              reason: `Unsupported parallel behavior: ${parallelBehaviour}` 
            };
            send([null, msg, null]);
            return done();
          }
        }

        setStatus('blue', 'dot', 'processing');

        // Prepare RMF data for dynamic event goal
        const dynamicEventData = {
          robot_name: robotName,
          robot_fleet: robotFleet,
          location_name: locationName,
          location_type: validatedLocation.type || 'waypoint',
          is_charger: validatedLocation.is_charger || false,
          zone_type: zoneType,
          stubborn_period: Number(stubbornPeriod),
          parallel_behaviour: parallelBehaviour,
          task_id: taskId,
          dynamic_event_seq: dynamicEventSeq
        };

        // Set up callbacks for goal completion and feedback
        const goalCallbacks = {
          onGoalComplete: (goalResponse) => {
            isCompleted = true; // Mark as completed to prevent status override
            console.log(`[GOTO-PLACE COMPLETION] Callback called with:`, goalResponse);
            
            // Set status based on goal response
            if (goalResponse.status === 'completed') {
              setStatus('green', 'dot', 'completed');
            } else if (goalResponse.status === 'failed') {
              setStatus('red', 'ring', 'failed');
            } else if (goalResponse.status === 'cancelled' || goalResponse.status === 'canceled') {
              setStatus('yellow', 'ring', 'cancelled');
            }
            
            // Prepare output message
            msg.payload = {
              status: goalResponse.status,
              success: goalResponse.success,
              robot_name: robotName,
              robot_fleet: robotFleet,
              location_name: locationName,
              task_id: taskId,
              timestamp: goalResponse.timestamp || new Date().toISOString()
            };
            
            // Preserve RMF metadata for next node in chain
            msg.rmf_task_id = taskId;
            msg.rmf_robot_name = robotName;
            msg.rmf_robot_fleet = robotFleet;
            
            // Send to appropriate output
            if (goalResponse.success && goalResponse.status === 'completed') {
              console.log('[GOTO-PLACE COMPLETION] Sending success output');
              send([msg, null, null]); // Success output
            } else {
              console.log('[GOTO-PLACE COMPLETION] Sending failure output');
              send([null, msg, null]); // Failed output
            }
            
            done();
          },
          
          onFeedback: (feedbackData) => {
            console.log(`[GOTO-PLACE FEEDBACK] Received: ${feedbackData.status}`);
            
            // Set status based on feedback
            if (feedbackData.status === 'underway') {
              setStatus('blue', 'dot', 'underway');
            } else if (feedbackData.status === 'completed') {
              setStatus('green', 'dot', 'completed');
            } else if (feedbackData.status === 'failed') {
              setStatus('red', 'ring', 'failed');
            }
            
            // Send status to output 3
            const statusMsg = { ...msg };
            statusMsg.payload = {
              status: feedbackData.status,
              robot_name: robotName,
              robot_fleet: robotFleet,
              location_name: locationName,
              timestamp: feedbackData.timestamp
            };
            
            // Preserve RMF metadata in status messages too
            statusMsg.rmf_task_id = taskId;
            statusMsg.rmf_robot_name = robotName;
            statusMsg.rmf_robot_fleet = robotFleet;
            
            send([null, null, statusMsg]);
          }
        };
        
        // Send dynamic event goal
        const actionResult = await rmfContextManager.sendDynamicEventGoal(dynamicEventData, goalCallbacks);

        console.log('[GOTO-PLACE] Action result received:', actionResult);

        if (!actionResult.success) {
          const errorMsg = actionResult.error || 'Unknown error';
          setStatus('red', 'ring', 'failed');
          msg.payload = { 
            status: 'failed', 
            reason: `Goal sending failed: ${errorMsg}` 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        console.log('[GOTO-PLACE] Dynamic event goal sent successfully');

        // Only set underway status if goal hasn't completed yet
        if (!isCompleted) {
          // Set initial status to underway
          setStatus('blue', 'dot', 'underway');

          // Send initial status update
          const statusMsg = { ...msg };
          statusMsg.payload = {
            status: 'underway',
            robot_name: robotName,
            robot_fleet: robotFleet,
            location_name: locationName,
            timestamp: new Date().toISOString()
          };
          send([null, null, statusMsg]); // Send to status output
        }

        // Note: Don't call done() here - let the onGoalComplete callback handle completion

      } catch (error) {
        setStatus('red', 'ring', 'error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send([null, msg, null]); // Send to failed output
        done(error);
      }
    });
  }

  RED.nodes.registerType('goto-place', GoToPlaceNode, {
    outputs: 3  // Success, Failed, Status
  });
  
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
