// File: nodes/lib/rmfMessageTransformers.js
// RMF Message Transformers - Convert ROS2 message formats to internal context structures

/**
 * Transform building map service response to internal context format
 * @param {Object} buildingMap - RMF building map from service response
 * @param {Object} context - Internal context to update
 * @param {Function} updateCallback - Optional callback after transformation
 */
function transformBuildingMapFromService(buildingMap, context, updateCallback) {
  try {
    console.log('RMF: Transforming building map from service...');
    if (!buildingMap) {
      console.warn('RMF: No building map data received from service');
      return;
    }
    
    // Store the raw building map
    context.buildingMap = buildingMap;

    // Extract and transform locations from all levels and navigation graphs
    const locations = [];
    if (buildingMap.levels && Array.isArray(buildingMap.levels)) {
      buildingMap.levels.forEach(level => {
        if (level.nav_graphs && Array.isArray(level.nav_graphs)) {
          level.nav_graphs.forEach(graph => {
            if (graph.vertices && Array.isArray(graph.vertices)) {
              graph.vertices.forEach(vertex => {
                if (vertex.name && vertex.name.trim()) {
                  locations.push({
                    name: vertex.name,
                    level: level.name || 'unknown',
                    x: vertex.x,
                    y: vertex.y,
                    params: vertex.params || {}
                  });
                }
              });
            }
          });
        }
      });
    }
    
    // Update context with transformed data
    context.locations = locations;
    context.lastUpdated.locations = new Date().toISOString();
    
    if (updateCallback) {
      updateCallback();
    }
    
    console.log(`RMF: Transformed ${locations.length} locations from building map service`);
  } catch (error) {
    console.error('RMF: Failed to transform building map from service:', error.message);
  }
}

/**
 * Transform navigation graphs message to internal context format
 * @param {Object} navGraphsMsg - ROS2 navigation graphs message
 * @param {Object} context - Internal context to update
 * @param {Function} updateCallback - Optional callback after transformation
 */
function transformNavigationGraphs(navGraphsMsg, context, updateCallback) {
  try {
    console.log('RMF: Transforming navigation graphs message...');
    console.log('RMF: Message keys:', Object.keys(navGraphsMsg));
    
    // Store the raw message
    context.buildingMap = navGraphsMsg;
    
    // Extract and transform locations from navigation graphs
    const locations = [];
    
    // Handle direct nav_graphs structure (msg.vertices)
    if (navGraphsMsg.vertices && navGraphsMsg.vertices.length > 0) {
      console.log('RMF: Processing nav_graphs with', navGraphsMsg.vertices.length, 'vertices');
      
      navGraphsMsg.vertices.forEach(vertex => {
        if (vertex.name && vertex.name.trim()) { // Only add named vertices
          locations.push({
            name: vertex.name,
            level: navGraphsMsg.name || 'default', // Use graph name as level or default
            x: vertex.x,
            y: vertex.y,
            params: vertex.params || {}
          });
        }
      });
    } else {
      console.log('RMF: No vertices found in nav_graphs message');
    }
    
    // Update context with transformed data
    context.locations = locations;
    context.lastUpdated.locations = new Date().toISOString();
    
    console.log('RMF: Transformed', locations.length, 'locations from nav_graphs');
    if (locations.length > 0) {
      console.log('RMF: Location names:', locations.map(loc => loc.name).join(', '));
    }
    
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to transform nav_graphs data:', error.message);
    console.error('RMF: Nav graphs message structure:', navGraphsMsg);
  }
}

/**
 * Transform fleet state message to internal context format
 * @param {Object} fleetStateMsg - ROS2 fleet state message
 * @param {Object} context - Internal context to update
 * @param {Function} updateCallback - Optional callback after transformation
 */
function transformFleetState(fleetStateMsg, context, updateCallback) {
  try {
    // Store raw fleet state by fleet name
    context.fleetStates[fleetStateMsg.name] = fleetStateMsg;
    
    // Transform robots from fleet state message
    const transformedRobots = [];
    
    if (fleetStateMsg.robots && fleetStateMsg.robots.length > 0) {
      fleetStateMsg.robots.forEach(robotMsg => {
        // Find existing robot to preserve dynamic event data
        const existingRobot = context.robots.find(r => 
          r.name === robotMsg.name && r.fleet === fleetStateMsg.name
        );
        
        // Transform robot message to internal format
        const transformedRobot = {
          name: robotMsg.name,
          fleet: fleetStateMsg.name,
          model: robotMsg.model,
          mode: robotMsg.mode,
          task_id: robotMsg.task_id,
          location: robotMsg.location,
          battery_percent: robotMsg.battery_percent,
          status: robotMsg.status,
          path: robotMsg.path || [],
          last_updated: new Date().toISOString()
        };
        
        // Preserve dynamic event data if it exists from previous updates
        if (existingRobot && existingRobot.dynamic_event_seq !== undefined) {
          transformedRobot.dynamic_event_seq = existingRobot.dynamic_event_seq;
          transformedRobot.dynamic_event_description = existingRobot.dynamic_event_description;
          transformedRobot.dynamic_event_start_time = existingRobot.dynamic_event_start_time;
          transformedRobot.dynamic_event_status = existingRobot.dynamic_event_status;
          transformedRobot.dynamic_event_id = existingRobot.dynamic_event_id;
        }
        
        transformedRobots.push(transformedRobot);
      });
    }
    
    // Update context: replace robots from this fleet with transformed data
    context.robots = context.robots.filter(robot => robot.fleet !== fleetStateMsg.name);
    context.robots.push(...transformedRobots);
    context.lastUpdated.robots = new Date().toISOString();
    
    // Trigger robot manager processing for mode change detection
    try {
      // Get the robot manager through the require path (same as context manager)
      const rmfLifecycleManager = require('./rmfLifecycleManager');
      const robotManager = rmfLifecycleManager.initializeRobotManager();
      
      if (robotManager) {
        // Only process if there are active callbacks (i.e., goto-place tasks running)
        if (robotManager.robotModeChangeCallbacks.size > 0) {
          // Check if any robot modes have actually changed before processing
          const hasSignificantChanges = transformedRobots.some(robot => {
            const robotKey = `${robot.fleet}:${robot.name}`;
            const currentMode = robot.mode?.mode;
            const lastKnownMode = robotManager.previousRobotModes?.get(robotKey);
            return currentMode !== lastKnownMode;
          });
          
          if (hasSignificantChanges) {
            console.log(`[DEBUG] 🔄 [FLEET STATE] Mode changes detected - processing ${transformedRobots.length} robots`);
            robotManager.processRobotUpdates(transformedRobots);
          }
          // If no changes, skip processing entirely to avoid spin failures
        }
      }
    } catch (error) {
      console.error('[DEBUG] ❌ [FLEET STATE] Failed to process robots through robot manager:', error.message);
    }
    
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to transform fleet state data:', error.message);
  }
}

/**
 * Transform door state message to internal context format
 * @param {Object} doorStateMsg - ROS2 door state message
 * @param {Object} context - Internal context to update
 * @param {Function} updateCallback - Optional callback after transformation
 */
function transformDoorState(doorStateMsg, context, updateCallback) {
  try {
    // Store raw door state by door name
    context.doorStates[doorStateMsg.door_name] = doorStateMsg;
    
    // Transform door message to internal format
    const transformedDoor = {
      name: doorStateMsg.door_name,
      current_mode: doorStateMsg.current_mode,
      door_type: doorStateMsg.door_type,
      open_time: doorStateMsg.open_time,
      close_time: doorStateMsg.close_time,
      last_updated: new Date().toISOString()
    };
    
    // Update context: replace or add door
    const existingDoorIndex = context.doors.findIndex(door => door.name === doorStateMsg.door_name);
    if (existingDoorIndex >= 0) {
      context.doors[existingDoorIndex] = transformedDoor;
    } else {
      context.doors.push(transformedDoor);
    }
    
    context.lastUpdated.doors = new Date().toISOString();
    
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to transform door state data:', error.message);
  }
}

/**
 * Transform lift state message to internal context format
 * @param {Object} liftStateMsg - ROS2 lift state message
 * @param {Object} context - Internal context to update
 * @param {Function} updateCallback - Optional callback after transformation
 */
function transformLiftState(liftStateMsg, context, updateCallback) {
  try {
    // Store raw lift state by lift name
    context.liftStates[liftStateMsg.lift_name] = liftStateMsg;
    
    // Transform lift message to internal format
    const transformedLift = {
      name: liftStateMsg.lift_name,
      current_floor: liftStateMsg.current_floor,
      destination_floor: liftStateMsg.destination_floor,
      door_state: liftStateMsg.door_state,
      motion_state: liftStateMsg.motion_state,
      available_floors: liftStateMsg.available_floors || [],
      last_updated: new Date().toISOString()
    };
    
    // Update context: replace or add lift
    const existingLiftIndex = context.lifts.findIndex(lift => lift.name === liftStateMsg.lift_name);
    if (existingLiftIndex >= 0) {
      context.lifts[existingLiftIndex] = transformedLift;
    } else {
      context.lifts.push(transformedLift);
    }
    
    context.lastUpdated.lifts = new Date().toISOString();
    
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to transform lift state data:', error.message);
  }
}

module.exports = {
  // Main transformation functions
  transformBuildingMapFromService,
  transformNavigationGraphs,
  transformFleetState,
  transformDoorState,
  transformLiftState,
  
  // Legacy aliases for backward compatibility (to be removed after migration)
  processBuildingMapFromService: transformBuildingMapFromService,
  processBuildingMapData: transformNavigationGraphs,
  processFleetStateData: transformFleetState,
  processDoorStateData: transformDoorState,
  processLiftStateData: transformLiftState
};
