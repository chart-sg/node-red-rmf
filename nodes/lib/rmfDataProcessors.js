// Process building map from service response
function processBuildingMapFromService(buildingMap, context, updateCallback) {
  try {
    console.log('RMF: processBuildingMapFromService called');
    if (!buildingMap) {
      console.warn('RMF: No building map data received from service');
      return;
    }
    context.buildingMap = buildingMap;

    // Extract locations from all levels and graphs
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
    context.locations = locations;
    context.lastUpdated.locations = new Date().toISOString();
    if (updateCallback) {
      updateCallback();
    }
    console.log(`RMF: Extracted ${locations.length} locations from building map service`);
  } catch (error) {
    console.error('RMF: Failed to process building map from service:', error.message);
  }
}
// File: nodes/lib/rmfDataProcessors.js

function processBuildingMapData(msg, context, updateCallback) {
  try {
    console.log('RMF: processBuildingMapData called');
    console.log('RMF: Message keys:', Object.keys(msg));
    
    context.buildingMap = msg;
    
    // Extract locations from nav_graphs message
    const locations = [];
    
    // Handle direct nav_graphs structure (msg.vertices)
    if (msg.vertices && msg.vertices.length > 0) {
      console.log('RMF: Processing nav_graphs with', msg.vertices.length, 'vertices');
      
      msg.vertices.forEach(vertex => {
        if (vertex.name && vertex.name.trim()) { // Only add named vertices
          locations.push({
            name: vertex.name,
            level: msg.name || 'default', // Use graph name as level or default
            x: vertex.x,
            y: vertex.y,
            params: vertex.params || {}
          });
        }
      });
    } else {
      console.log('RMF: No vertices found in nav_graphs message');
    }
    
    context.locations = locations;
    context.lastUpdated.locations = new Date().toISOString();
    
    console.log('RMF: Extracted', locations.length, 'locations from nav_graphs');
    if (locations.length > 0) {
      console.log('RMF: Location names:', locations.map(loc => loc.name).join(', '));
    }
    
    // Update global context if callback provided
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to process nav_graphs data:', error.message);
    console.error('RMF: Nav graphs message structure:', msg);
  }
}

function processFleetStateData(msg, context, updateCallback) {
  try {
    // Store fleet state by fleet name
    context.fleetStates[msg.name] = msg;
    
    // Extract robots from fleet state
    const robots = [];
    
    if (msg.robots && msg.robots.length > 0) {
      msg.robots.forEach(robot => {
        // Find existing robot to preserve dynamic event data
        const existingRobot = context.robots.find(r => 
          r.name === robot.name && r.fleet === msg.name
        );
        
        robots.push({
          name: robot.name,
          fleet: msg.name,
          model: robot.model,
          mode: robot.mode,
          task_id: robot.task_id,
          location: robot.location,
          battery_percent: robot.battery_percent,
          status: robot.status,
          path: robot.path || [],
          last_updated: new Date().toISOString(),
          // Preserve dynamic event data if it exists
          ...(existingRobot && existingRobot.dynamic_event_seq !== undefined && {
            dynamic_event_seq: existingRobot.dynamic_event_seq,
            dynamic_event_description: existingRobot.dynamic_event_description,
            dynamic_event_start_time: existingRobot.dynamic_event_start_time,
            dynamic_event_status: existingRobot.dynamic_event_status
          })
        });
      });
    }
    
    // Update robots array (merge with existing robots from other fleets)
    context.robots = context.robots.filter(robot => robot.fleet !== msg.name);
    context.robots.push(...robots);
    context.lastUpdated.robots = new Date().toISOString();
    
    // Update global context if callback provided
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to process fleet state data:', error.message);
  }
}

function processDoorStateData(msg, context, updateCallback) {
  try {
    // Store door state by door name
    context.doorStates[msg.door_name] = msg;
    
    // Update doors array
    const existingDoorIndex = context.doors.findIndex(door => door.name === msg.door_name);
    const doorData = {
      name: msg.door_name,
      current_mode: msg.current_mode,
      door_type: msg.door_type,
      open_time: msg.open_time,
      close_time: msg.close_time,
      last_updated: new Date().toISOString()
    };
    
    if (existingDoorIndex >= 0) {
      context.doors[existingDoorIndex] = doorData;
    } else {
      context.doors.push(doorData);
    }
    
    context.lastUpdated.doors = new Date().toISOString();
    
    // Update global context if callback provided
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to process door state data:', error.message);
  }
}

function processLiftStateData(msg, context, updateCallback) {
  try {
    // Store lift state by lift name
    context.liftStates[msg.lift_name] = msg;
    
    // Update lifts array
    const existingLiftIndex = context.lifts.findIndex(lift => lift.name === msg.lift_name);
    const liftData = {
      name: msg.lift_name,
      current_floor: msg.current_floor,
      destination_floor: msg.destination_floor,
      door_state: msg.door_state,
      motion_state: msg.motion_state,
      available_floors: msg.available_floors || [],
      last_updated: new Date().toISOString()
    };
    
    if (existingLiftIndex >= 0) {
      context.lifts[existingLiftIndex] = liftData;
    } else {
      context.lifts.push(liftData);
    }
    
    context.lastUpdated.lifts = new Date().toISOString();
    
    // Update global context if callback provided
    if (updateCallback) {
      updateCallback();
    }
    
  } catch (error) {
    console.error('RMF: Failed to process lift state data:', error.message);
  }
}

module.exports = {
  processBuildingMapData,
  processBuildingMapFromService,
  processFleetStateData,
  processDoorStateData,
  processLiftStateData
};
