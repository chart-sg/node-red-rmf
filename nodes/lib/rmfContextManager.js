// File: nodes/lib/rmfContextManager.js
const rclnodejs = require('rclnodejs');
const io = require('socket.io-client');
const RMFRosInitializer = require('./rmfRosInitializer');
const RMFSubscriptions = require('./rmfSubscriptions');
const { RMF_Ros2Instance } = require('./rmf-ros2-instance');
const { RMF_ActionClient } = require('./rmf-action-client');

// Global ROS state - shared across all nodes
let globalRosState = {
  isInitializing: false,
  isInitialized: false,
  initPromise: null,
  error: null
};

let context = {
  socket: null,
  rosInitialized: false,
  node: null,
  robots: [],
  locations: [],
  doors: [],
  lifts: [],
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
    lifts: null
  }
};

// Store reference to global context for updates
let globalContext = null;

// Persistent action client to avoid repeated creation/destruction
let persistentActionClient = null;
let actionClientPath = null;

// Debug function to inspect ROS2 node capabilities
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

// Initialize the ROS initializer and subscriptions manager
let rosInitializer = null;
let subscriptionsManager = null;

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
        subscriptionsManager = new RMFSubscriptions(context.node, context, updateGlobalContext);
      }
      
      // Setup all RMF subscriptions
      await subscriptionsManager.setupAllSubscriptions();
      
      // Optionally disable high-frequency logging to reduce console spam
      if (process.env.RMF_QUIET_LOGGING === 'true') {
        subscriptionsManager.disableHighFrequencyLogging();
      }
      
      // Store subscribers in context for cleanup
      context.subscribers = subscriptionsManager.getSubscribers();
    }
    
  } catch (error) {
    console.error('RMF: Failed to initialize ROS 2 and subscriptions:', error.message);
    throw error;
  }
}

function connectSocket({ host, port, jwt }) {
  return new Promise((resolve, reject) => {
    // Ensure we're using HTTP (not HTTPS) for the RMF API server
    const connectionUrl = `http://${host.replace(/^https?:\/\//, '')}:${port}`;
    console.log(`RMF: Attempting to connect to ${connectionUrl}...`);
    
    const socket = io(connectionUrl, {
      auth: { token: jwt }, // v4.x uses auth instead of query
      transports: ['websocket', 'polling'], // Try websocket first, fallback to polling
      timeout: 10000, // 10 second timeout
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      forceNew: true
    });

    socket.on('connect', () => {
      console.log(`RMF: Successfully connected to ${connectionUrl}`);
      context.socket = socket;
      resolve(socket);
    });

    socket.on('connect_error', (error) => {
      console.error(`RMF: Connection error to ${connectionUrl}:`, error);
      reject(new Error(`Socket connection failed: ${error.message || error}`));
    });

    socket.on('disconnect', (reason) => {
      console.log(`RMF: Disconnected from ${connectionUrl}. Reason: ${reason}`);
    });

    socket.on('error', (error) => {
      console.error(`RMF: Socket error:`, error);
    });
  });
}

function setGlobalContext(globalCtx) {
  globalContext = globalCtx;
  globalContext.set('rmf_global', context);
}

// Function to update global context when data changes
function updateGlobalContext() {
  if (globalContext) {
    globalContext.set('rmf_global', context);
  }
}

async function cleanup() {
  console.log('Cleaning up RMF context...');
  
  // Clean up persistent action client first
  cleanupPersistentActionClient();
  
  // Clean up subscriptions first
  if (subscriptionsManager) {
    try {
      console.log('Cleaning up RMF subscriptions...');
      subscriptionsManager.cleanup();
      subscriptionsManager = null;
      console.log('RMF subscriptions cleaned up');
    } catch (error) {
      console.error('RMF subscription cleanup failed:', error);
    }
  }
  
  // Clean up ROS resources using the new singleton pattern
  try {
    console.log('Implementing proper ROS2 shutdown sequence (singleton pattern)...');
    
    // Use the singleton cleanup method if available
    const { Ros2Instance } = require('./rmf-ros2-instance');
    if (Ros2Instance && typeof Ros2Instance.cleanup === 'function') {
      Ros2Instance.cleanup();
    } else {
      console.log('RMF: No singleton cleanup method available');
    }
    
    console.log('RMF: Singleton ROS2 instance cleaned up successfully');
    
  } catch (error) {
    console.error('RMF: Error during singleton ROS2 cleanup:', error.message);
  }
  
  // Clean up legacy ROS resources if they exist
  if (context.node) {
    try {
      console.log('Cleaning up legacy ROS2 resources...');
      
      // Step 1: Stop spinning first (if applicable)
      if (context.node.spinning) {
        console.log('Stopping legacy ROS2 node spin...');
        context.node.stop();
      }
      
      // Step 2: Destroy all entities in proper order
      console.log('Destroying legacy ROS2 entities...');
      
      // Destroy any remaining subscriptions
      if (context.subscribers) {
        Object.values(context.subscribers).forEach(sub => {
          if (sub && typeof sub.destroy === 'function' && !sub.isDestroyed()) {
            try {
              sub.destroy();
            } catch (error) {
              console.warn('Error destroying subscription:', error.message);
            }
          }
        });
        context.subscribers = {};
      }
      
      // Step 3: Destroy the node
      if (typeof context.node.destroy === 'function') {
        console.log('Destroying legacy ROS2 node...');
        context.node.destroy();
      }
      context.node = null;
      
      // Step 4: Shutdown rclnodejs context (only if singleton didn't already do it)
      if (context.rosInitialized) {
        try {
          console.log('Shutting down legacy rclnodejs...');
          // Note: This might conflict with singleton, but better to be safe
          // rclnodejs.shutdown();
          console.log('Legacy rclnodejs shutdown skipped (singleton handles it)');
        } catch (error) {
          console.error('Error during legacy rclnodejs shutdown:', error.message);
        }
        context.rosInitialized = false;
      }
      
      // Step 3: Reset global state
      globalRosState.isInitialized = false;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      globalRosState.error = null;
      
    } catch (error) {
      console.error('Error during ROS2 cleanup:', error.message);
    }
  }
  
  // Clean up ROS initializer
  if (rosInitializer) {
    try {
      console.log('Cleaning up ROS initializer...');
      if (typeof rosInitializer.cleanup === 'function') {
        rosInitializer.cleanup();
      }
      rosInitializer = null;
      console.log('ROS initializer cleanup completed');
    } catch (error) {
      console.error('ROS initializer cleanup failed:', error);
    }
  }

  if (context.socket) {
    try {
      console.log('Disconnecting socket...');
      context.socket.disconnect();
      context.socket = null;
      console.log('Socket cleanup completed');
    } catch (error) {
      console.error('Socket cleanup failed:', error);
    }
  }
  
  // Clear RMF data
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
  
  console.log('RMF context cleanup completed');
}

// Add a function to get global ROS state for debugging
function getRosState() {
  return {
    globalState: globalRosState,
    contextState: {
      rosInitialized: context.rosInitialized,
      hasNode: !!context.node,
      hasSocket: !!context.socket,
      hasRosInitializer: !!rosInitializer,
      hasSubscriptionsManager: !!subscriptionsManager
    }
  };
}

// Add a function to get RMF data for other nodes
function getRMFData() {
  return {
    locations: context.locations,
    robots: context.robots,
    doors: context.doors,
    lifts: context.lifts,
    buildingMap: context.buildingMap,
    fleetStates: context.fleetStates,
    doorStates: context.doorStates,
    liftStates: context.liftStates,
    lastUpdated: context.lastUpdated
  };
}

// Add a function to get specific RMF data types
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

// Get RMF subscription statistics
function getSubscriptionStats() {
  if (subscriptionsManager) {
    return subscriptionsManager.getMessageStats();
  }
  return {};
}

// Control subscription throttling
function setSubscriptionThrottleInterval(subscriptionType, intervalMs) {
  if (subscriptionsManager) {
    subscriptionsManager.setThrottleInterval(subscriptionType, intervalMs);
  }
}

function getThrottleSettings() {
  if (subscriptionsManager) {
    return subscriptionsManager.getThrottleSettings();
  }
  return {};
}

function forceProcessLatest(subscriptionType) {
  if (subscriptionsManager) {
    subscriptionsManager.forceProcessLatest(subscriptionType);
  }
}

function forceProcessAllLatest() {
  if (subscriptionsManager) {
    subscriptionsManager.forceProcessAllLatest();
  }
}

// Method to manually request building map from service
async function requestBuildingMap() {
  if (subscriptionsManager) {
    return await subscriptionsManager.requestBuildingMap();
  }
  return false;
}

// Method to get service client status
function getServiceClientStatus() {
  if (subscriptionsManager) {
    return subscriptionsManager.getServiceClientStatus();
  }
  return {};
}

// Soft cleanup function that preserves RMF data during deployment
async function softCleanup() {
  console.log('Soft cleaning up RMF context (preserving data)...');
  
  // Clean up subscriptions first
  if (subscriptionsManager) {
    try {
      console.log('Cleaning up RMF subscriptions...');
      subscriptionsManager.cleanup();
      subscriptionsManager = null;
      console.log('RMF subscriptions cleaned up');
    } catch (error) {
      console.error('RMF subscription cleanup failed:', error);
    }
  }
  
  if (context.socket) {
    try {
      console.log('Disconnecting socket...');
      context.socket.disconnect();
      context.socket = null;
      console.log('Socket cleanup completed');
    } catch (error) {
      console.error('Socket cleanup failed:', error);
    }
  }
  
  // DON'T clean up ROS resources or clear data during soft cleanup
  // The data and ROS context are preserved for quick recovery
  
  console.log('RMF soft cleanup completed (data preserved)');
}

// Task management functions for goto-place node
async function createRMFTask(taskData, configNode) {
  try {
    if (!configNode) {
      throw new Error('No RMF config provided');
    }
    
    const axios = require('axios');
    const { host, port, jwt } = configNode;
    
    // Create the description for the activity - only include estimate if it exists
    let description = {};
    if (taskData.estimate && Object.keys(taskData.estimate).length > 0) {
      description = { "estimate": taskData.estimate };
    }
    
    let taskPayload;
    let endpoint;
    
    // Check if we have a specific robot or should use dispatch
    if (taskData.robot_name && taskData.robot_fleet) {
      // Use robot_task_request for specific robot assignment
      taskPayload = {
        "type": "robot_task_request",
        "robot": taskData.robot_name,
        "fleet": taskData.robot_fleet,
        "request": {
          "category": "compose",
          "description": {
            "category": "dynamic_event",
            "phases": [
              {
                "activity": {
                  "category": "dynamic_event",
                  "description": description
                }
              }
            ]
          },
          "unix_millis_request_time": 0,
          "unix_millis_earliest_start_time": 0,
          "requester": "NR"
        }
      };
      endpoint = '/tasks/robot_task';
    } else if (taskData.robot_fleet) {
      // Use dispatch_task_request for fleet-based assignment
      taskPayload = {
        "type": "dispatch_task_request",
        "request": {
          "category": "compose",
          "description": {
            "category": "dynamic_event",
            "phases": [
              {
                "activity": {
                  "category": "dynamic_event",
                  "description": description
                }
              }
            ]
          },
          "fleet_name": taskData.robot_fleet,
          "unix_millis_request_time": 0,
          "unix_millis_earliest_start_time": 0,
          "requester": "NR"
        }
      };
      endpoint = '/tasks/dispatch_task';
    } else {
      throw new Error('Either robot_name+robot_fleet or robot_fleet must be provided');
    }
    
    const response = await axios.post(`http://${host}:${port}${endpoint}`, taskPayload, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data && response.data.state && response.data.state.booking) {
      return {
        success: true,
        taskId: response.data.state.booking.id,
        taskData: response.data,
        status: response.data.state.status
      };
    } else {
      throw new Error('Invalid response format from RMF API');
    }
    
  } catch (error) {
    console.error('RMF: Failed to create task:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function subscribeToTaskStatus(taskId, onStatusUpdate, configNode, options = {}) {
  try {
    if (!context.socket) {
      throw new Error('Socket not connected');
    }
    
    const room = `/tasks/${taskId}/state`;
    console.log(`RMF: Subscribing to task status room: ${room}`);
    
    // Join the room with acknowledgment
    context.socket.emit('join', { room }, (ack) => {
      if (ack) {
        console.log(`RMF: Successfully joined room: ${room}`);
      } else {
        console.log(`RMF: Failed to join room: ${room}`);
      }
    });
    
    // Enhanced status handler with goal completion detection
    const enhancedStatusHandler = (data) => {
      try {
        console.log(`RMF: Enhanced status handler for ${taskId}:`, data);
        
        // Always call the original status update handler
        onStatusUpdate(data);
        
        // Check for goal completion states
        if (data.status && ['completed', 'failed', 'canceled', 'cancelled'].includes(data.status.toLowerCase())) {
          console.log(`RMF: Task ${taskId} reached terminal state: ${data.status}`);
          
          // Generate goal response for Node-RED output
          const goalResponse = {
            task_id: taskId,
            status: data.status,
            result: data.result || 'Task completed',
            timestamp: new Date().toISOString(),
            execution_time: data.execution_time || null,
            final_state: data,
            success: data.status.toLowerCase() === 'completed'
          };
          
          // If node callback provided, send output
          if (options.onGoalComplete) {
            options.onGoalComplete(goalResponse);
          }
          
          // Auto-unsubscribe after terminal state
          setTimeout(() => {
            unsubscribeFromTaskStatus(taskId);
          }, 1000);
        }
        
        // Check for progress updates to provide feedback
        if (data.status && ['executing', 'queued', 'standby'].includes(data.status.toLowerCase())) {
          const feedbackData = {
            task_id: taskId,
            status: data.status,
            progress: data.progress || null,
            current_phase: data.current_phase || null,
            timestamp: new Date().toISOString(),
            feedback: data
          };
          
          // If feedback callback provided, send feedback
          if (options.onGoalFeedback) {
            options.onGoalFeedback(feedbackData);
          }
        }
        
      } catch (handlerError) {
        console.error(`RMF: Error in enhanced status handler for ${taskId}:`, handlerError);
      }
    };
    
    // Listen for multiple possible event types
    const eventHandlers = {
      'task_state_update': (data) => {
        if (data.task_id === taskId) {
          console.log(`RMF: Received task_state_update for ${taskId}:`, data);
          enhancedStatusHandler(data);
        }
      },
      [room]: (data) => {
        console.log(`RMF: Received room event for ${room}:`, data);
        enhancedStatusHandler(data);
      },
      'task_status': (data) => {
        if (data.task_id === taskId) {
          console.log(`RMF: Received task_status for ${taskId}:`, data);
          enhancedStatusHandler(data);
        }
      }
    };
    
    // Add all event listeners
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      context.socket.on(event, handler);
    });
    
    // Set up a fallback polling mechanism with proper config
    const pollInterval = setInterval(async () => {
      try {
        const axios = require('axios');
        const { host, port, jwt } = configNode || { host: 'localhost', port: 8000, jwt: null };
        const response = await axios.get(`http://${host}:${port}/tasks/${taskId}/state`, {
          headers: {
            ...(jwt && { 'Authorization': `Bearer ${jwt}` }),
            'Content-Type': 'application/json'
          }
        });
        if (response.data) {
          console.log(`RMF: Polled task status for ${taskId}:`, response.data);
          enhancedStatusHandler(response.data);
        }
      } catch (error) {
        console.log(`RMF: Polling failed for ${taskId}:`, error.message);
      }
    }, 2000); // Poll every 2 seconds
    
    // Store cleanup info
    context.taskSubscriptions = context.taskSubscriptions || {};
    context.taskSubscriptions[taskId] = {
      eventHandlers,
      pollInterval,
      room,
      options
    };
    
    return { success: true };
    
  } catch (error) {
    console.error('RMF: Failed to subscribe to task status:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function unsubscribeFromTaskStatus(taskId) {
  try {
    if (!context.socket) {
      return { success: true }; // Already disconnected
    }
    
    const room = `/tasks/${taskId}/state`;
    console.log(`RMF: Unsubscribing from task status room: ${room}`);
    
    // Leave the room
    context.socket.emit('leave', { room });
    
    // Clean up stored subscription info
    if (context.taskSubscriptions && context.taskSubscriptions[taskId]) {
      const { eventHandlers, pollInterval } = context.taskSubscriptions[taskId];
      
      // Remove event listeners
      Object.entries(eventHandlers).forEach(([event, handler]) => {
        context.socket.off(event, handler);
      });
      
      // Clear polling interval
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      
      // Remove from storage
      delete context.taskSubscriptions[taskId];
    }
    
    return { success: true };
    
  } catch (error) {
    console.error('RMF: Failed to unsubscribe from task status:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function sendDynamicEventGoal(goalData, configNode = null) {
  try {
    console.log('RMF: Sending dynamic event goal with edu-pattern...');
    
    // Use the exact edu-pattern
    return await sendDynamicEventGoalWithEduPattern(goalData, {});
    
  } catch (error) {
    console.error('RMF: Failed to send dynamic event goal:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send dynamic event goal using the safe action client wrapper
 */
async function sendDynamicEventGoalWithEduPattern(goalData, callbacks = {}) {
  let safeActionClient = null;
  
  try {
    console.log('RMF: Using safe action client wrapper...');
    
    // Get singleton ROS2 instance
    const { Ros2Instance } = require('./rmf-ros2-instance');
    const { SafeActionClient } = require('./rmf-safe-action-client');
    
    // Build the action server path
    const actionPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log('RMF: Using action server path:', actionPath);
    
    // Create safe action client
    safeActionClient = new SafeActionClient(
      Ros2Instance.instance().node,
      'rmf_task_msgs/action/DynamicEvent',
      actionPath
    );
    
    // Initialize the action client
    await safeActionClient.initialize();
    
    console.log('RMF: Safe action client initialized');
    
    // Check if action server is available
    if (!safeActionClient.isActionServerAvailable()) {
      console.log('RMF: Action server not available, cleaning up and returning error');
      
      // Clean up immediately if server not available
      safeActionClient.destroy();
      safeActionClient = null;
      
      return {
        success: false,
        error: `Action server not available at ${actionPath}`
      };
    }
    
    console.log('RMF: Action server is available');
    
    // Prepare the goal with correct uint32 range for dynamic_event_seq
    const goal = {
      event_type: goalData.event_type || 1,
      category: goalData.category || 'go_to_place',
      description: goalData.description || '{}',
      dynamic_event_seq: Math.floor(Date.now() / 1000) % 4294967295, // Convert to seconds and keep within uint32 range
      stubborn_period: goalData.stubborn_period || 0.0
    };
    
    console.log('RMF: Sending goal (safe wrapper):', goal);
    
    // Send goal using safe wrapper
    const goalHandle = await safeActionClient.sendGoal(goal, function (feedback) {
      console.log('RMF: Feedback received:', feedback);
      if (callbacks.onFeedback) {
        callbacks.onFeedback(feedback);
      }
    });
    
    if (!goalHandle.isAccepted()) {
      console.log('RMF: Goal was rejected');
      const result = await goalHandle.getResult();
      
      // Clean up on rejection
      safeActionClient.destroy();
      safeActionClient = null;
      
      return {
        success: false,
        error: 'Goal rejected',
        result: result
      };
    }
    
    console.log('RMF: Goal was accepted');
    const result = await goalHandle.getResult();
    
    let success = false;
    if (goalHandle.isSucceeded()) {
      console.log('RMF: Goal succeeded!');
      success = true;
    } else {
      console.log('RMF: Goal failed');
    }
    
    // Clean up safe action client
    safeActionClient.destroy();
    safeActionClient = null;
    console.log('RMF: Safe action client destroyed');
    
    return {
      success: success,
      result: result
    };
    
  } catch (error) {
    console.error('RMF: Error in sendDynamicEventGoalWithEduPattern:', error.message);
    
    // Clean up on error
    if (safeActionClient) {
      try {
        safeActionClient.destroy();
        safeActionClient = null;
        console.log('RMF: Safe action client cleaned up after error');
      } catch (destroyError) {
        console.warn('RMF: Warning during safe action client cleanup (error):', destroyError.message);
      }
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

async function sendDynamicEventGoalWithCallback(goalData, callbacks = {}) {
  try {
    console.log('RMF: Sending dynamic event goal using edu-nodered-ros2-plugin ROS2 instance...');
    
    // CRITICAL FIX: Use the exact same ROS2 initialization pattern as edu-nodered
    // This ensures the native bindings are initialized in the same way
    let rosNode = null;
    let rosNodeSource = 'unknown';
    
    // Try to get the edu-nodered ROS2 instance first
    try {
      const { Ros2Instance } = require('/home/asraf/.node-red/projects/rmf2_node_red/custom-nodes/edu_nodered_ros2_plugin/src/ros2/ros2-instance');
      rosNode = Ros2Instance.instance().node;
      rosNodeSource = 'edu-nodered-ros2-plugin';
      console.log('RMF: Successfully obtained edu-nodered ROS2 instance');
    } catch (error) {
      console.log('RMF: Failed to get edu-nodered ROS2 instance:', error.message);
      
      // FALLBACK: Initialize ROS2 using the EXACT same pattern as edu-nodered
      if (!context.rosInitialized) {
        console.log('RMF: Initializing ROS2 using edu-nodered pattern...');
        const rclnodejs = require('rclnodejs');
        
        // Match edu-nodered initialization exactly
        rclnodejs.init(); // Synchronous init, just like edu-nodered
        context.node = rclnodejs.createNode("rmf_node_red");
        
        // Start spinning in background (async, just like edu-nodered)
        process.nextTick(() => {
          rclnodejs.spin(context.node);
        });
        
        context.rosInitialized = true;
        console.log('RMF: ROS2 initialized using edu-nodered pattern');
      }
      
      rosNode = context.node;
      rosNodeSource = 'rmf-context-manager-edu-pattern';
    }
    
    // Verify we have a valid ROS2 node
    if (!rosNode) {
      throw new Error('No valid ROS2 node available');
    }
    
    console.log(`RMF: Using ROS2 node from: ${rosNodeSource}`);
    
    // Get the robot context to find the dynamic_event_seq
    const robot = getRobotContext(goalData.robot_name, goalData.robot_fleet);
    console.log(`RMF: Robot context for ${goalData.robot_name}:`, robot);
    
    // Get the dynamic_event_seq from the robot context
    let dynamicEventSeq = 0;
    if (robot && robot.dynamic_event_seq !== undefined) {
      dynamicEventSeq = robot.dynamic_event_seq;
      console.log(`RMF: Using dynamic_event_seq from robot context: ${dynamicEventSeq}`);
    } else {
      console.log(`RMF: Robot context not found or dynamic_event_seq not available, using default: 0`);
      
      if (goalData.dynamic_event_seq !== undefined) {
        dynamicEventSeq = goalData.dynamic_event_seq;
        console.log(`RMF: Using dynamic_event_seq from goalData: ${dynamicEventSeq}`);
      }
    }
    
    console.log(`RMF: Final dynamic_event_seq: ${dynamicEventSeq}`);
    
    // Create action client following edu-nodered-ros2-plugin pattern
    const { ActionClient } = require('rclnodejs');
    const actionServerPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log(`RMF: Using action server path: ${actionServerPath}`);
    
    let actionClient = null;
    
    try {
      // Create action client using the exact same pattern and node as edu-nodered
      actionClient = new ActionClient(
        rosNode, // Use the same ROS2 node instance
        'rmf_task_msgs/action/DynamicEvent',
        actionServerPath
      );
      
      console.log(`RMF: Action client created with ${rosNodeSource} ROS2 instance`);
      
      // Check if action server is available (edu-nodered pattern: simple check)
      if (!actionClient.isActionServerAvailable()) {
        console.log('RMF: Action server not available');
        
        // Call completion callback for unavailable server
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'action-client-result',
            status: 'failed',
            result: null,
            success: false,
            error: 'Action server not available',
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
        
        // Clean up and return
        actionClient.destroy();
        return {
          success: false,
          error: 'Action server not available',
          result: null,
          method: 'edu-nodered-instance'
        };
      }
      
      console.log('RMF: Action server is available');
      
      // Create goal message
      const goal = {
        event_type: 1,
        category: 'go_to_place',
        description: JSON.stringify({
          waypoint: goalData.location_name
        }),
        dynamic_event_seq: dynamicEventSeq,
        stubborn_period: goalData.stubborn_period || 0
      };
      
      console.log('RMF: Sending dynamic event goal (edu-nodered instance):', goal);
      
      // CRASH FIX: Use callback-based approach instead of Promise await
      // The native crash occurs when awaiting the goalHandlePromise
      let goalHandle = null;
      let goalAccepted = false;
      let goalCompleted = false;
      let finalResult = null;
      let finalSuccess = false;
      
      console.log('RMF: Sending goal with callback-based approach...');
      
      // Use sendGoal with callbacks to avoid the problematic Promise await
      actionClient.sendGoal(goal, 
        // Feedback callback
        function(feedback) {
          console.log('RMF: Action feedback received:', feedback);
          
          // Call the feedback callback if provided
          if (callbacks.onGoalFeedback) {
            const feedbackData = {
              task_id: 'action-client-feedback',
              status: 'executing',
              feedback: feedback,
              timestamp: new Date().toISOString()
            };
            
            try {
              callbacks.onGoalFeedback(feedbackData);
            } catch (callbackError) {
              console.error('RMF: Error in feedback callback:', callbackError.message);
            }
          }
        },
        // Result callback
        function(result) {
          console.log('RMF: Action result received:', result);
          finalResult = result;
          finalSuccess = goalHandle ? goalHandle.isSucceeded() : false;
          goalCompleted = true;
          
          // Call completion callback
          if (callbacks.onGoalComplete) {
            const goalResponse = {
              task_id: 'action-client-result',
              status: finalSuccess ? 'completed' : 'failed',
              result: finalResult,
              success: finalSuccess,
              timestamp: new Date().toISOString()
            };
            
            try {
              callbacks.onGoalComplete(goalResponse);
            } catch (callbackError) {
              console.error('RMF: Error in completion callback:', callbackError.message);
            }
          }
        }
      ).then(function(handle) {
        console.log('RMF: Goal handle received via callback');
        goalHandle = handle;
        goalAccepted = handle.isAccepted();
        console.log('RMF: Goal accepted:', goalAccepted);
        
        if (!goalAccepted) {
          console.log('RMF: Goal rejected');
          goalCompleted = true;
          
          // Call completion callback for rejection
          if (callbacks.onGoalComplete) {
            const goalResponse = {
              task_id: 'action-client-result',
              status: 'rejected',
              result: null,
              success: false,
              timestamp: new Date().toISOString()
            };
            
            try {
              callbacks.onGoalComplete(goalResponse);
            } catch (callbackError) {
              console.error('RMF: Error in completion callback:', callbackError.message);
            }
          }
        }
      }).catch(function(error) {
        console.error('RMF: Error in goal handling:', error.message);
        goalCompleted = true;
        
        // Call completion callback for error
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'action-client-result',
            status: 'failed',
            result: null,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
      });
      
      console.log('RMF: Sending goal with fire-and-forget approach...');
      
      // Send goal and immediately return - don't wait for anything
      actionClient.sendGoal(goal, (feedback) => {
        console.log('RMF: Received feedback (fire-and-forget):', feedback);
        
        // Call feedback callback if provided
        if (callbacks.onGoalFeedback) {
          try {
            callbacks.onGoalFeedback({
              task_id: 'action-client-result',
              status: 'active',
              feedback: feedback,
              timestamp: new Date().toISOString()
            });
          } catch (callbackError) {
            console.error('RMF: Error in feedback callback:', callbackError.message);
          }
        }
      });
      
      // DON'T destroy the action client in fire-and-forget mode
      // The action server may still send responses, and destroying the client
      // causes "Napi::Error: reinterpret: Cannot reinterpret from nullptr pointer"
      console.log('RMF: Action client kept alive to avoid native crashes');
      
      // Call completion callback immediately
      if (callbacks.onGoalComplete) {
        try {
          callbacks.onGoalComplete({
            task_id: 'action-client-result',
            status: 'sent',
            result: null,
            success: true,
            timestamp: new Date().toISOString()
          });
        } catch (callbackError) {
          console.error('RMF: Error in completion callback:', callbackError.message);
        }
      }
      
      return {
        success: true,
        result: null,
        message: 'Goal sent with fire-and-forget approach',
        method: rosNodeSource
      };
      
    } catch (actionError) {
      console.error('RMF: Action execution error:', actionError.message);
      
      // Clean up on error
      if (actionClient) {
        try {
          actionClient.destroy();
        } catch (destroyError) {
          console.warn('RMF: Error destroying action client after error:', destroyError.message);
        }
      }
      
      // Call completion callback for error
      if (callbacks.onGoalComplete) {
        const goalResponse = {
          task_id: 'action-client-result',
          status: 'failed',
          result: null,
          success: false,
          error: actionError.message,
          timestamp: new Date().toISOString()
        };
        
        try {
          callbacks.onGoalComplete(goalResponse);
        } catch (callbackError) {
          console.error('RMF: Error in completion callback:', callbackError.message);
        }
      }
      
      return {
        success: false,
        error: actionError.message,
        result: null,
        method: 'edu-nodered-instance'
      };
    }
    
  } catch (error) {
    console.error('RMF: Failed to send dynamic event goal with callbacks:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function sendDynamicEventGoalWithTopicFeedback(goalData, callbacks = {}) {
  try {
    console.log('RMF: Sending dynamic event goal with topic-based feedback...');
    
    // CRITICAL FIX: Use the exact same ROS2 initialization pattern as edu-nodered
    // This ensures the native bindings are initialized in the same way
    let rosNode = null;
    let rosNodeSource = 'unknown';
    
    // Try to get the edu-nodered ROS2 instance first
    try {
      const { Ros2Instance } = require('/home/asraf/.node-red/projects/rmf2_node_red/custom-nodes/edu_nodered_ros2_plugin/src/ros2/ros2-instance');
      rosNode = Ros2Instance.instance().node;
      rosNodeSource = 'edu-nodered-ros2-plugin';
      console.log('RMF: Successfully obtained edu-nodered ROS2 instance');
    } catch (error) {
      console.log('RMF: Failed to get edu-nodered ROS2 instance:', error.message);
      
      // FALLBACK: Initialize ROS2 using the EXACT same pattern as edu-nodered
      if (!context.rosInitialized) {
        console.log('RMF: Initializing ROS2 using edu-nodered pattern...');
        const rclnodejs = require('rclnodejs');
        
        // Match edu-nodered initialization exactly
        rclnodejs.init(); // Synchronous init, just like edu-nodered
        context.node = rclnodejs.createNode("rmf_node_red");
        
        // Start spinning in background (async, just like edu-nodered)
        process.nextTick(() => {
          rclnodejs.spin(context.node);
        });
        
        context.rosInitialized = true;
        console.log('RMF: ROS2 initialized using edu-nodered pattern');
      }
      
      rosNode = context.node;
      rosNodeSource = 'rmf-context-manager-edu-pattern';
    }
    
    // Verify we have a valid ROS2 node
    if (!rosNode) {
      throw new Error('No valid ROS2 node available');
    }
    
    console.log(`RMF: Using ROS2 node from: ${rosNodeSource}`);
    
    // Get the robot context to find the dynamic_event_seq
    const robot = getRobotContext(goalData.robot_name, goalData.robot_fleet);
    console.log(`RMF: Robot context for ${goalData.robot_name}:`, robot);
    
    // Get the dynamic_event_seq from the robot context
    let dynamicEventSeq = 0;
    if (robot && robot.dynamic_event_seq !== undefined) {
      dynamicEventSeq = robot.dynamic_event_seq;
      console.log(`RMF: Using dynamic_event_seq from robot context: ${dynamicEventSeq}`);
    } else {
      console.log(`RMF: Robot context not found or dynamic_event_seq not available, using default: 0`);
      
      if (goalData.dynamic_event_seq !== undefined) {
        dynamicEventSeq = goalData.dynamic_event_seq;
        console.log(`RMF: Using dynamic_event_seq from goalData: ${dynamicEventSeq}`);
      }
    }
    
    console.log(`RMF: Final dynamic_event_seq: ${dynamicEventSeq}`);
    
    // Create action client following edu-nodered-ros2-plugin pattern
    const { ActionClient } = require('rclnodejs');
    const actionServerPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log(`RMF: Using action server path: ${actionServerPath}`);
    
    let actionClient = null;
    
    try {
      // Create action client using the exact same pattern and node as edu-nodered
      actionClient = new ActionClient(
        rosNode, // Use the same ROS2 node instance
        'rmf_task_msgs/action/DynamicEvent',
        actionServerPath
      );
      
      console.log(`RMF: Action client created with ${rosNodeSource} ROS2 instance`);
      
      // Check if action server is available
      if (!actionClient.isActionServerAvailable()) {
        console.log('RMF: Action server not available');
        
        // Call completion callback for unavailable server
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'dynamic-event-result',
            status: 'failed',
            result: null,
            success: false,
            error: 'Action server not available',
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
        
        // Clean up and return
        actionClient.destroy();
        return {
          success: false,
          error: 'Action server not available',
          result: null,
          method: 'topic-based'
        };
      }
      
      console.log('RMF: Action server is available');
      
      // Set up dynamic event status subscription BEFORE sending goal
      const statusTopicPath = `/rmf/dynamic_event/status/${goalData.robot_fleet}/${goalData.robot_name}`;
      console.log(`RMF: Subscribing to dynamic event status: ${statusTopicPath}`);
      
      let statusSubscription = null;
      
      try {
        statusSubscription = rosNode.createSubscription(
          'rmf_task_msgs/msg/DynamicEventStatus',
          statusTopicPath,
          (statusMsg) => {
            try {
              // SAFETY: Create a plain object copy to avoid native binding issues
              const safeCopy = {
                dynamic_event_seq: statusMsg.dynamic_event_seq,
                dynamic_state: statusMsg.dynamic_state,
                status: statusMsg.status,
                id: statusMsg.id,
                time: statusMsg.time ? {
                  sec: statusMsg.time.sec,
                  nanosec: statusMsg.time.nanosec
                } : null
              };
              
              console.log(`RMF: Dynamic event status received:`, safeCopy);
              
              // Check if this status matches our goal sequence
              if (safeCopy.dynamic_event_seq === dynamicEventSeq) {
                console.log(`RMF: Status matches our goal sequence ${dynamicEventSeq}`);
                
                // Call feedback callback
                if (callbacks.onGoalFeedback) {
                  const feedbackData = {
                    task_id: 'dynamic-event-feedback',
                    status: safeCopy.status,
                    dynamic_event_seq: safeCopy.dynamic_event_seq,
                    dynamic_state: safeCopy.dynamic_state,
                    timestamp: new Date().toISOString(),
                    feedback: safeCopy
                  };
                  
                  try {
                    callbacks.onGoalFeedback(feedbackData);
                  } catch (callbackError) {
                    console.error('RMF: Error in feedback callback:', callbackError.message);
                  }
                }
                
                // Check for terminal states
                if (['completed', 'failed', 'canceled', 'cancelled'].includes(safeCopy.status?.toLowerCase())) {
                  console.log(`RMF: Dynamic event terminal state: ${safeCopy.status}`);
                  
                  // Call completion callback
                  if (callbacks.onGoalComplete) {
                    const goalResponse = {
                      task_id: 'dynamic-event-result',
                      status: safeCopy.status,
                      dynamic_event_seq: safeCopy.dynamic_event_seq,
                      dynamic_state: safeCopy.dynamic_state,
                      success: safeCopy.status?.toLowerCase() === 'completed',
                      timestamp: new Date().toISOString(),
                      result: safeCopy
                    };
                    
                    try {
                      callbacks.onGoalComplete(goalResponse);
                    } catch (callbackError) {
                      console.error('RMF: Error in completion callback:', callbackError.message);
                    }
                  }
                  
                  // Clean up subscription
                  setTimeout(() => {
                    if (statusSubscription) {
                      try {
                        statusSubscription.destroy();
                        console.log('RMF: Dynamic event status subscription cleaned up');
                      } catch (cleanupError) {
                        console.warn('RMF: Error cleaning up status subscription:', cleanupError.message);
                      }
                    }
                  }, 100);
                }
              }
              
            } catch (subscriptionCallbackError) {
              console.error('RMF: Error in subscription callback:', subscriptionCallbackError.message);
              
              // Clean up subscription on error
              setTimeout(() => {
                if (statusSubscription) {
                  try {
                    statusSubscription.destroy();
                    console.log('RMF: Dynamic event status subscription cleaned up after error');
                  } catch (cleanupError) {
                    console.warn('RMF: Error cleaning up status subscription:', cleanupError.message);
                  }
                }
              }, 100);
            }
          }
        );
        
        console.log('RMF: Dynamic event status subscription created');
        
      } catch (subscriptionError) {
        console.error('RMF: Failed to create status subscription:', subscriptionError.message);
        // Continue without subscription - we'll still send the goal
      }
      
      // Create goal message
      const goal = {
        event_type: 1,
        category: 'go_to_place',
        description: JSON.stringify({
          waypoint: goalData.location_name
        }),
        dynamic_event_seq: dynamicEventSeq,
        stubborn_period: goalData.stubborn_period || 0
      };
      
      console.log('RMF: Sending dynamic event goal (topic-based feedback):', goal);
      
      // FIRE-AND-FORGET: Send goal without waiting for response
      actionClient.sendGoal(goal).then(goalHandle => {
        console.log('RMF: Goal sent successfully, goal handle received');
        console.log('RMF: Fire-and-forget mode - not waiting for result');
        
        // CRITICAL FIX: Destroy the action client immediately after goal is accepted
        // This prevents the action server from sending completion results that cause crashes
        setTimeout(() => {
          try {
            actionClient.destroy();
            console.log('RMF: Action client destroyed immediately after goal sent to prevent completion crashes');
          } catch (destroyError) {
            console.warn('RMF: Error destroying action client:', destroyError.message);
          }
        }, 500); // Small delay to ensure goal is processed
        
      }).catch(error => {
        console.error('RMF: Goal sending failed:', error.message);
        
        // Call completion callback for sending failure
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'dynamic-event-result',
            status: 'failed',
            result: null,
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
        
        // Clean up subscription on error
        if (statusSubscription) {
          try {
            statusSubscription.destroy();
          } catch (cleanupError) {
            console.warn('RMF: Error cleaning up status subscription:', cleanupError.message);
          }
        }
        
        // DO NOT destroy action client - let it live to prevent crashes
      });
      
      // DO NOT destroy action client in fire-and-forget mode
      // Destroying it while the action server is still processing causes native crashes
      // Let the action client live for the duration of the Node-RED process
      console.log('RMF: Action client kept alive to avoid native crashes');
      
      return {
        success: true,
        result: null,
        method: 'topic-based-feedback',
        dynamic_event_seq: dynamicEventSeq,
        status_topic: statusTopicPath,
        note: 'Action client kept alive to prevent crashes'
      };
      
    } catch (actionError) {
      console.error('RMF: Action client error:', actionError.message);
      
      // Call completion callback for action error
      if (callbacks.onGoalComplete) {
        const goalResponse = {
          task_id: 'dynamic-event-result',
          status: 'failed',
          result: null,
          success: false,
          error: actionError.message,
          timestamp: new Date().toISOString()
        };
        
        try {
          callbacks.onGoalComplete(goalResponse);
        } catch (callbackError) {
          console.error('RMF: Error in completion callback:', callbackError.message);
        }
      }
      
      return {
        success: false,
        error: actionError.message,
        result: null,
        method: 'topic-based-feedback'
      };
    }
    
  } catch (error) {
    console.error('RMF: Failed to send dynamic event goal with topic feedback:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

async function sendDynamicEventGoalWithPolling(goalData, callbacks = {}) {
  try {
    console.log('RMF: Sending dynamic event goal with polling-based feedback...');
    
    // CRITICAL FIX: Use the exact same ROS2 initialization pattern as edu-nodered
    // This ensures the native bindings are initialized in the same way
    let rosNode = null;
    let rosNodeSource = 'unknown';
    
    // Try to get the edu-nodered ROS2 instance first
    try {
      const { Ros2Instance } = require('/home/asraf/.node-red/projects/rmf2_node_red/custom-nodes/edu_nodered_ros2_plugin/src/ros2/ros2-instance');
      rosNode = Ros2Instance.instance().node;
      rosNodeSource = 'edu-nodered-ros2-plugin';
      console.log('RMF: Successfully obtained edu-nodered ROS2 instance');
    } catch (error) {
      console.log('RMF: Failed to get edu-nodered ROS2 instance:', error.message);
      
      // FALLBACK: Initialize ROS2 using the EXACT same pattern as edu-nodered
      if (!context.rosInitialized) {
        console.log('RMF: Initializing ROS2 using edu-nodered pattern...');
        const rclnodejs = require('rclnodejs');
        
        // Match edu-nodered initialization exactly
        rclnodejs.init(); // Synchronous init, just like edu-nodered
        context.node = rclnodejs.createNode("rmf_node_red");
        
        // Start spinning in background (async, just like edu-nodered)
        process.nextTick(() => {
          rclnodejs.spin(context.node);
        });
        
        context.rosInitialized = true;
        console.log('RMF: ROS2 initialized using edu-nodered pattern');
      }
      
      rosNode = context.node;
      rosNodeSource = 'rmf-context-manager-edu-pattern';
    }
    
    // Verify we have a valid ROS2 node
    if (!rosNode) {
      throw new Error('No valid ROS2 node available');
    }
    
    console.log(`RMF: Using ROS2 node from: ${rosNodeSource}`);
    
    // Get the robot context to find the dynamic_event_seq
    const robot = getRobotContext(goalData.robot_name, goalData.robot_fleet);
    console.log(`RMF: Robot context for ${goalData.robot_name}:`, robot);
    
    // Get the dynamic_event_seq from the robot context
    let dynamicEventSeq = 0;
    if (robot && robot.dynamic_event_seq !== undefined) {
      dynamicEventSeq = robot.dynamic_event_seq;
      console.log(`RMF: Using dynamic_event_seq from robot context: ${dynamicEventSeq}`);
    } else {
      console.log(`RMF: Robot context not found or dynamic_event_seq not available, using default: 0`);
      
      if (goalData.dynamic_event_seq !== undefined) {
        dynamicEventSeq = goalData.dynamic_event_seq;
        console.log(`RMF: Using dynamic_event_seq from goalData: ${dynamicEventSeq}`);
      }
    }
    
    console.log(`RMF: Final dynamic_event_seq: ${dynamicEventSeq}`);
    
    // Create action client
    const { ActionClient } = require('rclnodejs');
    const actionServerPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log(`RMF: Using action server path: ${actionServerPath}`);
    
    let actionClient = null;
    
    try {
      // Create action client
      actionClient = new ActionClient(
        rosNode,
        'rmf_task_msgs/action/DynamicEvent',
        actionServerPath
      );
      
      console.log(`RMF: Action client created with ${rosNodeSource} ROS2 instance`);
      
      // Check if action server is available
      if (!actionClient.isActionServerAvailable()) {
        console.log('RMF: Action server not available');
        
        // Call completion callback for unavailable server
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'dynamic-event-result',
            status: 'failed',
            result: null,
            success: false,
            error: 'Action server not available',
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
        
        // Clean up and return
        actionClient.destroy();
        return {
          success: false,
          error: 'Action server not available',
          result: null,
          method: 'polling-based'
        };
      }
      
      console.log('RMF: Action server is available');
      
      // Create goal message
      const goal = {
        event_type: 1,
        category: 'go_to_place',
        description: JSON.stringify({
          waypoint: goalData.location_name
        }),
        dynamic_event_seq: dynamicEventSeq,
        stubborn_period: goalData.stubborn_period || 0
      };
      
      console.log('RMF: Sending dynamic event goal (polling-based feedback):', goal);
      
      // TRULY FIRE-AND-FORGET: Send goal without any promise handling
      // Don't even try to access the goal handle as it causes native binding crashes
      console.log('RMF: Sending goal in true fire-and-forget mode (no promise handling)');
      
      try {
        // Send goal but don't wait for or handle the promise
        actionClient.sendGoal(goal);
        console.log('RMF: Goal sent successfully (no promise handling)');
        
        // Destroy the action client immediately to prevent any callbacks
        setTimeout(() => {
          try {
            actionClient.destroy();
            console.log('RMF: Action client destroyed immediately to prevent native binding crashes');
          } catch (destroyError) {
            console.warn('RMF: Error destroying action client:', destroyError.message);
          }
        }, 100); // Very short delay
        
      } catch (sendError) {
        console.error('RMF: Error sending goal:', sendError.message);
        
        // Call completion callback for sending failure
        if (callbacks.onGoalComplete) {
          const goalResponse = {
            task_id: 'dynamic-event-result',
            status: 'failed',
            result: null,
            success: false,
            error: sendError.message,
            timestamp: new Date().toISOString()
          };
          
          try {
            callbacks.onGoalComplete(goalResponse);
          } catch (callbackError) {
            console.error('RMF: Error in completion callback:', callbackError.message);
          }
        }
        
        // Also destroy on error
        try {
          actionClient.destroy();
        } catch (destroyError) {
          console.warn('RMF: Error destroying action client after error:', destroyError.message);
        }
      }
      
      // Don't keep the action client alive - destroy it after goal is sent
      console.log('RMF: Action client will be destroyed after goal is processed to prevent completion crashes');
      
      // Set up polling for status updates instead of subscription callback
      const statusTopicPath = `/rmf/dynamic_event/status/${goalData.robot_fleet}/${goalData.robot_name}`;
      console.log(`RMF: Starting polling for dynamic event status on: ${statusTopicPath}`);
      
      let pollingActive = true;
      let lastStatus = null;
      
      // Use a simple polling mechanism instead of subscription callback
      const pollInterval = setInterval(() => {
        if (!pollingActive) {
          clearInterval(pollInterval);
          return;
        }
        
        try {
          // Instead of subscription callback, we'll use the existing RMF fleet state data
          // which already contains dynamic event information
          const robot = getRobotContext(goalData.robot_name, goalData.robot_fleet);
          
          if (robot && robot.dynamic_event_seq === dynamicEventSeq) {
            const currentStatus = robot.dynamic_event_status || 'unknown';
            
            // Only process if status changed
            if (currentStatus !== lastStatus) {
              lastStatus = currentStatus;
              
              console.log(`RMF: Dynamic event status (polling): ${currentStatus}`);
              
              // Call feedback callback
              if (callbacks.onGoalFeedback) {
                const feedbackData = {
                  task_id: 'dynamic-event-feedback',
                  status: currentStatus,
                  dynamic_event_seq: dynamicEventSeq,
                  timestamp: new Date().toISOString(),
                  feedback: { status: currentStatus }
                };
                
                try {
                  callbacks.onGoalFeedback(feedbackData);
                } catch (callbackError) {
                  console.error('RMF: Error in feedback callback:', callbackError.message);
                }
              }
              
              // Check for terminal states
              if (['completed', 'failed', 'canceled', 'cancelled'].includes(currentStatus?.toLowerCase())) {
                console.log(`RMF: Dynamic event terminal state: ${currentStatus}`);
                
                // Call completion callback
                if (callbacks.onGoalComplete) {
                  const goalResponse = {
                    task_id: 'dynamic-event-result',
                    status: currentStatus,
                    dynamic_event_seq: dynamicEventSeq,
                    success: currentStatus?.toLowerCase() === 'completed',
                    timestamp: new Date().toISOString(),
                    result: { status: currentStatus }
                  };
                  
                  try {
                    callbacks.onGoalComplete(goalResponse);
                  } catch (callbackError) {
                    console.error('RMF: Error in completion callback:', callbackError.message);
                  }
                }
                
                // Stop polling
                pollingActive = false;
                clearInterval(pollInterval);
              }
            }
          }
          
        } catch (pollingError) {
          console.error('RMF: Error in polling:', pollingError.message);
          
          // Stop polling on error
          pollingActive = false;
          clearInterval(pollInterval);
        }
      }, 1000); // Poll every second
      
      // Set up timeout to stop polling after 30 seconds
      setTimeout(() => {
        if (pollingActive) {
          console.log('RMF: Polling timeout reached');
          pollingActive = false;
          clearInterval(pollInterval);
        }
      }, 30000);
      
      return {
        success: true,
        result: null,
        method: 'polling-based-feedback',
        dynamic_event_seq: dynamicEventSeq,
        status_topic: statusTopicPath
      };
      
    } catch (actionError) {
      console.error('RMF: Action client error:', actionError.message);
      
      // Call completion callback for action error
      if (callbacks.onGoalComplete) {
        const goalResponse = {
          task_id: 'dynamic-event-result',
          status: 'failed',
          result: null,
          success: false,
          error: actionError.message,
          timestamp: new Date().toISOString()
        };
        
        try {
          callbacks.onGoalComplete(goalResponse);
        } catch (callbackError) {
          console.error('RMF: Error in completion callback:', callbackError.message);
        }
      }
      
      return {
        success: false,
        error: actionError.message,
        result: null,
        method: 'polling-based-feedback'
      };
    }
    
  } catch (error) {
    console.error('RMF: Failed to send dynamic event goal with polling:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

// Persistent action client management to prevent memory corruption
function getPersistentActionClient(robotFleet, robotName) {
  const currentPath = `/rmf/dynamic_event/command/${robotFleet}/${robotName}`;
  
  // If we already have a client for this path, return it
  if (persistentActionClient && actionClientPath === currentPath) {
    console.log(`RMF: Reusing existing safe action client for ${currentPath}`);
    return persistentActionClient;
  }
  
  // Clean up existing client if path changed
  if (persistentActionClient) {
    console.log(`RMF: Path changed from ${actionClientPath} to ${currentPath}, cleaning up old client`);
    try {
      persistentActionClient.destroy();
    } catch (error) {
      console.warn('RMF: Error destroying old safe action client:', error.message);
    }
    persistentActionClient = null;
  }
  
  // Create new safe client
  try {
    persistentActionClient = new SafeActionClient(
      context.node,
      'rmf_task_msgs/action/DynamicEvent',
      currentPath
    );
    actionClientPath = currentPath;
    console.log(`RMF: Created new safe persistent action client for ${currentPath}`);
    return persistentActionClient;
  } catch (error) {
    console.error('RMF: Failed to create safe persistent action client:', error.message);
    throw error;
  }
}

function cleanupPersistentActionClient() {
  if (persistentActionClient) {
    try {
      console.log('RMF: Cleaning up safe persistent action client');
      
      // Proper action client cleanup
      if (typeof persistentActionClient.destroy === 'function') {
        persistentActionClient.destroy();
      }
      
    } catch (error) {
      console.warn('RMF: Error cleaning up safe persistent action client:', error.message);
    }
    persistentActionClient = null;
    actionClientPath = null;
  }
}

// Update robot context with new information
function updateRobotContext(robotName, fleetName, updates) {
  try {
    const robotIndex = context.robots.findIndex(r => 
      r.name === robotName && r.fleet === fleetName
    );
    
    if (robotIndex !== -1) {
      context.robots[robotIndex] = {
        ...context.robots[robotIndex],
        ...updates
      };
      
      // Trigger context update
      updateGlobalContext();
      
      console.log(`RMF: Updated robot ${robotName} (${fleetName}) context:`, updates);
      return { success: true };
    } else {
      console.warn(`RMF: Robot ${robotName} from fleet ${fleetName} not found in context`);
      return { success: false, error: 'Robot not found' };
    }
    
  } catch (error) {
    console.error('RMF: Failed to update robot context:', error.message);
    return { success: false, error: error.message };
  }
}

// Get robot context by name and fleet
function getRobotContext(robotName, fleetName) {
  try {
    const robot = context.robots.find(r => 
      r.name === robotName && r.fleet === fleetName
    );
    
    if (robot) {
      console.log(`RMF: Found robot context for ${robotName} (${fleetName}):`, robot);
      return robot;
    } else {
      console.log(`RMF: Robot ${robotName} from fleet ${fleetName} not found in context`);
      return null;
    }
    
  } catch (error) {
    console.error('RMF: Failed to get robot context:', error.message);
    return null;
  }
}

// External initialization function for testing
async function initialize(config) {
  try {
    // Set ROS domain ID
    if (config.domainId) {
      process.env.RCLNODEJS_ROS_DOMAIN_ID = config.domainId;
    }
    
    // Initialize RMF context
    await initROS2();
    
    // Connect socket if config provided
    if (config.host && config.port) {
      await connectSocket({ 
        host: config.host, 
        port: config.port, 
        jwt: config.jwt 
      });
    }
    
    return {
      success: true,
      message: 'RMF context initialized successfully'
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
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
  subscribeToTaskStatus,
  unsubscribeFromTaskStatus,
  sendDynamicEventGoal,
  sendDynamicEventGoalWithCallback,
  sendDynamicEventGoalWithTopicFeedback,
  sendDynamicEventGoalWithPolling,
  sendDynamicEventGoalWithEduPattern,
  updateRobotContext,
  getRobotContext,
  debugROS2Node,
  getPersistentActionClient,
  // cleanupPersistentActionClient, // Temporarily disabled due to reference error
};
