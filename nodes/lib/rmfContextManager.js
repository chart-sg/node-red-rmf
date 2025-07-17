// File: nodes/lib/rmfContextManager.js
const rclnodejs = require('rclnodejs');
const io = require('socket.io-client');
const RMFRosInitializer = require('./rmfRosInitializer');
const RMFSubscriptions = require('./rmfSubscriptions');
const { RMF_Ros2Instance } = require('./rmf-ros2-instance');
const { RMF_ActionClient } = require('./rmf-action-client');
const { SafeServiceClient } = require('./rmf-safe-service-client');

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

  // Clean up persistent action client first (idempotent)
  try {
    if (typeof cleanupPersistentActionClient === 'function') {
      cleanupPersistentActionClient();
    }
  } catch (error) {
    console.warn('Error during persistent action client cleanup:', error);
  }

  // Clean up subscriptions first (idempotent)
  if (subscriptionsManager) {
    try {
      console.log('Cleaning up RMF subscriptions...');
      if (typeof subscriptionsManager.cleanup === 'function') {
        subscriptionsManager.cleanup();
      }
      subscriptionsManager = null;
      console.log('RMF subscriptions cleaned up');
    } catch (error) {
      console.error('RMF subscription cleanup failed:', error);
    }
  }

  // Clean up ROS resources using the new singleton pattern (idempotent)
  try {
    console.log('Implementing proper ROS2 shutdown sequence (singleton pattern)...');
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

  // Clean up legacy ROS resources if they exist (idempotent)
  if (context.node) {
    try {
      console.log('Cleaning up legacy ROS2 resources...');
      // Step 1: Stop spinning first (if applicable)
      if (context.node.spinning && typeof context.node.stop === 'function') {
        console.log('Stopping legacy ROS2 node spin...');
        try { context.node.stop(); } catch (e) { /* ignore */ }
      }
      // Step 2: Destroy all entities in proper order
      console.log('Destroying legacy ROS2 entities...');
      // Destroy any remaining subscriptions
      if (context.subscribers) {
        Object.values(context.subscribers).forEach(sub => {
          if (sub && typeof sub.destroy === 'function' && (!sub.isDestroyed || !sub.isDestroyed())) {
            try { sub.destroy(); } catch (error) { console.warn('Error destroying subscription:', error.message); }
          }
        });
        context.subscribers = {};
      }
      // Step 3: Destroy the node
      if (typeof context.node.destroy === 'function') {
        console.log('Destroying legacy ROS2 node...');
        try { context.node.destroy(); } catch (e) { /* ignore */ }
      }
      context.node = null;
      // Step 4: Shutdown rclnodejs context (only if singleton didn't already do it)
      if (context.rosInitialized) {
        try {
          console.log('Shutting down legacy rclnodejs...');
          // rclnodejs.shutdown();
          console.log('Legacy rclnodejs shutdown skipped (singleton handles it)');
        } catch (error) {
          console.error('Error during legacy rclnodejs shutdown:', error.message);
        }
        context.rosInitialized = false;
      }
      // Step 5: Reset global state
      globalRosState.isInitialized = false;
      globalRosState.isInitializing = false;
      globalRosState.initPromise = null;
      globalRosState.error = null;
    } catch (error) {
      console.error('Error during ROS2 cleanup:', error.message);
    }
  }

  // Clean up ROS initializer (idempotent)
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

  // Clean up socket (idempotent)
  if (context.socket) {
    try {
      console.log('Disconnecting socket...');
      if (typeof context.socket.disconnect === 'function') {
        context.socket.disconnect();
      }
      context.socket = null;
      console.log('Socket cleanup completed');
    } catch (error) {
      console.error('Socket cleanup failed:', error);
    }
  }

  // Clear RMF data (idempotent)
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
  if (subscriptionsManager && typeof subscriptionsManager.requestBuildingMap === 'function') {
    return await subscriptionsManager.requestBuildingMap();
  }
  console.warn('RMF: subscriptionsManager is null or does not have requestBuildingMap. Skipping building map request.');
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


// Unified sendDynamicEventGoal: edu-pattern only
async function sendDynamicEventGoal(goalData, callbacks = {}) {
  let safeActionClient = null;
  try {
    console.log('RMF: Using safe action client wrapper...');
    const { Ros2Instance } = require('./rmf-ros2-instance');
    const { SafeActionClient } = require('./rmf-safe-action-client');
    const actionPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log('RMF: Using action server path:', actionPath);
    safeActionClient = new SafeActionClient(
      Ros2Instance.instance().node,
      'rmf_task_msgs/action/DynamicEvent',
      actionPath
    );
    await safeActionClient.initialize();
    console.log('RMF: Safe action client initialized');
    if (!safeActionClient.isActionServerAvailable()) {
      console.log('RMF: Action server not available, cleaning up and returning error');
      safeActionClient.destroy();
      safeActionClient = null;
      return {
        success: false,
        error: `Action server not available at ${actionPath}`
      };
    }
    console.log('RMF: Action server is available');
    // Derive dynamic_event_seq from robot context, fallback to goalData, else 0
    let dynamicEventSeq = 0;
    const robot = getRobotContext(goalData.robot_name, goalData.robot_fleet);
    if (robot && robot.dynamic_event_seq !== undefined) {
      dynamicEventSeq = robot.dynamic_event_seq;
      console.log(`RMF: Using dynamic_event_seq from robot context: ${dynamicEventSeq}`);
    } else if (goalData.dynamic_event_seq !== undefined) {
      dynamicEventSeq = goalData.dynamic_event_seq;
      console.log(`RMF: Using dynamic_event_seq from goalData: ${dynamicEventSeq}`);
    } else {
      console.log('RMF: No dynamic_event_seq found in robot context or goalData, using default: 0');
    }
    const goal = {
      event_type: goalData.event_type || 1,
      category: goalData.category || 'go_to_place',
      description: goalData.description || JSON.stringify({ waypoint: goalData.location_name }),
      dynamic_event_seq: dynamicEventSeq,
      stubborn_period: goalData.stubborn_period || 0.0
    };
    console.log('RMF: Sending goal (safe wrapper):', goal);
    const goalHandle = await safeActionClient.sendGoal(goal, function (feedback) {
      console.log('RMF: Feedback received:', feedback);
      if (callbacks.onFeedback) {
        callbacks.onFeedback(feedback);
      }
    });
    if (!goalHandle.isAccepted()) {
      console.log('RMF: Goal was rejected');
      const result = await goalHandle.getResult();
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
    safeActionClient.destroy();
    safeActionClient = null;
    console.log('RMF: Safe action client destroyed');
    return {
      success: success,
      result: result
    };
  } catch (error) {
    console.error('RMF: Error in sendDynamicEventGoal:', error.message);
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
  updateRobotContext,
  getRobotContext,
  debugROS2Node
};
