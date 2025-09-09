module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, validateBasicInputs, handleValidationResult } = require('../lib/rmfValidation');

  function GoToPlaceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.location_name = config.location_name;
    node.zone_type = config.zone_type;
    node.zone_preferred_waypoint = config.zone_preferred_waypoint;
    node.stubborn_period = config.stubborn_period;
    node.parallel_behaviour = config.parallel_behaviour;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[GOTO-PLACE] Setting node status: ${text}`);
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
        console.error('[GOTO-PLACE] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[GOTO-PLACE] RMF config ready, checking connection...');
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

    // Don't call updateRMFStatus() immediately - wait for rmf-ready event

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

        // Helper function to get meaningful value (not empty, undefined, null, 'all', or 'auto')
        function getMeaningfulValue(...values) {
          for (const value of values) {
            if (value && value !== '' && value !== 'all' && value !== 'auto') {
              return value;
            }
          }
          return undefined;
        }
        
        // Get configuration values (prefer RMF metadata, then payload, then direct message, then node config)
        const robotName = msg.rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name || node.robot_name;
        const robotFleet = msg.rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet || node.robot_fleet;
        const locationName = node.location_name || msg.location_name;
        
        // Zone parameters - only use if explicitly specified (not empty/undefined)
        const zoneType = getMeaningfulValue(msg.zone_type, (msg.payload && msg.payload.zone_type), node.zone_type);
        const zonePreferredWaypoint = getMeaningfulValue(msg.zone_preferred_waypoint, (msg.payload && msg.payload.zone_preferred_waypoint), node.zone_preferred_waypoint);
        
        // Debug logging for zone inputs
        console.log(`[GOTO-PLACE] Zone input processing:`, {
          nodeZoneType: node.zone_type,
          msgZoneType: msg.zone_type,
          resolvedZoneType: zoneType,
          nodeZonePreferredWaypoint: node.zone_preferred_waypoint,
          msgZonePreferredWaypoint: msg.zone_preferred_waypoint,
          resolvedZonePreferredWaypoint: zonePreferredWaypoint
        });
        const stubbornPeriod = node.stubborn_period !== undefined ? node.stubborn_period : 
                               (msg.stubborn_period !== undefined ? msg.stubborn_period : 0);
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'abort';
        
        // Extract task information from previous start-task node (prefer RMF metadata)
        const taskId = msg.rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;
        const dynamicEventSeq = msg.dynamic_event_seq || (msg.payload && msg.payload.dynamic_event_seq);

        // Validate basic inputs using shared utility
        const basicValidation = validateBasicInputs({
          robotName,
          robotFleet, 
          locationName,
          nodeType: 'GOTO-PLACE'
        });
        
        if (!handleValidationResult(basicValidation, setStatus, send, done, msg, [null, msg, null])) {
          return;
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

        // Validate location exists (check both regular locations and zones)
        const rmfData = rmfContextManager.getRMFData();
        if (!rmfData || (rmfData.locations.length === 0 && rmfData.zones.length === 0)) {
          setStatus('red', 'ring', 'No RMF data');
          msg.payload = { 
            status: 'failed', 
            reason: 'RMF context not available. Ensure RMF Config node is deployed and connected.' 
          };
          send([null, msg, null]); // Send to failed output
          return done();
        }

        // Validate robot and fleet using shared utility
        const robotValidation = validateRobotAndFleet({
          robotName,
          robotFleet,
          rmfContextManager,
          nodeType: 'GOTO-PLACE',
          skipIfEmpty: false // goto-place requires both robot and fleet
        });
        
        if (!handleValidationResult(robotValidation, setStatus, send, done, msg, [null, msg, null])) {
          return;
        }

        // Check if location is a regular waypoint
        const validatedLocation = rmfData.locations.find(l => l.name === locationName);
        // Check if location is a zone
        const validatedZone = rmfData.zones.find(z => z.name === locationName);

        console.log(`[GOTO-PLACE] Location validation for "${locationName}":`, {
          isLocation: !!validatedLocation,
          isZone: !!validatedZone,
          locationData: validatedLocation,
          zoneData: validatedZone,
          allZoneNames: rmfData.zones.map(z => z.name)
        });

        // 4) Validate location name is in available locations (waypoint or zone)
        if (locationName && !validatedLocation && !validatedZone) {
          const allLocationNames = [
            ...rmfData.locations.map(l => l.name),
            ...rmfData.zones.map(z => z.name)
          ];
          setStatus('red', 'ring', 'Invalid location');
          msg.payload = { 
            status: 'failed', 
            reason: `Location "${locationName}" not found in available locations: [${allLocationNames.join(', ')}]` 
          };
          send([null, msg, null]);
          return done();
        }

        // 5) Validate location is accessible by the specified fleet
        if (locationName && robotFleet) {
          // For regular waypoints, check if fleet can access the location
          if (validatedLocation) {
            // Check fleet compatibility - support fleets array, fleet_compatibility array, and direct fleet property
            let isFleetCompatible = false;
            let compatibleFleets = 'any';
            
            if (validatedLocation.fleets) {
              // New multi-fleet format
              isFleetCompatible = validatedLocation.fleets.includes(robotFleet);
              compatibleFleets = validatedLocation.fleets.join(', ');
            } else if (validatedLocation.fleet_compatibility) {
              // Legacy fleet_compatibility array
              isFleetCompatible = validatedLocation.fleet_compatibility.includes(robotFleet);
              compatibleFleets = validatedLocation.fleet_compatibility.join(', ');
            } else {
              // Legacy single fleet property
              isFleetCompatible = (validatedLocation.fleet === robotFleet || !validatedLocation.fleet);
              compatibleFleets = validatedLocation.fleet || 'any';
            }
              
            if (!isFleetCompatible) {
              setStatus('red', 'ring', 'Fleet cannot access location');
              msg.payload = { 
                status: 'failed', 
                reason: `Fleet "${robotFleet}" cannot access location "${locationName}". Compatible fleets: [${compatibleFleets}]` 
              };
              send([null, msg, null]);
              return done();
            }
          }
          
          // For zones, check if fleet can access the zone
          if (validatedZone) {
            // Check fleet compatibility - support fleets array, fleet_compatibility array, and direct fleet property
            let isFleetCompatible = false;
            let compatibleFleets = 'any';
            
            if (validatedZone.fleets) {
              // New multi-fleet format
              isFleetCompatible = validatedZone.fleets.includes(robotFleet);
              compatibleFleets = validatedZone.fleets.join(', ');
            } else if (validatedZone.fleet_compatibility) {
              // Legacy fleet_compatibility array
              isFleetCompatible = validatedZone.fleet_compatibility.includes(robotFleet);
              compatibleFleets = validatedZone.fleet_compatibility.join(', ');
            } else {
              // Legacy single fleet property
              isFleetCompatible = (validatedZone.fleet === robotFleet || !validatedZone.fleet);
              compatibleFleets = validatedZone.fleet || 'any';
            }
              
            if (!isFleetCompatible) {
              setStatus('red', 'ring', 'Fleet cannot access zone');
              msg.payload = { 
                status: 'failed', 
                reason: `Fleet "${robotFleet}" cannot access zone "${locationName}". Compatible fleets: [${compatibleFleets}]` 
              };
              send([null, msg, null]);
              return done();
            }
          }
        }

        // 6) If location is waypoint type, ignore zone-specific inputs
        if (validatedLocation && (msg.zone_type || msg.zone_preferred_waypoint)) {
          console.log(`[GOTO-PLACE] Warning: Location "${locationName}" is a waypoint, ignoring zone_type and zone_preferred_waypoint inputs`);
          // We don't fail here, just ignore the zone inputs for waypoints
        }

        // 7) Validate zone_type is available for the zone (skip if 'all')
        if (zoneType && zoneType !== 'all' && validatedZone) {
          // Helper function to get zone vertices (same logic as form)
          function getZoneVertices(zone) {
            return zone.vertices || zone.zone_vertices || [];
          }
          
          // Extract zone types from zone vertices placement property and map to zone types
          const zoneVertices = getZoneVertices(validatedZone);
          const placementBasedTypes = [];
          
          // Mapping from waypoint placement to zone type
          const PLACEMENT_TO_ZONE_TYPE = {
            'left': 'left',
            'right': 'right',
            'center': 'center',
            'forward': 'top',
            'backward': 'bottom'
          };
          
          zoneVertices.forEach(vertex => {
            if (vertex && vertex.placement) {
              // Map waypoint placement to zone type
              const zoneTypeFromPlacement = PLACEMENT_TO_ZONE_TYPE[vertex.placement] || vertex.placement;
              if (zoneTypeFromPlacement && zoneTypeFromPlacement !== 'all') {
                placementBasedTypes.push(zoneTypeFromPlacement);
              }
            }
          });
          
          // Remove duplicates from placement-based types
          const uniquePlacementTypes = [...new Set(placementBasedTypes)];
          
          // Add special zone types that are not placement-based
          const specialZoneTypes = ['patient_facing'];
          
          // Combine placement-based types with special types, avoiding duplicates
          const allAvailableTypes = [...uniquePlacementTypes];
          specialZoneTypes.forEach(specialType => {
            if (!allAvailableTypes.includes(specialType)) {
              allAvailableTypes.push(specialType);
            }
          });
          
          console.log(`[GOTO-PLACE] Zone type validation for zone "${locationName}":`, {
            requestedZoneType: zoneType,
            placementBasedTypes: uniquePlacementTypes,
            specialZoneTypes: specialZoneTypes,
            allAvailableTypes: allAvailableTypes,
            zoneVertices: zoneVertices,
            zoneData: validatedZone
          });
          
          if (allAvailableTypes.length === 0) {
            console.log(`[GOTO-PLACE] Warning: No zone types found for zone "${locationName}", skipping zone type validation`);
          } else if (!allAvailableTypes.includes(zoneType)) {
            setStatus('red', 'ring', 'Invalid zone type');
            msg.payload = { 
              status: 'failed', 
              reason: `Zone type "${zoneType}" not available for zone "${locationName}". Available types: [${allAvailableTypes.join(', ')}]` 
            };
            send([null, msg, null]);
            return done();
          } else {
            console.log(`[GOTO-PLACE] Zone type "${zoneType}" is valid for zone "${locationName}"`);
          }
        }

        // 8) Validate zone_preferred_waypoint is available for the zone (skip if 'auto' or empty)
        if (zonePreferredWaypoint && zonePreferredWaypoint !== 'auto' && zonePreferredWaypoint !== '' && validatedZone) {
          // Helper function to get zone vertices (same logic as form)
          function getZoneVertices(zone) {
            return zone.vertices || zone.zone_vertices || [];
          }
          
          // Get all internal waypoints for the zone
          const allInternalWaypoints = [];
          const zoneVertices = getZoneVertices(validatedZone);
          
          zoneVertices.forEach(vertex => {
            if (vertex && vertex.waypoints) {
              allInternalWaypoints.push(...vertex.waypoints);
            }
            // Also check if vertex has a name directly (it might be a waypoint itself)
            if (vertex && vertex.name && typeof vertex.name === 'string') {
              allInternalWaypoints.push(vertex.name);
            }
          });
          
          console.log(`[GOTO-PLACE] Zone waypoint validation for zone "${locationName}":`, {
            requestedWaypoint: zonePreferredWaypoint,
            allInternalWaypoints: allInternalWaypoints,
            zoneVertices: zoneVertices
          });
          
          if (!allInternalWaypoints.includes(zonePreferredWaypoint)) {
            setStatus('red', 'ring', 'Invalid zone waypoint');
            msg.payload = { 
              status: 'failed', 
              reason: `Zone preferred waypoint "${zonePreferredWaypoint}" not available for zone "${locationName}". Available waypoints: [${allInternalWaypoints.join(', ')}]` 
            };
            send([null, msg, null]);
            return done();
          }
        }
        
        // Determine if this is a zone location
        const isZoneLocation = !!validatedZone;

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
          location_type: isZoneLocation ? 'zone' : (validatedLocation.type || 'waypoint'),
          is_charger: isZoneLocation ? false : (validatedLocation.is_charger || false),
          stubborn_period: Number(stubbornPeriod),
          parallel_behaviour: parallelBehaviour,
          task_id: taskId,
          dynamic_event_seq: dynamicEventSeq
        };

        // Only add zone-related fields if this is actually a zone location
        if (isZoneLocation) {
          dynamicEventData.zone_type = zoneType;
          dynamicEventData.zone_preferred_waypoint = zonePreferredWaypoint;
        }

        // Create appropriate description payload based on location type
        if (isZoneLocation) {
          // Create zone-specific description payload
          const zoneDescription = {
            zone: locationName
          };

          console.log(`[GOTO-PLACE] Creating zone description for zone "${locationName}":`, {
            zoneType: zoneType,
            zoneTypeValid: zoneType && zoneType !== 'all',
            zonePreferredWaypoint: zonePreferredWaypoint,
            zonePreferredWaypointValid: !!zonePreferredWaypoint
          });

          // Add zone types if specified (and not 'all' which means no specific zone type)
          if (zoneType && zoneType !== 'all') {
            zoneDescription.types = [zoneType];
            console.log(`[GOTO-PLACE] Added zone type "${zoneType}" to description`);
          }

          // Add preferred waypoint if specified
          if (zonePreferredWaypoint) {
            zoneDescription.places = [{
              waypoint: zonePreferredWaypoint
            }];
            console.log(`[GOTO-PLACE] Added preferred waypoint "${zonePreferredWaypoint}" to description`);
          }

          console.log(`[GOTO-PLACE] Final zone description:`, zoneDescription);

          // Set the zone description
          dynamicEventData.description = JSON.stringify(zoneDescription);
        } else {
          // Regular waypoint description (existing behavior)
          dynamicEventData.description = JSON.stringify({ waypoint: locationName });
        }

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
            // Note: dynamic_event_seq now retrieved directly from RMF context by each node
            
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
};
