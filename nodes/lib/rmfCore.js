// File: nodes/lib/rmfCore.js
const EventEmitter = require('events');

// Event emitter for RMF context events
const rmfEvents = new EventEmitter();

// Global ROS state - shared across all nodes
let globalRosState = {
  isInitializing: false,
  isInitialized: false,
  initPromise: null,
  error: null
};

// Central RMF context storage
let context = {
  socket: null,
  rosInitialized: false,
  node: null,
  robots: [],
  locations: [],
  doors: [],
  lifts: [],
  zones: [],
  navGraphs: [],
  buildingMap: null,
  fleetStates: {},
  doorStates: {},
  liftStates: {},
  subscribers: {},
  taskSubscriptions: {},
  lastUpdated: {
    locations: null,
    robots: null,
    doors: null,
    lifts: null,
    zones: null,
    navGraphs: null
  }
};

// Store reference to global context for updates
let globalContext = null;

/**
 * Set the global Node-RED context reference
 * @param {Object} globalCtx - Node-RED global context
 */
function setGlobalContext(globalCtx) {
  globalContext = globalCtx;
  globalContext.set('rmf_global', context);
}

/**
 * Update global context when data changes
 */
function updateGlobalContext() {
  if (globalContext) {
    globalContext.set('rmf_global', context);
  }
}

/**
 * Get global ROS state for debugging
 * @returns {Object} Current ROS state information
 */
function getRosState() {
  return {
    globalState: globalRosState,
    contextState: {
      rosInitialized: context.rosInitialized,
      hasNode: !!context.node,
      hasSocket: !!context.socket,
      robotCount: context.robots.length,
      locationCount: context.locations.length
    }
  };
}

/**
 * Get complete RMF data for other nodes
 * @returns {Object} All RMF data including robots, locations, doors, lifts, etc.
 */
function getRMFData() {
  return {
    locations: context.locations,
    robots: context.robots,
    doors: context.doors,
    lifts: context.lifts,
    zones: context.zones,
    navGraphs: context.navGraphs,
    buildingMap: context.buildingMap,
    fleetStates: context.fleetStates,
    doorStates: context.doorStates,
    liftStates: context.liftStates,
    lastUpdated: context.lastUpdated
  };
}

/**
 * Get specific RMF data types
 */

function getLocations() {
  return context.locations;
}

function getRobots() {
  return context.robots;
}

function getDoors() {
  return context.doors;
}

function getLifts() {
  return context.lifts;
}

function getBuildingMap() {
  return context.buildingMap;
}

function getFleetStates() {
  return context.fleetStates;
}

function getDoorStates() {
  return context.doorStates;
}

function getLiftStates() {
  return context.liftStates;
}

function getZones() {
  return context.zones;
}

function getNavGraphs() {
  return context.navGraphs;
}

function getLastUpdated() {
  return context.lastUpdated;
}

/**
 * Update specific parts of the RMF context
 * @param {string} dataType - Type of data to update (robots, locations, etc.)
 * @param {*} newData - New data to set
 */
function updateContextData(dataType, newData) {
  if (context.hasOwnProperty(dataType)) {
    context[dataType] = newData;
    
    // Update timestamp for trackable data types
    if (context.lastUpdated.hasOwnProperty(dataType)) {
      context.lastUpdated[dataType] = new Date().toISOString();
    }
    
    // Notify global context of changes
    updateGlobalContext();
    
    // Emit data update event
    rmfEvents.emit('data_updated', { dataType, newData });
    
    return { success: true };
  } else {
    return { success: false, error: `Unknown data type: ${dataType}` };
  }
}

/**
 * Clear all context data (used during cleanup)
 */
function clearContextData() {
  context.robots = [];
  context.locations = [];
  context.doors = [];
  context.lifts = [];
  context.buildingMap = null;
  context.fleetStates = {};
  context.doorStates = {};
  context.liftStates = {};
  context.subscribers = {};
  context.taskSubscriptions = {};
  context.lastUpdated = {
    locations: null,
    robots: null,
    doors: null,
    lifts: null
  };
  
  // Notify global context of changes
  updateGlobalContext();
  
  // Emit data cleared event
  rmfEvents.emit('data_cleared');
}

/**
 * Get context statistics for monitoring
 * @returns {Object} Context statistics
 */
function getContextStats() {
  return {
    robots: context.robots.length,
    locations: context.locations.length,
    doors: context.doors.length,
    lifts: context.lifts.length,
    fleets: Object.keys(context.fleetStates).length,
    subscribers: Object.keys(context.subscribers).length,
    taskSubscriptions: Object.keys(context.taskSubscriptions).length,
    hasSocket: !!context.socket,
    hasNode: !!context.node,
    rosInitialized: context.rosInitialized,
    lastUpdated: context.lastUpdated
  };
}

// Export all functions and references
module.exports = {
  // Core references
  context,
  globalRosState,
  rmfEvents,
  
  // Global context management
  setGlobalContext,
  updateGlobalContext,
  
  // State and data getters
  getRosState,
  getRMFData,
  getLocations,
  getRobots,
  getDoors,
  getLifts,
  getBuildingMap,
  getFleetStates,
  getDoorStates,
  getLiftStates,
  getZones,
  getNavGraphs,
  getLastUpdated,
  
  // Data management
  updateContextData,
  clearContextData,
  getContextStats
};
