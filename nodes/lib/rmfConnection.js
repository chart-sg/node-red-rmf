// File: nodes/lib/rmfConnection.js
const io = require('socket.io-client');
const { context, globalRosState, rmfEvents, updateGlobalContext } = require('./rmfCore');

// Use the new ROS2 bridge interface
console.log('RMF: Attempting to import ros2-bridge-interface...');
let ros2BridgeInterface;
try {
  const { getROS2BridgeInterface } = require('./ros2-bridge-interface');
  ros2BridgeInterface = getROS2BridgeInterface();
  console.log('RMF: Successfully imported ROS2 bridge interface');
} catch (error) {
  console.error('RMF: Failed to import ros2-bridge-interface:', error.message);
}

// Initialize the ROS initializer and subscriptions manager references
let rosInitializer = null;
let subscriptionsManager = null;

/**
 * Debug function to inspect ROS2 node capabilities
 */
function debugROS2Node() {
  if (context.node) {
    console.log('RMF: ROS2 node methods available:');
    console.log('  - createPublisher:', typeof context.node.createPublisher);
    console.log('  - createSubscription:', typeof context.node.createSubscription);
    console.log('  - createService:', typeof context.node.createService);
    console.log('  - createClient:', typeof context.node.createClient);
    console.log('  - createActionClient:', typeof context.node.createActionClient);
    console.log('  - createActionServer:', typeof context.node.createActionServer);
    console.log('  - Other methods:', Object.getOwnPropertyNames(context.node).filter(name => typeof context.node[name] === 'function'));
  } else {
    console.log('RMF: ROS2 node not available for debugging');
  }
}

/**
 * Initialize ROS2 connection using bridge interface
 * @param {Object} options - Initialization options
 * @returns {Promise<void>}
 */
async function initROS2(options = {}) {
  // Check if already initialized using bridge interface
  if (ros2BridgeInterface && ros2BridgeInterface.getStatus().initialized) {
    console.log('RMF: Bridge interface already initialized, syncing global state...');
    
    // Sync global state with bridge interface
    const node = ros2BridgeInterface.getNode();
    if (node) {
      context.node = node;
      context.rosInitialized = true;
      globalRosState.isInitialized = true;
      globalRosState.isInitializing = false;
      
      console.log('RMF: State synchronized with existing bridge interface');
      return;
    }
  }
  
  // Prevent multiple simultaneous initializations
  if (globalRosState.isInitializing) {
    console.log('RMF: ROS2 initialization already in progress, waiting...');
    if (globalRosState.initPromise) {
      await globalRosState.initPromise;
      return;
    }
  }

  if (globalRosState.isInitialized) {
    console.log('RMF: ROS2 already initialized');
    return;
  }

  // Set initialization state
  globalRosState.isInitializing = true;
  globalRosState.error = null;

  // Create initialization promise
  globalRosState.initPromise = (async () => {
    try {
      console.log('RMF: Starting ROS2 initialization using bridge interface...');

      // Check if bridge interface is available
      if (!ros2BridgeInterface) {
        throw new Error('ROS2 bridge interface is not available');
      }

      // Set domain
      const domain = options.domainId || process.env.ROS_DOMAIN_ID || process.env.RCLNODEJS_ROS_DOMAIN_ID || 42;
      console.log(`RMF: Initializing with domain ${domain}`);
      
      // Initialize using bridge interface
      await ros2BridgeInterface.initialize({ domainId: domain });
      
            // Get the ROS2 node and nodeId from the bridge
      context.node = ros2BridgeInterface.getNode();
      context.nodeId = ros2BridgeInterface.nodeId; // Store nodeId for action clients
      
      if (!context.node) {
        throw new Error('Failed to get ROS2 node from bridge interface');
      }

      console.log('RMF: ROS2 node created via bridge interface');
      
      // Update global state
      context.rosInitialized = true;
      globalRosState.isInitialized = true;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      
      // Debug node capabilities
      debugROS2Node();
      
      // Update global context
      updateGlobalContext();
      
      console.log('RMF: ROS2 initialization complete');
      rmfEvents.emit('ros2-initialized');

    } catch (error) {
      console.error('RMF: ROS2 initialization failed:', error);
      globalRosState.error = error;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      rmfEvents.emit('error', error);
      throw error;
    }
  })();

}

/**
 * Initialize ROS2 connection using bridge interface
 * @param {Object} options - Initialization options
 * @returns {Promise<void>}
 */
async function initROS2(options = {}) {
  // Check if already initialized using bridge interface
  if (ros2BridgeInterface && ros2BridgeInterface.getStatus().initialized) {
    console.log('RMF: Bridge interface already initialized, syncing global state...');
    
    // Sync global state with bridge interface
    const node = ros2BridgeInterface.getNode();
    if (node) {
      context.node = node;
      context.rosInitialized = true;
      globalRosState.isInitialized = true;
      globalRosState.isInitializing = false;
      
      console.log('RMF: State synchronized with existing bridge interface');
      return;
    }
  }
  
  // Prevent multiple simultaneous initializations
  if (globalRosState.isInitializing) {
    console.log('RMF: ROS2 initialization already in progress, waiting...');
    if (globalRosState.initPromise) {
      await globalRosState.initPromise;
      return;
    }
  }

  if (globalRosState.isInitialized) {
    console.log('RMF: ROS2 already initialized');
    return;
  }

  // Set initialization state
  globalRosState.isInitializing = true;
  globalRosState.error = null;

  // Create initialization promise
  globalRosState.initPromise = (async () => {
    try {
      console.log('RMF: Starting ROS2 initialization using bridge interface...');

      // Check if bridge interface is available
      if (!ros2BridgeInterface) {
        throw new Error('ROS2 bridge interface is not available');
      }

      // Set domain
      const domain = options.domainId || process.env.ROS_DOMAIN_ID || process.env.RCLNODEJS_ROS_DOMAIN_ID || 42;
      console.log(`RMF: Initializing with domain ${domain}`);
      
      // Initialize using bridge interface
      await ros2BridgeInterface.initialize({ domainId: domain });
      
      // Get the ROS2 node and nodeId from the bridge
      context.node = ros2BridgeInterface.getNode();
      context.nodeId = ros2BridgeInterface.nodeId; // Store nodeId for action clients
      
      if (!context.node) {
        throw new Error('Failed to get ROS2 node from bridge interface');
      }

      console.log('RMF: ROS2 node created via bridge interface');
      
      // Update global state
      context.rosInitialized = true;
      globalRosState.isInitialized = true;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      
      // Debug node capabilities
      debugROS2Node();

      // Initialize subscriptions manager
      try {
        const RMFSubscriptions = require('./rmfSubscriptions');
        subscriptionsManager = new RMFSubscriptions(context.node, context, updateGlobalContext);
        
        // Setup all RMF subscriptions
        await subscriptionsManager.setupAllSubscriptions();
        
        // Optionally disable high-frequency logging
        if (process.env.RMF_QUIET_LOGGING === 'true') {
          subscriptionsManager.disableHighFrequencyLogging();
        }
        
        // Get subscribers
        if (subscriptionsManager && typeof subscriptionsManager.getSubscribers === 'function') {
          const subs = subscriptionsManager.getSubscribers();
          context.subscribers = subs || {};
        } else {
          context.subscribers = {};
        }
        
        // Building map already fetched during subscription setup - no need to duplicate
        // The subscriptionsManager.requestBuildingMapFromService() handles caching internally
        
      } catch (error) {
        console.warn('RMF: Failed to initialize subscriptions:', error.message);
        // Continue without subscriptions - they're not critical for basic operation
      }
      
      // Update global context
      updateGlobalContext();
      
      console.log('RMF: ROS2 initialization complete via bridge interface');
      
      // Emit successful initialization
      rmfEvents.emit('ros2_initialized', {
        node: context.node,
        message: 'RMF ROS2 initialized successfully using bridge interface'
      });
      
      rmfEvents.emit('ready');

    } catch (error) {
      console.error('RMF: ROS2 initialization failed:', error);
      globalRosState.error = error;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      rmfEvents.emit('error', error);
      throw error;
    }
  })();

  return globalRosState.initPromise;
}

/**
 * Cleanup ROS2 resources using bridge interface
 */
async function cleanupROS2() {
  try {
    console.log('RMF: Starting ROS2 cleanup...');
    
    // Clean up subscriptions manager first
    if (subscriptionsManager) {
      try {
        await subscriptionsManager.cleanup();
        subscriptionsManager = null;
        console.log('RMF: Subscriptions manager cleaned up');
      } catch (error) {
        console.warn('RMF: Error cleaning up subscriptions manager:', error);
      }
    }
    
    // Clear local references (bridge interface manages the actual ROS2 resources)
    if (context.node) {
      console.log('RMF: Clearing local node context reference...');
      context.node = null;
    }
    
    // Reset local state
    context.rosInitialized = false;
    globalRosState.isInitialized = false;
    globalRosState.isInitializing = false;
    globalRosState.initPromise = null;
    
    console.log('RMF: ROS2 local cleanup completed (bridge interface preserved for reuse)');
  } catch (error) {
    console.error('RMF: Error during ROS2 cleanup:', error.message);
  }
}

/**
 * Full cleanup that shuts down bridge interface (use only on final shutdown)
 */
async function fullCleanupROS2() {
  try {
    // First do local cleanup
    await cleanupROS2();
    
    // Then shutdown bridge interface if available
    if (ros2BridgeInterface) {
      console.log('RMF: Performing full cleanup - shutting down bridge interface...');
      await ros2BridgeInterface.shutdown();
      console.log('RMF: Bridge interface shutdown completed');
    }
    
    console.log('RMF: Full ROS2 cleanup completed');
  } catch (error) {
    console.error('RMF: Error during full ROS2 cleanup:', error.message);
  }
}

/**
 * Soft cleanup for redeployment that preserves ROS2 node and state
 */
async function softCleanupROS2() {
  try {
    console.log('RMF Connection: Starting soft ROS2 cleanup (preserving node and state)...');
    
    // Only clean up subscriptions manager, but preserve ROS2 node and state
    if (subscriptionsManager) {
      console.log('RMF Connection: Cleaning up subscriptions manager during soft cleanup...');
      if (typeof subscriptionsManager.cleanup === 'function') {
        await subscriptionsManager.cleanup();
      }
      subscriptionsManager = null;
    }
    
    // NOTE: We explicitly DO NOT clear context.node or reset globalRosState 
    // flags during soft cleanup to prevent initialization errors after redeployment.
    // The bridge interface keeps the node alive and we keep our references.
    
    console.log('RMF Connection: Soft ROS2 cleanup completed (node and state preserved)');
  } catch (error) {
    console.error('RMF Connection: Error during soft ROS2 cleanup:', error.message);
  }
}

/**
 * Connect to RMF WebSocket API
 * @param {Object} config - Connection configuration
 * @param {string} config.host - RMF API host
 * @param {number} config.port - RMF API port
 * @param {string} config.jwt - JWT token for authentication
 * @returns {Promise<Socket>} Connected socket instance
 */
function connectSocket({ host, port, jwt }) {
  return new Promise((resolve, reject) => {
    // Ensure we're using HTTP (not HTTPS) for the RMF API server
    const connectionUrl = `http://${host.replace(/^https?:\/\//, '')}:${port}`;
    console.log(`RMF: Attempting to connect to ${connectionUrl}...`);
    
    const socket = io(connectionUrl, {
      auth: { token: jwt },
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      forceNew: true
    });
    
    socket.on('connect', () => {
      console.log(`RMF: Successfully connected to ${connectionUrl}`);
      context.socket = socket;
      rmfEvents.emit('socket_connected', socket);
      resolve(socket);
    });
    
    socket.on('connect_error', (error) => {
      console.error(`RMF: Connection error to ${connectionUrl}:`, error);
      rmfEvents.emit('socket_error', error);
      reject(new Error(`Socket connection failed: ${error.message || error}`));
    });
    
    socket.on('disconnect', (reason) => {
      console.log(`RMF: Disconnected from ${connectionUrl}. Reason: ${reason}`);
      rmfEvents.emit('socket_disconnected', reason);
    });
    
    socket.on('error', (error) => {
      console.error(`RMF: Socket error:`, error);
      rmfEvents.emit('socket_error', error);
    });
  });
}

/**
 * Get subscription statistics from the subscriptions manager
 * @returns {Object} Subscription statistics
 */
function getSubscriptionStats() {
  if (subscriptionsManager) {
    return subscriptionsManager.getMessageStats();
  }
  return {};
}

/**
 * Control subscription throttling
 * @param {string} subscriptionType - Type of subscription to throttle
 * @param {number} intervalMs - Throttle interval in milliseconds
 */
function setSubscriptionThrottleInterval(subscriptionType, intervalMs) {
  if (subscriptionsManager) {
    subscriptionsManager.setThrottleInterval(subscriptionType, intervalMs);
  }
}

/**
 * Get current throttle settings
 * @returns {Object} Current throttle settings
 */
function getThrottleSettings() {
  if (subscriptionsManager) {
    return subscriptionsManager.getThrottleSettings();
  }
  return {};
}

/**
 * Force process latest message for a specific subscription
 * @param {string} subscriptionType - Type of subscription to process
 */
function forceProcessLatest(subscriptionType) {
  if (subscriptionsManager) {
    subscriptionsManager.forceProcessLatest(subscriptionType);
  }
}

/**
 * Force process all latest messages
 */
function forceProcessAllLatest() {
  if (subscriptionsManager) {
    subscriptionsManager.forceProcessAllLatest();
  }
}

/**
 * Request building map from service
 * @returns {Promise<boolean>} Success status
 */
async function requestBuildingMap() {
  if (subscriptionsManager && typeof subscriptionsManager.requestBuildingMap === 'function') {
    return await subscriptionsManager.requestBuildingMap();
  }
  console.warn('RMF: subscriptionsManager is null or does not have requestBuildingMap. Skipping building map request.');
  return false;
}

/**
 * Get service client status
 * @returns {Object} Service client status information
 */
function getServiceClientStatus() {
  if (subscriptionsManager) {
    return subscriptionsManager.getServiceClientStatus();
  }
  return {};
}

/**
 * Get references to internal managers for advanced usage
 * @returns {Object} Manager references
 */
function getManagers() {
  return {
    rosInitializer,
    subscriptionsManager
  };
}

/**
 * Set subscriptions manager reference (used by lifecycle management)
 * @param {Object} manager - Subscriptions manager instance
 */
function setSubscriptionsManager(manager) {
  subscriptionsManager = manager;
}

/**
 * Set ROS initializer reference (used by lifecycle management)
 * @param {Object} initializer - ROS initializer instance
 */
function setRosInitializer(initializer) {
  rosInitializer = initializer;
}

module.exports = {
  // Core initialization
  initROS2,
  connectSocket,
  debugROS2Node,
  
  // Subscription management
  getSubscriptionStats,
  setSubscriptionThrottleInterval,
  getThrottleSettings,
  forceProcessLatest,
  forceProcessAllLatest,
  requestBuildingMap,
  getServiceClientStatus,
  
  // Manager access
  getManagers,
  setSubscriptionsManager,
  setRosInitializer,

  // Cleanup
  cleanupROS2,
  fullCleanupROS2,
  softCleanupROS2
};
