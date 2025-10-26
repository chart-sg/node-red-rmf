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
    node.orientation = config.orientation;
    node.zone_type = config.zone_type;
    node.zone_preferred_waypoints = config.zone_preferred_waypoints;
    node.zone_preferred_waypoint = config.zone_preferred_waypoint; // Legacy support
    node.zone_final_facing = config.zone_final_facing;
    node.stubborn_period = config.stubborn_period;
    node.parallel_behaviour = config.parallel_behaviour;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[GOTO-PLACE] Setting node status: ${text}`);
      node.status({ fill: fill, shape: shape, text: text });
    }
    
    // Initialize with ready status - no rmf-config dependency
    setStatus('yellow', 'ring', 'Ready');
    
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

    // No rmf-config dependency - start monitoring RMF context directly
    let rmfConfigReady = true; // Always ready since we don't wait for config
    // Start monitoring RMF status immediately
    setTimeout(updateRMFStatus, 1000);

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

    // Start monitoring RMF context status

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
        // Validate global RMF context first
        if (!rmfContextManager || !rmfContextManager.context) {
          setStatus('red', 'ring', 'No RMF context');
          msg.payload = { 
            status: 'failed', 
            reason: 'RMF context not available. Ensure an RMF Config node is deployed and connected to a start-task node.',
            error_type: 'rmf_context_missing'
          };
          send([null, msg, null]);
          return done();
        }

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
              // Handle array values (new multi-select format)
              if (Array.isArray(value)) {
                // Filter out 'all' values from array
                const filteredValues = value.filter(v => v !== 'all' && v !== 'auto' && v !== '');
                if (filteredValues.length > 0) {
                  return filteredValues;
                }
              } else {
                return value;
              }
            }
          }
          return undefined;
        }
        
        // Helper function to extract zone types from array or string
        function extractZoneTypes(zoneTypeValue) {
          if (!zoneTypeValue) return undefined;
          
          if (Array.isArray(zoneTypeValue)) {
            // New multi-select format - filter out 'all'
            const filteredTypes = zoneTypeValue.filter(type => type !== 'all' && type !== '');
            return filteredTypes.length > 0 ? filteredTypes : undefined;
          } else if (typeof zoneTypeValue === 'string' && zoneTypeValue !== 'all' && zoneTypeValue !== '') {
            // Legacy single string format
            return [zoneTypeValue];
          }
          
          return undefined;
        }
        
        // Get configuration values (prefer RMF metadata, then payload, then direct message, then node config)
        const robotName = msg.rmf_robot_name || (msg.payload && msg.payload.robot_name) || msg.robot_name || node.robot_name;
        const robotFleet = msg.rmf_robot_fleet || (msg.payload && msg.payload.robot_fleet) || msg.robot_fleet || node.robot_fleet;
        const locationName = node.location_name || msg.location_name;
        const orientation = getMeaningfulValue(msg.orientation, (msg.payload && msg.payload.orientation), node.orientation);
        
        // Zone parameters - handle both array (new format) and string (legacy format)
        console.log(`[GOTO-PLACE] Raw zone inputs:`, {
          msgZoneType: msg.zone_type,
          msgPayloadZoneType: msg.payload && msg.payload.zone_type,
          nodeZoneType: node.zone_type,
          msgZonePreferredWaypoints: msg.zone_preferred_waypoints,
          msgPayloadZonePreferredWaypoints: msg.payload && msg.payload.zone_preferred_waypoints,
          nodeZonePreferredWaypoints: node.zone_preferred_waypoints,
          msgZonePreferredWaypoint: msg.zone_preferred_waypoint,
          msgPayloadZonePreferredWaypoint: msg.payload && msg.payload.zone_preferred_waypoint,
          nodeZonePreferredWaypoint: node.zone_preferred_waypoint,
          nodeKeys: Object.keys(node)
        });
        
        const zoneTypes = extractZoneTypes(msg.zone_type || (msg.payload && msg.payload.zone_type) || node.zone_type);
        const zonePreferredWaypoints = msg.zone_preferred_waypoints || (msg.payload && msg.payload.zone_preferred_waypoints) || node.zone_preferred_waypoints;
        const zoneFinalFacing = getMeaningfulValue(msg.zone_final_facing, (msg.payload && msg.payload.zone_final_facing), node.zone_final_facing);
        
        // Legacy support for single waypoint
        const legacyZonePreferredWaypoint = getMeaningfulValue(msg.zone_preferred_waypoint, (msg.payload && msg.payload.zone_preferred_waypoint), node.zone_preferred_waypoint);
        
        // Debug logging for zone inputs
        console.log(`[GOTO-PLACE] Zone input processing:`, {
          nodeZoneType: node.zone_type,
          msgZoneType: msg.zone_type,
          resolvedZoneTypes: zoneTypes,
          nodeZonePreferredWaypoints: node.zone_preferred_waypoints,
          msgZonePreferredWaypoints: msg.zone_preferred_waypoints,
          resolvedZonePreferredWaypoints: zonePreferredWaypoints,
          nodeZoneFinalFacing: node.zone_final_facing,
          msgZoneFinalFacing: msg.zone_final_facing,
          resolvedZoneFinalFacing: zoneFinalFacing,
          legacyZonePreferredWaypoint: legacyZonePreferredWaypoint
        });
        const stubbornPeriod = node.stubborn_period !== undefined ? node.stubborn_period : 
                               (msg.stubborn_period !== undefined ? msg.stubborn_period : 0);
        const parallelBehaviour = node.parallel_behaviour || msg.parallel_behaviour || 'ignore';
        
        // Extract task information from previous start-task node (prefer RMF metadata)
        const taskId = msg.rmf_task_id || (msg.payload && msg.payload.task_id) || msg.task_id;
        const dynamicEventSeq = msg.rmf_dynamic_event_seq || msg.dynamic_event_seq || (msg.payload && msg.payload.dynamic_event_seq) || (msg.payload && msg.payload.rmf_dynamic_event_seq);

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
        if (!taskId || dynamicEventSeq === undefined || dynamicEventSeq === null) {
          setStatus('red', 'ring', 'Missing task context');
          
          // Create detailed diagnostic information
          const diagnostics = {
            taskId: {
              value: taskId,
              found: !!taskId,
              sources_checked: ['msg.rmf_task_id', 'msg.payload.task_id', 'msg.task_id']
            },
            dynamicEventSeq: {
              value: dynamicEventSeq,
              found: dynamicEventSeq !== undefined && dynamicEventSeq !== null,
              sources_checked: ['msg.rmf_dynamic_event_seq', 'msg.dynamic_event_seq', 'msg.payload.dynamic_event_seq', 'msg.payload.rmf_dynamic_event_seq']
            }
          };
          
          const missingFields = [];
          if (!taskId) missingFields.push('task_id');
          if (dynamicEventSeq === undefined || dynamicEventSeq === null) missingFields.push('dynamic_event_seq');
          
          msg.payload = { 
            status: 'failed', 
            reason: `Missing required RMF task context: ${missingFields.join(', ')}. This node should be connected after a start-task node.`,
            missing_fields: missingFields,
            diagnostics: diagnostics,
            help: 'Connect this goto-place node after a start-task node, or ensure the input message contains rmf_task_id and rmf_dynamic_event_seq properties.'
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

        // 7) Validate zone_types are available for the zone (skip if empty or contains 'all')
        if (zoneTypes && zoneTypes.length > 0 && validatedZone) {
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
          const specialZoneTypes = ['human_facing'];
          
          // Combine placement-based types with special types, avoiding duplicates
          const allAvailableTypes = [...uniquePlacementTypes];
          specialZoneTypes.forEach(specialType => {
            if (!allAvailableTypes.includes(specialType)) {
              allAvailableTypes.push(specialType);
            }
          });
          
          console.log(`[GOTO-PLACE] Zone types validation for zone "${locationName}":`, {
            requestedZoneTypes: zoneTypes,
            placementBasedTypes: uniquePlacementTypes,
            specialZoneTypes: specialZoneTypes,
            allAvailableTypes: allAvailableTypes,
            zoneVertices: zoneVertices,
            zoneData: validatedZone
          });
          
          if (allAvailableTypes.length === 0) {
            console.log(`[GOTO-PLACE] Warning: No zone types found for zone "${locationName}", skipping zone type validation`);
          } else {
            // Check if all requested zone types are valid
            const invalidTypes = zoneTypes.filter(type => !allAvailableTypes.includes(type));
            if (invalidTypes.length > 0) {
              setStatus('red', 'ring', 'Invalid zone types');
              msg.payload = { 
                status: 'failed', 
                reason: `Zone types [${invalidTypes.join(', ')}] not available for zone "${locationName}". Available types: [${allAvailableTypes.join(', ')}]` 
              };
              send([null, msg, null]);
              return done();
            } else {
              console.log(`[GOTO-PLACE] Zone types [${zoneTypes.join(', ')}] are valid for zone "${locationName}"`);
            }
          }
        }

        // 8) Validate zone_preferred_waypoints are available for the zone
        if (validatedZone) {
          let waypointsToValidate = [];
          
          // Handle new multi-waypoint format
          if (zonePreferredWaypoints && Array.isArray(zonePreferredWaypoints)) {
            waypointsToValidate = zonePreferredWaypoints.map(wp => 
              typeof wp === 'string' ? wp : wp.waypoint
            ).filter(wp => wp && wp !== 'auto' && wp !== '');
          }
          // Handle legacy single waypoint format
          else if (legacyZonePreferredWaypoint) {
            waypointsToValidate = [legacyZonePreferredWaypoint];
          }
          
          if (waypointsToValidate.length > 0) {
            // Helper function to get zone vertices (same logic as form)
            function getZoneVertices(zone) {
              return zone.vertices || zone.zone_vertices || [];
            }
            
            // Get all internal waypoints for the zone
            const allInternalWaypoints = [];
            const zoneVertices = getZoneVertices(validatedZone);
            
            zoneVertices.forEach((vertex, index) => {
              if (vertex && vertex.waypoints) {
                allInternalWaypoints.push(...vertex.waypoints);
              }
              // Also check if vertex has a name directly (it might be a waypoint itself)
              if (vertex && vertex.name && typeof vertex.name === 'string') {
                allInternalWaypoints.push(vertex.name);
              }
              // Handle different vertex structures from the zone
              if (typeof vertex === 'string') {
                allInternalWaypoints.push(vertex);
              } else if (typeof vertex === 'number') {
                // Index-based vertex - need to look up in navGraphs
                const graph = rmfData.navGraphs ? rmfData.navGraphs.find(g => 
                  g.name === validatedZone.graph || g.vertices.length > vertex
                ) : null;
                if (graph && graph.vertices[vertex]) {
                  allInternalWaypoints.push(graph.vertices[vertex].name || `vertex_${vertex}`);
                }
              }
            });
            
            console.log(`[GOTO-PLACE] Zone waypoints validation for zone "${locationName}":`, {
              requestedWaypoints: waypointsToValidate,
              allInternalWaypoints: allInternalWaypoints,
              zoneVertices: zoneVertices
            });
            
            // Validate each waypoint
            const invalidWaypoints = waypointsToValidate.filter(wp => !allInternalWaypoints.includes(wp));
            if (invalidWaypoints.length > 0) {
              setStatus('red', 'ring', 'Invalid zone waypoints');
              msg.payload = { 
                status: 'failed', 
                reason: `Zone preferred waypoints [${invalidWaypoints.join(', ')}] not available for zone "${locationName}". Available waypoints: [${allInternalWaypoints.join(', ')}]` 
              };
              send([null, msg, null]);
              return done();
            }
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
          
          if (parallelBehaviour === 'ignore') {
            // Ignore this new request, let existing event continue
            setStatus('yellow', 'ring', 'Request ignored');
            console.log(`[GOTO-PLACE] Ignoring new request due to parallel behavior: ignore (letting existing event continue)`);
            
            msg.payload = { 
              status: 'ignored', 
              reason: `Robot is busy with existing dynamic event. New request ignored due to parallel behavior: ${parallelBehaviour}`,
              rmf_robot_name: robotName,
              rmf_robot_fleet: robotFleet,
              location_name: locationName
            };
            
            // Preserve RMF metadata even for ignored requests
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
          // Store zone data in new format for internal use
          dynamicEventData.zone_types = zoneTypes;
          dynamicEventData.zone_preferred_waypoints = zonePreferredWaypoints;
          
          // Legacy support - also set old fields if single values
          if (zoneTypes && zoneTypes.length > 0) {
            // For rmfTaskManager compatibility, also set zone_type field
            dynamicEventData.zone_type = zoneTypes.length === 1 ? zoneTypes[0] : zoneTypes;
          }
          if (legacyZonePreferredWaypoint) {
            dynamicEventData.zone_preferred_waypoint = legacyZonePreferredWaypoint;
          }
          
          // Set location_type to help rmfTaskManager identify this as zone
          dynamicEventData.location_type = 'zone';
        }

        // Create appropriate description payload based on location type
        if (isZoneLocation) {
          // Create zone-specific description payload
          const zoneDescription = {
            zone: locationName
          };

          console.log(`[GOTO-PLACE] Creating zone description for zone "${locationName}":`, {
            zoneTypes: zoneTypes,
            zoneTypesValid: zoneTypes && zoneTypes.length > 0,
            zonePreferredWaypoints: zonePreferredWaypoints,
            zonePreferredWaypointsValid: zonePreferredWaypoints && zonePreferredWaypoints.length > 0,
            legacyZonePreferredWaypoint: legacyZonePreferredWaypoint,
            zoneFinalFacing: zoneFinalFacing,
            zoneFinalFacingValid: zoneFinalFacing !== undefined && zoneFinalFacing !== null && zoneFinalFacing !== ''
          });

          // Add zone types if specified (new multi-select format)
          if (zoneTypes && zoneTypes.length > 0) {
            zoneDescription.types = zoneTypes;
            console.log(`[GOTO-PLACE] Added zone types [${zoneTypes.join(', ')}] to description`);
          }

          // Add preferred waypoints if specified (new multi-waypoint format)
          if (zonePreferredWaypoints && Array.isArray(zonePreferredWaypoints) && zonePreferredWaypoints.length > 0) {
            zoneDescription.places = zonePreferredWaypoints.map(wp => {
              if (typeof wp === 'string') {
                return { waypoint: wp };
              } else if (wp.waypoint) {
                const place = { waypoint: wp.waypoint };
                if (wp.orientation !== undefined) {
                  place.orientation = wp.orientation;
                }
                return place;
              }
              return { waypoint: wp };
            });
            console.log(`[GOTO-PLACE] Added preferred waypoints to description:`, zoneDescription.places);
          }
          // Legacy support for single waypoint
          else if (legacyZonePreferredWaypoint) {
            zoneDescription.places = [{
              waypoint: legacyZonePreferredWaypoint
            }];
            console.log(`[GOTO-PLACE] Added legacy preferred waypoint "${legacyZonePreferredWaypoint}" to description`);
          }

          // Add final facing if specified
          if (zoneFinalFacing !== undefined && zoneFinalFacing !== null && zoneFinalFacing !== '') {
            zoneDescription.final_facing = parseFloat(zoneFinalFacing);
            console.log(`[GOTO-PLACE] Added final facing ${zoneDescription.final_facing} radians to description`);
          }

          console.log(`[GOTO-PLACE] Final zone description:`, zoneDescription);

          // Set the zone description as object (will be stringified by rmfTaskManager)
          dynamicEventData.description = zoneDescription;
        } else {
          // Regular waypoint description (existing behavior)
          const waypointDescription = { waypoint: locationName };
          
          // Add orientation if provided (optional parameter)
          if (orientation !== undefined && orientation !== null && orientation !== '') {
            waypointDescription.orientation = parseFloat(orientation);
            console.log(`[GOTO-PLACE] Added orientation ${waypointDescription.orientation} radians to waypoint description`);
          }
          
          dynamicEventData.description = waypointDescription;
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
              rmf_robot_name: robotName,
              rmf_robot_fleet: robotFleet,
              location_name: locationName,
              rmf_task_id: taskId,
              rmf_dynamic_event_seq: dynamicEventSeq,
              timestamp: goalResponse.timestamp || new Date().toISOString()
            };
            
            // Preserve RMF metadata for next node in chain
            msg.rmf_task_id = taskId;
            msg.rmf_robot_name = robotName;
            msg.rmf_robot_fleet = robotFleet;
            msg.rmf_dynamic_event_seq = dynamicEventSeq;
            
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
              rmf_robot_name: robotName,
              rmf_robot_fleet: robotFleet,
              location_name: locationName,
              rmf_dynamic_event_seq: dynamicEventSeq,
              timestamp: feedbackData.timestamp
            };
            
            // Preserve RMF metadata in status messages too
            statusMsg.rmf_task_id = taskId;
            statusMsg.rmf_robot_name = robotName;
            statusMsg.rmf_robot_fleet = robotFleet;
            statusMsg.rmf_dynamic_event_seq = dynamicEventSeq;
            
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
            rmf_robot_name: robotName,
            rmf_robot_fleet: robotFleet,
            location_name: locationName,
            rmf_dynamic_event_seq: dynamicEventSeq,
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
