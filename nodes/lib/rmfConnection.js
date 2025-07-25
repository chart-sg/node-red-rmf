// File: nodes/lib/rmfConnection.js
const io = require('socket.io-client');
const { context, globalRosState, rmfEvents, updateGlobalContext } = require('./rmfCore');

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
 * Initialize ROS2 connection and subscriptions
 * @returns {Promise<void>}
 */
async function initROS2() {
  try {
    console.log('RMF: Initializing ROS2 with edu-pattern...');
    
    // Use the edu-pattern singleton ROS2 node
    const { Ros2Instance } = require('./rmf-ros2-instance');
    const ros2Instance = Ros2Instance.instance();
    
    // Use the edu-pattern node for context
    context.node = ros2Instance.node;
    context.rosInitialized = true;
    globalRosState.isInitialized = true;
    console.log('RMF: Using edu-pattern ROS2 node for subscriptions');
    
    // If ROS initialized successfully, setup subscriptions
    if (context.rosInitialized && context.node) {
      // Initialize subscriptions manager
      if (!subscriptionsManager) {
        const RMFSubscriptions = require('./rmfSubscriptions');
        subscriptionsManager = new RMFSubscriptions(context.node, context, updateGlobalContext);
      }
      
      // Setup all RMF subscriptions
      await subscriptionsManager.setupAllSubscriptions();
      
      // Optionally disable high-frequency logging to reduce console spam
      if (process.env.RMF_QUIET_LOGGING === 'true') {
        subscriptionsManager.disableHighFrequencyLogging();
      }
      
      // Defensive: Only get subscribers if method exists and not null
      if (subscriptionsManager && typeof subscriptionsManager.getSubscribers === 'function') {
        const subs = subscriptionsManager.getSubscribers();
        if (subs) {
          context.subscribers = subs;
        } else {
          context.subscribers = {};
        }
      } else {
        context.subscribers = {};
      }
      
      // Fetch building map from service and update context
      if (subscriptionsManager && typeof subscriptionsManager.requestBuildingMapFromService === 'function') {
        const success = await subscriptionsManager.requestBuildingMapFromService();
        if (success && context.latestMessages && context.latestMessages.buildingMap) {
          context.buildingMap = context.latestMessages.buildingMap;
        }
      } else {
        console.warn('RMF: subscriptionsManager is null or does not have requestBuildingMapFromService after deploy. Skipping building map request.');
      }
    }
    
    // Emit ready event after successful ROS2 and subscriptions init
    rmfEvents.emit('ready');
    
  } catch (error) {
    console.error('RMF: Failed to initialize ROS 2 and subscriptions:', error.message);
    rmfEvents.emit('error', error);
    throw error;
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
  setRosInitializer
};
