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
    
    // Action methods - note: these are typically undefined for direct nodes
    // Action functionality is provided via ROS2 Manager bridge instead
    const hasActionClient = typeof context.node.createActionClient;
    const hasActionServer = typeof context.node.createActionServer;
    console.log('  - createActionClient:', hasActionClient, hasActionClient === 'undefined' ? '(provided via bridge)' : '');
    console.log('  - createActionServer:', hasActionServer, hasActionServer === 'undefined' ? '(provided via bridge)' : '');
    
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
 * Extract meaningful error information from connection errors
 * @param {Error} error - The connection error
 * @param {string} connectionUrl - The URL that failed to connect
 * @returns {Object} Structured error information
 */
function extractConnectionError(error, connectionUrl) {
  // Handle TransportError with nested error details
  if (error.type === 'TransportError' && error.description && error.description[Symbol.for('kError')]) {
    const innerError = error.description[Symbol.for('kError')];
    
    if (innerError.code === 'ECONNREFUSED') {
      return {
        type: 'connection_refused',
        message: `Cannot connect to RMF Web API at ${connectionUrl}. Please ensure the RMF Web API server is running.`,
        code: 'ECONNREFUSED',
        url: connectionUrl,
        suggestion: 'Start the RMF Web API server or check the connection configuration.'
      };
    }
    
    if (innerError.code === 'ENOTFOUND') {
      return {
        type: 'host_not_found',
        message: `RMF Web API host not found: ${connectionUrl}. Please check the hostname/IP address.`,
        code: 'ENOTFOUND',
        url: connectionUrl,
        suggestion: 'Verify the host address in the connection configuration.'
      };
    }
    
    if (innerError.code === 'ETIMEDOUT') {
      return {
        type: 'connection_timeout',
        message: `Connection to RMF Web API timed out: ${connectionUrl}. The server may be overloaded or unreachable.`,
        code: 'ETIMEDOUT',
        url: connectionUrl,
        suggestion: 'Check network connectivity and server status.'
      };
    }
  }
  
  // Handle other error types
  if (error.message && error.message.includes('ECONNREFUSED')) {
    return {
      type: 'connection_refused',
      message: `Cannot connect to RMF Web API at ${connectionUrl}. Please ensure the RMF Web API server is running.`,
      code: 'ECONNREFUSED',
      url: connectionUrl,
      suggestion: 'Start the RMF Web API server or check the connection configuration.'
    };
  }
  
  // Generic error fallback
  return {
    type: 'unknown_connection_error',
    message: `Failed to connect to RMF Web API at ${connectionUrl}: ${error.message || 'Unknown error'}`,
    code: error.code || 'UNKNOWN',
    url: connectionUrl,
    suggestion: 'Check the RMF Web API server status and connection configuration.'
  };
}

/**
 * Connect to RMF WebSocket API with simple background reconnection
 * @param {Object} config - Connection configuration
 * @param {string} config.host - RMF API host
 * @param {number} config.port - RMF API port
 * @param {string} config.jwt - JWT token for authentication
 * @param {Object} options - Connection options
 * @param {number} options.maxRetries - Maximum retry attempts (default: 3)
 * @param {number} options.retryDelay - Initial retry delay in ms (default: 1000)
 * @param {boolean} options.enableRetry - Enable automatic retry (default: true)
 * @param {boolean} options.backgroundReconnect - Enable background reconnection after failure (default: true)
 * @param {number} options.backgroundInterval - Background reconnection interval in ms (default: 30000)
 * @returns {Promise<Socket>} Connected socket instance
 */
function connectSocket({ host, port, jwt }, options = {}) {
  const { 
    maxRetries = 3, 
    retryDelay = 1000, 
    enableRetry = true,
    backgroundReconnect = true,
    backgroundInterval = 30000
  } = options;
  
  const connectionUrl = `http://${host.replace(/^https?:\/\//, '')}:${port}`;
  
  return new Promise((resolve, reject) => {
    let retryCount = 0;
    let resolved = false;
    let backgroundReconnectTimer = null;
    
    const startBackgroundReconnect = () => {
      if (!backgroundReconnect || backgroundReconnectTimer) return;
      
      console.log(`RMF: Starting background reconnection to ${connectionUrl} (checking every ${backgroundInterval}ms)`);
      
      backgroundReconnectTimer = setInterval(async () => {
        if (resolved) {
          clearInterval(backgroundReconnectTimer);
          return;
        }
        
        console.log(`RMF: Background reconnection attempt to ${connectionUrl}...`);
        
        try {
          const socket = io(connectionUrl, {
            auth: { token: jwt },
            transports: ['websocket', 'polling'],
            timeout: 5000,
            reconnection: false,
            forceNew: true
          });
          
          const success = await new Promise((resolveAttempt) => {
            let attemptResolved = false;
            
            const cleanup = () => {
              if (!attemptResolved) {
                attemptResolved = true;
                socket.removeAllListeners();
                socket.close();
              }
            };
            
            const timer = setTimeout(() => {
              cleanup();
              resolveAttempt(false);
            }, 5000);
            
            socket.on('connect', () => {
              if (!attemptResolved) {
                attemptResolved = true;
                clearTimeout(timer);
                resolveAttempt(socket);
              }
            });
            
            socket.on('connect_error', () => {
              cleanup();
              clearTimeout(timer);
              resolveAttempt(false);
            });
            
            socket.on('error', () => {
              cleanup();
              clearTimeout(timer);
              resolveAttempt(false);
            });
          });
          
          if (success && !resolved) {
            resolved = true;
            clearInterval(backgroundReconnectTimer);
            console.log(`RMF: Background reconnection successful to ${connectionUrl}`);
            context.socket = success;
            rmfEvents.emit('socket_connected', success);
            resolve(success);
          }
        } catch (error) {
          // Silent fail for background attempts
        }
      }, backgroundInterval);
    };
    
    const attemptConnection = () => {
      if (resolved) return;
      
      if (retryCount === 0) {
        console.log(`RMF: Attempting to connect to ${connectionUrl}...`);
      } else {
        console.log(`RMF: Retry attempt ${retryCount}/${maxRetries} to connect to ${connectionUrl}...`);
      }
      
      const socket = io(connectionUrl, {
        auth: { token: jwt },
        transports: ['websocket', 'polling'],
        timeout: 10000,
        reconnection: false,
        forceNew: true
      });
      
      let connectionResolved = false;
      
      socket.on('connect', () => {
        if (!connectionResolved && !resolved) {
          connectionResolved = true;
          resolved = true;
          console.log(`RMF: Successfully connected to ${connectionUrl}${retryCount > 0 ? ` (after ${retryCount} retries)` : ''}`);
          context.socket = socket;
          rmfEvents.emit('socket_connected', socket);
          resolve(socket);
        }
      });
      
      socket.on('connect_error', (error) => {
        if (!connectionResolved && !resolved) {
          connectionResolved = true;
          
          const errorInfo = extractConnectionError(error, connectionUrl);
          
          if (enableRetry && retryCount < maxRetries) {
            retryCount++;
            const nextDelay = retryDelay * Math.pow(2, retryCount - 1);
            
            console.warn(`RMF: ${errorInfo.message} (attempt ${retryCount}/${maxRetries + 1})`);
            console.log(`RMF: Retrying in ${nextDelay}ms...`);
            
            socket.removeAllListeners();
            socket.close();
            
            setTimeout(attemptConnection, nextDelay);
          } else {
            console.error(`RMF: ${errorInfo.message} (failed after ${retryCount + 1} attempts)`);
            
            rmfEvents.emit('socket_error', {
              ...errorInfo,
              retryCount,
              maxRetries,
              finalFailure: true,
              originalError: error
            });
            
            socket.removeAllListeners();
            socket.close();
            
            // Start background reconnection instead of rejecting
            if (backgroundReconnect) {
              console.log(`RMF: Starting background reconnection...`);
              startBackgroundReconnect();
              // Don't reject - let background reconnection handle it
            } else {
              resolved = true;
              reject(new Error(`${errorInfo.message} (failed after ${retryCount + 1} attempts)`));
            }
          }
        }
      });
      
      socket.on('disconnect', (reason) => {
        console.log(`RMF: Disconnected from ${connectionUrl}. Reason: ${reason}`);
        rmfEvents.emit('socket_disconnected', { reason, url: connectionUrl });
        
        // Start background reconnection on disconnect
        if (backgroundReconnect && !backgroundReconnectTimer) {
          console.log(`RMF: Connection lost, starting background reconnection...`);
          resolved = false; // Allow background reconnection to resolve
          startBackgroundReconnect();
        }
      });
      
      socket.on('error', (error) => {
        if (!connectionResolved) {
          const errorInfo = extractConnectionError(error, connectionUrl);
          console.error(`RMF: Socket error: ${errorInfo.message}`);
          rmfEvents.emit('socket_error', {
            ...errorInfo,
            originalError: error
          });
        }
      });
    };
    
    attemptConnection();
  });
}

/**
 * Check if RMF Web API is available
 * @param {Object} config - Connection configuration
 * @param {string} config.host - RMF API host
 * @param {number} config.port - RMF API port
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<boolean>} True if API is available
 */
async function checkRMFWebAPIAvailability({ host, port }, timeout = 5000) {
  return new Promise((resolve) => {
    const connectionUrl = `http://${host.replace(/^https?:\/\//, '')}:${port}`;
    
    console.log(`RMF: Checking Web API availability at ${connectionUrl}...`);
    
    const socket = io(connectionUrl, {
      transports: ['websocket', 'polling'],
      timeout: timeout,
      reconnection: false,
      forceNew: true
    });
    
    const timer = setTimeout(() => {
      socket.close();
      console.log(`RMF: Web API availability check timed out for ${connectionUrl}`);
      resolve(false);
    }, timeout);
    
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.close();
      console.log(`RMF: Web API is available at ${connectionUrl}`);
      resolve(true);
    });
    
    socket.on('connect_error', () => {
      clearTimeout(timer);
      socket.close();
      console.log(`RMF: Web API is not available at ${connectionUrl}`);
      resolve(false);
    });
    
    socket.on('error', () => {
      clearTimeout(timer);
      socket.close();
      resolve(false);
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
  checkRMFWebAPIAvailability,
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
