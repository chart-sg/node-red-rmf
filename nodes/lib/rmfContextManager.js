// File: nodes/lib/rmfContextManager.js
// Get rclnodejs from SharedManager (required dependency)
const ros2Bridge = require('@chart-sg/node-red-ros2-manager');
const manager = ros2Bridge.getROS2Manager();
const rclnodejs = manager.getRclnodejs();
console.log('RMF: Using @chart-sg/node-red-ros2-manager for shared ROS2 management');

const EventEmitter = require('events');

// Import the new modular components
const rmfCore = require('./rmfCore');
const rmfConnection = require('./rmfConnection');
const rmfTaskManager = require('./rmfTaskManager');
const rmfDataProcessor = require('./rmfDataProcessor');
const rmfRobotManager = require('./rmfRobotManager');
const rmfLifecycleManager = require('./rmfLifecycleManager');

// Legacy imports - keeping for compatibility (only what's actually used)
const RMFSubscriptions = require('./rmfSubscriptions');
const { SafeServiceClient } = require('./rmf-safe-service-client');

// Re-export core components for backward compatibility
const rmfEvents = rmfCore.rmfEvents;
const context = rmfCore.context;
const globalRosState = rmfCore.globalRosState;

// Persistent action client to avoid repeated creation/destruction
let persistentActionClient = null;
let actionClientPath = null;

// Delegate lifecycle management to rmfLifecycleManager
const initializeDataProcessor = rmfLifecycleManager.initializeDataProcessor;
const initializeRobotManager = rmfLifecycleManager.initializeRobotManager;
const initializeRosComponents = rmfLifecycleManager.initializeRosComponents;

// Delegate core functions to rmfCore module
const setGlobalContext = rmfCore.setGlobalContext;
const updateGlobalContext = rmfCore.updateGlobalContext;
const getRosState = rmfCore.getRosState;
const getRMFData = rmfCore.getRMFData;
const getLocations = rmfCore.getLocations;
const getRobots = rmfCore.getRobots;
const getDoors = rmfCore.getDoors;
const getLifts = rmfCore.getLifts;
const getZones = rmfCore.getZones;
const getNavGraphs = rmfCore.getNavGraphs;

// Delegate connection functions to rmfConnection module
const initROS2 = rmfConnection.initROS2;
const connectSocket = rmfConnection.connectSocket;
const debugROS2Node = rmfConnection.debugROS2Node;
const getSubscriptionStats = rmfConnection.getSubscriptionStats;
const setSubscriptionThrottleInterval = rmfConnection.setSubscriptionThrottleInterval;
const getThrottleSettings = rmfConnection.getThrottleSettings;
const forceProcessLatest = rmfConnection.forceProcessLatest;
const forceProcessAllLatest = rmfConnection.forceProcessAllLatest;
const requestBuildingMap = rmfConnection.requestBuildingMap;
const getServiceClientStatus = rmfConnection.getServiceClientStatus;

// Data processing functions - delegated to rmfDataProcessor via lifecycle manager
function validateRobotData(robot) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.validateData('robot', robot);
}

function validateLocationData(location) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.validateData('location', location);
}

function validateTaskData(task) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.validateData('task', task);
}

function processRobotData(robots) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.processRobotData(robots);
}

function processLocationData(locations) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.processLocationData(locations);
}

function processDoorStates(doorStates) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.processDoorStates(doorStates);
}

function processLiftStates(liftStates) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.processLiftStates(liftStates);
}

function processBuildingMap(buildingMap) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.processBuildingMap(buildingMap);
}

function getDataProcessingStats() {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.getProcessingStats();
}

function clearDataProcessingCache() {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.clearCache();
}

function addDataValidationRule(type, rule) {
  const processor = rmfLifecycleManager.initializeDataProcessor();
  return processor.addValidationRule(type, rule);
}

// Cleanup function - now delegated to lifecycle manager
async function cleanup() {
  console.log('RMF Context: Delegating cleanup to lifecycle manager...');
  try {
    // Clean up persistent action client first (legacy compatibility)
    if (typeof cleanupPersistentActionClient === 'function') {
      cleanupPersistentActionClient();
    }
  } catch (error) {
    console.warn('Error during persistent action client cleanup:', error);
  }
  
  // Delegate main cleanup to lifecycle manager
  await rmfLifecycleManager.cleanup();
  console.log('RMF Context: Cleanup delegation completed');
}

// Add a function to get global ROS state for debugging
// Now delegated to rmfCore module - keeping comment for reference

// Add a function to get RMF data for other nodes  
// Now delegated to rmfCore module - keeping comment for reference

// Add a function to get specific RMF data types
// Now delegated to rmfCore module - keeping comment for reference

// Get RMF subscription statistics
// Now delegated to rmfConnection module - keeping comment for reference

// Control subscription throttling  
// Now delegated to rmfConnection module - keeping comment for reference

// Method to manually request building map from service
// Now delegated to rmfConnection module - keeping comment for reference

// Soft cleanup function - delegated to lifecycle manager
async function softCleanup() {
  console.log('RMF Context: Delegating soft cleanup to lifecycle manager...');
  await rmfLifecycleManager.softCleanup();
  console.log('RMF Context: Soft cleanup delegation completed');
}

// Task management functions - delegated to rmfTaskManager
async function createRMFTask(taskData, configNode) {
  return rmfTaskManager.createRMFTask(taskData, configNode);
}

async function createTaskV2(taskRequest, configNode) {
  return rmfTaskManager.createTaskV2(taskRequest, configNode);
}

async function cancelRMFTask(taskId, configNode) {
  return rmfTaskManager.cancelRMFTask(taskId, configNode);
}

async function subscribeToTaskStatus(taskId, onStatusUpdate, configNode, options = {}) {
  return rmfTaskManager.subscribeToTaskStatus(taskId, onStatusUpdate, configNode, options);
}

async function unsubscribeFromTaskStatus(taskId) {
  return rmfTaskManager.unsubscribeFromTaskStatus(taskId);
}

// Unified sendDynamicEventGoal: edu-pattern only
/**
 * Send a cancel or end event for a dynamic event.
 * @param {'cancel'|'end'} type - Type of event to send ('cancel' or 'end')
 * @param {Object} robot - Robot context object (must have robot_name, robot_fleet, dynamic_event_seq, dynamic_event_id)
 * @param {Object} [options] - Optional callbacks for feedback/complete
 * @returns {Promise<Object>} Result from action client
 */
async function sendDynamicEventControl(type, robot, options = {}) {
  return rmfTaskManager.sendDynamicEventControl(type, robot, options);
}

async function sendDynamicEventGoal(goalData, callbacks = {}) {
  return rmfTaskManager.sendDynamicEventGoal(goalData, callbacks);
}

// Robot management functions - delegated to rmfRobotManager via lifecycle manager
function updateRobotContext(robotName, fleetName, updates) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.updateRobotContext(robotName, fleetName, updates);
}

function getRobotContext(robotName, fleetName) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getRobotByNameAndFleet(robotName, fleetName);
}

function getAllRobots() {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getAllRobots();
}

function getRobotsByFleet(fleetName) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getRobotsByFleet(fleetName);
}

function getAllFleets() {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getAllFleets();
}

function getFleetStats(fleetName) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getFleetStats(fleetName);
}

function findAvailableRobots(criteria) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.findAvailableRobots(criteria);
}

function getRobotByDynamicEventSeq(dynamicEventSeq, fleetName) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getRobotByDynamicEventSeq(dynamicEventSeq, fleetName);
}

function onRobotDiscovered(callback) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.onRobotDiscovered(callback);
}

function offRobotDiscovered(callback) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.offRobotDiscovered(callback);
}

function getRobotStateHistory(robotName, fleetName) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getRobotStateHistory(robotName, fleetName);
}

function getRobotManagerStats() {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.getManagerStats();
}

function setRobotUpdateThrottle(intervalMs) {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.setUpdateThrottle(intervalMs);
}

function clearRobotStates() {
  const manager = rmfLifecycleManager.initializeRobotManager();
  return manager.clearRobotStates();
}

// Clear active end events tracking (for cleanup or reset)
function clearActiveEndEvents() {
  return rmfTaskManager.clearActiveEndEvents();
}

// External initialization function - now delegated to lifecycle manager
async function initialize(config) {
  console.log('RMF Context: Delegating initialization to lifecycle manager...');
  const result = await rmfLifecycleManager.initialize(config);
  console.log('RMF Context: Initialization delegation completed');
  return result;
}

// Export all functions
module.exports = {
  initialize,
  context,
  initROS2,
  connectSocket,
  setGlobalContext,
  updateGlobalContext,
  cleanup,
  getRosState,
  getRMFData,
  getLocations,
  getRobots,
  getDoors,
  getLifts,
  getZones,
  getNavGraphs,
  getSubscriptionStats,
  setSubscriptionThrottleInterval,
  getThrottleSettings,
  forceProcessLatest,
  forceProcessAllLatest,
  requestBuildingMap,
  getServiceClientStatus,
  softCleanup,
  // Task management functions
  createRMFTask,
  createTaskV2,
  cancelRMFTask,
  subscribeToTaskStatus,
  unsubscribeFromTaskStatus,
  getActiveTaskSubscriptions: rmfTaskManager.getActiveTaskSubscriptions,
  cleanupAllTaskSubscriptions: rmfTaskManager.cleanupAllTaskSubscriptions,
  getTaskSubscriptionStats: rmfTaskManager.getTaskSubscriptionStats,
  sendDynamicEventGoal,
  sendDynamicEventControl,
  updateRobotContext,
  getRobotContext,
  clearActiveEndEvents,
  // Robot management functions
  getAllRobots,
  getRobotsByFleet,
  getAllFleets,
  getFleetStats,
  findAvailableRobots,
  getRobotByDynamicEventSeq,
  onRobotDiscovered,
  offRobotDiscovered,
  getRobotStateHistory,
  getRobotManagerStats,
  setRobotUpdateThrottle,
  clearRobotStates,
  // Data processing functions
  validateRobotData,
  validateLocationData,
  validateTaskData,
  processRobotData,
  processLocationData,
  processDoorStates,
  processLiftStates,
  processBuildingMap,
  getDataProcessingStats,
  clearDataProcessingCache,
  addDataValidationRule,
  debugROS2Node,
  // Lifecycle management functions
  getLifecycleState: rmfLifecycleManager.getLifecycleState,
  isSystemInitialized: rmfLifecycleManager.isInitialized,
  isSystemInitializing: rmfLifecycleManager.isInitializing,
  rmfEvents // Export the event emitter
};
