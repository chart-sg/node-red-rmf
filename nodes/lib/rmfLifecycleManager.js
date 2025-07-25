// File: nodes/lib/rmfLifecycleManager.js
// RMF Lifecycle Manager: Centralized initialization and cleanup orchestration

const rmfCore = require('./rmfCore');
const rmfConnection = require('./rmfConnection');
const rmfTaskManager = require('./rmfTaskManager');
const rmfDataProcessor = require('./rmfDataProcessor');
const rmfRobotManager = require('./rmfRobotManager');

// Legacy imports for backward compatibility
const RMFRosInitializer = require('./rmfRosInitializer');
const RMFSubscriptions = require('./rmfSubscriptions');

// State tracking for all managed components
let lifecycleState = {
  rosInitializer: null,
  subscriptionsManager: null,
  dataProcessor: null,
  robotManager: null,
  isInitialized: false,
  isInitializing: false,
  initializationOrder: []
};

/**
 * Initialize the data processor with proper dependency injection
 * @returns {Object} Data processor instance
 */
function initializeDataProcessor() {
  if (!lifecycleState.dataProcessor) {
    console.log('RMF Lifecycle: Initializing data processor...');
    lifecycleState.dataProcessor = new rmfDataProcessor(rmfCore, rmfConnection);
    lifecycleState.initializationOrder.push('dataProcessor');
    console.log('RMF: Data processor initialized');
  }
  return lifecycleState.dataProcessor;
}

/**
 * Initialize the robot manager with proper dependency chain
 * @returns {Object} Robot manager instance
 */
function initializeRobotManager() {
  if (!lifecycleState.robotManager) {
    console.log('RMF Lifecycle: Initializing robot manager...');
    
    // Ensure data processor is available first
    const processor = initializeDataProcessor();
    
    // Create robot manager with dependencies
    lifecycleState.robotManager = new rmfRobotManager(rmfCore, rmfConnection, processor);
    
    // Set up robot context provider for task manager
    rmfTaskManager.setRobotContextProvider({
      updateRobotContext: (robotName, fleetName, updates) => 
        lifecycleState.robotManager.updateRobotContext(robotName, fleetName, updates),
      getRobotContext: (robotName, fleetName) => 
        lifecycleState.robotManager.getRobotByNameAndFleet(robotName, fleetName)
    });
    
    lifecycleState.initializationOrder.push('robotManager');
    console.log('RMF: Robot manager initialized');
  }
  return lifecycleState.robotManager;
}

/**
 * Initialize ROS components (ROS initializer and subscriptions)
 * @returns {Object} Initialization result
 */
function initializeRosComponents() {
  if (!lifecycleState.rosInitializer) {
    console.log('RMF Lifecycle: Initializing ROS components...');
    
    lifecycleState.rosInitializer = new RMFRosInitializer();
    lifecycleState.subscriptionsManager = new RMFSubscriptions();
    
    lifecycleState.initializationOrder.push('rosComponents');
    console.log('RMF: ROS components initialized');
  }
  
  return {
    rosInitializer: lifecycleState.rosInitializer,
    subscriptionsManager: lifecycleState.subscriptionsManager
  };
}

/**
 * Complete RMF system initialization with proper dependency ordering
 * @param {Object} config - Configuration object
 * @returns {Promise<Object>} Initialization result
 */
async function initialize(config = {}) {
  if (lifecycleState.isInitializing) {
    console.log('RMF Lifecycle: Initialization already in progress...');
    return { success: false, error: 'Initialization already in progress' };
  }
  
  if (lifecycleState.isInitialized) {
    console.log('RMF Lifecycle: System already initialized');
    return { success: true, message: 'System already initialized' };
  }
  
  lifecycleState.isInitializing = true;
  
  try {
    console.log('RMF Lifecycle: Starting system initialization...');
    
    // Step 1: Set ROS domain ID if provided
    if (config.domainId) {
      process.env.RCLNODEJS_ROS_DOMAIN_ID = config.domainId;
      console.log(`RMF Lifecycle: Set ROS domain ID to ${config.domainId}`);
    }
    
    // Step 2: Initialize core ROS2 connection
    console.log('RMF Lifecycle: Initializing ROS2 connection...');
    await rmfConnection.initROS2();
    lifecycleState.initializationOrder.push('ros2Connection');
    
    // Step 3: Initialize data processor (needed by robot manager)
    initializeDataProcessor();
    
    // Step 4: Initialize robot manager (depends on data processor)
    initializeRobotManager();
    
    // Step 5: Initialize legacy ROS components if needed
    initializeRosComponents();
    
    // Step 6: Connect socket if configuration provided
    if (config.host && config.port) {
      console.log('RMF Lifecycle: Connecting to RMF socket...');
      await rmfConnection.connectSocket({
        host: config.host,
        port: config.port,
        jwt: config.jwt
      });
      lifecycleState.initializationOrder.push('socketConnection');
    }
    
    lifecycleState.isInitialized = true;
    lifecycleState.isInitializing = false;
    
    console.log('RMF Lifecycle: System initialization completed successfully');
    console.log('RMF Lifecycle: Initialization order:', lifecycleState.initializationOrder);
    
    return {
      success: true,
      message: 'RMF system initialized successfully',
      components: lifecycleState.initializationOrder
    };
    
  } catch (error) {
    lifecycleState.isInitializing = false;
    console.error('RMF Lifecycle: Initialization failed:', error.message);
    
    // Attempt cleanup on failed initialization
    await cleanup();
    
    return {
      success: false,
      error: error.message,
      components: lifecycleState.initializationOrder
    };
  }
}

/**
 * Comprehensive system cleanup with proper dependency ordering
 * @returns {Promise<void>}
 */
async function cleanup() {
  console.log('RMF Lifecycle: Starting system cleanup...');
  
  try {
    // Step 1: Clean up task subscriptions first
    console.log('RMF Lifecycle: Cleaning up task subscriptions...');
    await rmfTaskManager.cleanupAllTaskSubscriptions();
    console.log('RMF Lifecycle: Task subscriptions cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: Task subscription cleanup failed:', error);
  }
  
  try {
    // Step 2: Clean up robot manager
    console.log('RMF Lifecycle: Cleaning up robot manager...');
    if (lifecycleState.robotManager) {
      lifecycleState.robotManager.cleanup();
      lifecycleState.robotManager = null;
    }
    console.log('RMF Lifecycle: Robot manager cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: Robot manager cleanup failed:', error);
  }
  
  try {
    // Step 3: Clean up data processor
    console.log('RMF Lifecycle: Cleaning up data processor...');
    if (lifecycleState.dataProcessor) {
      lifecycleState.dataProcessor.cleanup();
      lifecycleState.dataProcessor = null;
    }
    console.log('RMF Lifecycle: Data processor cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: Data processor cleanup failed:', error);
  }
  
  try {
    // Step 4: Clean up ROS subscriptions
    console.log('RMF Lifecycle: Cleaning up ROS subscriptions...');
    if (lifecycleState.subscriptionsManager) {
      if (typeof lifecycleState.subscriptionsManager.cleanup === 'function') {
        lifecycleState.subscriptionsManager.cleanup();
      }
      lifecycleState.subscriptionsManager = null;
    }
    console.log('RMF Lifecycle: ROS subscriptions cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: ROS subscription cleanup failed:', error);
  }
  
  try {
    // Step 5: Clean up ROS initializer
    console.log('RMF Lifecycle: Cleaning up ROS initializer...');
    if (lifecycleState.rosInitializer) {
      if (typeof lifecycleState.rosInitializer.cleanup === 'function') {
        lifecycleState.rosInitializer.cleanup();
      }
      lifecycleState.rosInitializer = null;
    }
    console.log('RMF Lifecycle: ROS initializer cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: ROS initializer cleanup failed:', error);
  }
  
  try {
    // Step 6: Clean up ROS2 singleton instance
    console.log('RMF Lifecycle: Cleaning up ROS2 singleton...');
    const { Ros2Instance } = require('./rmf-ros2-instance');
    if (Ros2Instance && typeof Ros2Instance.cleanup === 'function') {
      Ros2Instance.cleanup();
    }
    console.log('RMF Lifecycle: ROS2 singleton cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: ROS2 singleton cleanup failed:', error);
  }
  
  try {
    // Step 7: Clean up legacy ROS resources
    console.log('RMF Lifecycle: Cleaning up legacy ROS resources...');
    const { context } = rmfCore;
    
    if (context.node) {
      if (context.node.spinning && typeof context.node.stop === 'function') {
        try { context.node.stop(); } catch (e) { /* ignore */ }
      }
      
      if (context.subscribers) {
        Object.values(context.subscribers).forEach(sub => {
          if (sub && typeof sub.destroy === 'function' && (!sub.isDestroyed || !sub.isDestroyed())) {
            try { sub.destroy(); } catch (error) { console.warn('Error destroying subscription:', error.message); }
          }
        });
        context.subscribers = {};
      }
      
      if (typeof context.node.destroy === 'function') {
        try { context.node.destroy(); } catch (e) { /* ignore */ }
      }
      context.node = null;
      
      if (context.rosInitialized) {
        context.rosInitialized = false;
      }
      
      // Update global ROS state
      const { globalRosState } = rmfCore;
      globalRosState.isInitialized = false;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      globalRosState.error = null;
    }
    console.log('RMF Lifecycle: Legacy ROS resources cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: Legacy ROS cleanup failed:', error);
  }
  
  try {
    // Step 8: Clean up socket connection
    console.log('RMF Lifecycle: Cleaning up socket connection...');
    const { context, rmfEvents } = rmfCore;
    
    if (context.socket) {
      if (typeof context.socket.disconnect === 'function') {
        context.socket.disconnect();
      }
      context.socket = null;
      rmfEvents.emit('socket_disconnected', 'cleanup');
    }
    console.log('RMF Lifecycle: Socket connection cleaned up');
  } catch (error) {
    console.error('RMF Lifecycle: Socket cleanup failed:', error);
  }
  
  try {
    // Step 9: Clear context data
    console.log('RMF Lifecycle: Clearing context data...');
    rmfCore.clearContextData();
    console.log('RMF Lifecycle: Context data cleared');
  } catch (error) {
    console.error('RMF Lifecycle: Context data cleanup failed:', error);
  }
  
  // Reset lifecycle state
  lifecycleState.isInitialized = false;
  lifecycleState.isInitializing = false;
  lifecycleState.initializationOrder = [];
  
  console.log('RMF Lifecycle: System cleanup completed');
  rmfCore.rmfEvents.emit('cleanedUp');
}

/**
 * Soft cleanup that preserves data during redeployment
 * @returns {Promise<void>}
 */
async function softCleanup() {
  console.log('RMF Lifecycle: Starting soft cleanup (preserving data)...');
  
  try {
    // Clean up subscriptions
    if (lifecycleState.subscriptionsManager) {
      lifecycleState.subscriptionsManager.cleanup();
      lifecycleState.subscriptionsManager = null;
    }
    
    // Clean up socket connection
    const { context } = rmfCore;
    if (context.socket) {
      context.socket.disconnect();
      context.socket = null;
    }
    
    // Reset initialization flags but preserve data
    lifecycleState.isInitializing = false;
    
    console.log('RMF Lifecycle: Soft cleanup completed (data preserved)');
  } catch (error) {
    console.error('RMF Lifecycle: Soft cleanup failed:', error);
  }
}

/**
 * Get the current lifecycle state for debugging
 * @returns {Object} Current lifecycle state
 */
function getLifecycleState() {
  return {
    ...lifecycleState,
    dataProcessor: !!lifecycleState.dataProcessor,
    robotManager: !!lifecycleState.robotManager,
    rosInitializer: !!lifecycleState.rosInitializer,
    subscriptionsManager: !!lifecycleState.subscriptionsManager
  };
}

/**
 * Get component instances (with lazy initialization)
 * @returns {Object} Component instances
 */
function getComponents() {
  return {
    dataProcessor: () => initializeDataProcessor(),
    robotManager: () => initializeRobotManager(),
    rosComponents: () => initializeRosComponents()
  };
}

/**
 * Check if system is fully initialized
 * @returns {boolean} True if initialized
 */
function isInitialized() {
  return lifecycleState.isInitialized;
}

/**
 * Check if system is currently initializing
 * @returns {boolean} True if initializing
 */
function isInitializing() {
  return lifecycleState.isInitializing;
}

module.exports = {
  initialize,
  cleanup,
  softCleanup,
  initializeDataProcessor,
  initializeRobotManager,
  initializeRosComponents,
  getLifecycleState,
  getComponents,
  isInitialized,
  isInitializing
};
