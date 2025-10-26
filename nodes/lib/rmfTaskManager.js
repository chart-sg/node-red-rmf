// File: nodes/lib/rmfTaskManager.js
const { context, rmfEvents } = require('./rmfCore');

// Import ROS2 bridge interface to get the correct node ID
let ros2BridgeInterface = null;
try {
  const { getROS2BridgeInterface } = require('./ros2-bridge-interface');
  ros2BridgeInterface = getROS2BridgeInterface();
} catch (error) {
  console.error('RMF: Failed to import ros2-bridge-interface in rmfTaskManager:', error.message);
}

// Robot context provider - will be set by the context manager
let robotContextProvider = null;

/**
 * Get the correct ROS2 node ID from the bridge interface
 * @returns {string} The actual node ID created by the bridge
 */
function getROS2NodeId() {
  if (ros2BridgeInterface) {
    const status = ros2BridgeInterface.getStatus();
    if (status.nodeId) {
      return status.nodeId;
    }
  }
  // Fallback to the expected name if bridge interface is not available
  return 'node_red_rmf_manager';
}

/**
 * Set the robot context provider (called by context manager)
 * @param {Object} provider - Object with updateRobotContext and getRobotContext methods
 */
function setRobotContextProvider(provider) {
  robotContextProvider = provider;
}

/**
 * Create an RMF task using the RMF API
 * @param {Object} taskData - Task configuration data
 * @param {Object} configNode - RMF configuration node with host, port, jwt
 * @returns {Promise<Object>} Task creation result
 */
async function createRMFTask(taskData, configNode) {
  try {
    if (!configNode) {
      throw new Error('No RMF config provided');
    }
    
    const axios = require('axios');
    const { host, port, jwt } = configNode;
    
    let taskPayload;
    let endpoint;
    
    // Check if this is a zone task (indicated by zone_name or location_type === 'zone')
    const isZoneTask = taskData.zone_name || taskData.location_type === 'zone' || taskData.is_zone;
    
    if (isZoneTask) {
      // Create zone task payload
      const zoneName = taskData.zone_name || taskData.location_name;
      const zoneTypes = taskData.zone_type ? [taskData.zone_type] : ['default'];
      const places = [];
      
      // Add preferred waypoint if specified
      if (taskData.zone_preferred_waypoint) {
        places.push({
          "waypoint": taskData.zone_preferred_waypoint
        });
      }
      
      const zoneDescription = {
        "zone": zoneName,
        "types": zoneTypes
      };
      
      // Only add places if we have any
      if (places.length > 0) {
        zoneDescription.places = places;
      }
      
      // Build zone task request
      const zoneRequest = {
        "category": "zone",
        "description": zoneDescription,
        "unix_millis_request_time": 0,
        "unix_millis_earliest_start_time": 0,
        "requester": "NR"
      };
      
      // Add priority if specified
      if (taskData.priority !== undefined) {
        zoneRequest.priority = {
          "type": "binary",
          "value": taskData.priority
        };
      }
      
      // Check if we have a specific robot or should use dispatch
      if (taskData.robot_name && taskData.robot_fleet) {
        // Use robot_task_request for specific robot assignment
        taskPayload = {
          "type": "robot_task_request",
          "robot": taskData.robot_name,
          "fleet": taskData.robot_fleet,
          "request": zoneRequest
        };
        endpoint = '/tasks/robot_task';
      } else if (taskData.robot_fleet) {
        // Use dispatch_task_request for fleet-based assignment
        zoneRequest.fleet_name = taskData.robot_fleet;
        taskPayload = {
          "type": "dispatch_task_request",
          "request": zoneRequest
        };
        endpoint = '/tasks/dispatch_task';
      } else {
        // Use general dispatch_task_request when no robot or fleet specified
        taskPayload = {
          "type": "dispatch_task_request",
          "request": zoneRequest
        };
        endpoint = '/tasks/dispatch_task';
      }
    } else {
      // Create regular dynamic event task payload (existing logic)
      // Create the description for the activity - only include estimate if it exists
      let description = {};
      if (taskData.estimate && Object.keys(taskData.estimate).length > 0) {
        description = { "estimate": taskData.estimate };
      }
      
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
        // Use general dispatch_task_request when no robot or fleet specified
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
            "unix_millis_request_time": 0,
            "unix_millis_earliest_start_time": 0,
            "requester": "NR"
          }
        };
        endpoint = '/tasks/dispatch_task';
      }
    }
    
    // Debug logging for the payload
    console.log(`RMF: Creating task with endpoint: ${endpoint}`);
    console.log(`RMF: Task payload:`, JSON.stringify(taskPayload, null, 2));
    
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

/**
 * Create RMF Task V2 with static compose structure
 * @param {Object} taskRequest - Task V2 request payload
 * @param {Object} configNode - RMF configuration node
 * @returns {Promise<Object>} Creation result
 */
async function createTaskV2(taskRequest, configNode) {
  try {
    if (!configNode) {
      throw new Error('No RMF config provided');
    }
    
    const axios = require('axios');
    const { host, port, jwt } = configNode;
    
    // Add required fields to request
    if (!taskRequest.request.unix_millis_request_time) {
      taskRequest.request.unix_millis_request_time = 0;
    }
    if (!taskRequest.request.unix_millis_earliest_start_time) {
      taskRequest.request.unix_millis_earliest_start_time = 0;
    }
    if (!taskRequest.request.requester) {
      taskRequest.request.requester = "NR";
    }
    
    // Determine endpoint based on request type
    let endpoint;
    if (taskRequest.type === 'robot_task_request') {
      endpoint = '/tasks/robot_task';
    } else if (taskRequest.type === 'dispatch_task_request') {
      endpoint = '/tasks/dispatch_task';
    } else {
      throw new Error(`Unsupported task request type: ${taskRequest.type}`);
    }
    
    // Debug logging
    console.log(`RMF: Creating Task V2 with endpoint: ${endpoint}`);
    console.log(`RMF: Task V2 payload:`, JSON.stringify(taskRequest, null, 2));
    
    const response = await axios.post(`http://${host}:${port}${endpoint}`, taskRequest, {
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
    console.error('RMF: Failed to create Task V2:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Subscribe to task status updates via WebSocket and polling
 * @param {string} taskId - Task ID to subscribe to
 * @param {Function} onStatusUpdate - Callback for status updates
 * @param {Object} configNode - RMF configuration node
 * @param {Object} options - Additional options with callbacks
 * @returns {Promise<Object>} Subscription result
 */
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

/**
 * Unsubscribe from task status updates and clean up resources
 * @param {string} taskId - Task ID to unsubscribe from
 * @returns {Promise<Object>} Unsubscription result
 */
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

/**
 * Get all active task subscriptions
 * @returns {Object} Active task subscriptions
 */
function getActiveTaskSubscriptions() {
  return Object.keys(context.taskSubscriptions || {});
}

/**
 * Clean up all task subscriptions
 * @returns {Promise<void>}
 */
async function cleanupAllTaskSubscriptions() {
  const activeSubscriptions = getActiveTaskSubscriptions();
  console.log(`RMF: Cleaning up ${activeSubscriptions.length} active task subscriptions`);
  
  const cleanupPromises = activeSubscriptions.map(taskId => 
    unsubscribeFromTaskStatus(taskId)
  );
  
  await Promise.all(cleanupPromises);
  console.log('RMF: All task subscriptions cleaned up');
}

/**
 * Get task subscription statistics
 * @returns {Object} Task subscription statistics
 */
function getTaskSubscriptionStats() {
  const subscriptions = context.taskSubscriptions || {};
  return {
    activeSubscriptions: Object.keys(subscriptions).length,
    subscriptionDetails: Object.keys(subscriptions).map(taskId => ({
      taskId,
      room: subscriptions[taskId].room,
      hasEventHandlers: !!subscriptions[taskId].eventHandlers,
      hasPolling: !!subscriptions[taskId].pollInterval,
      options: subscriptions[taskId].options
    }))
  };
}

/**
 * Send a cancel or end event for a dynamic event.
 * @param {'cancel'|'end'} type - Type of event to send ('cancel' or 'end')
 * @param {Object} robot - Robot context object (must have robot_name, robot_fleet, dynamic_event_seq, dynamic_event_id)
 * @param {Object} [options] - Optional callbacks for feedback/complete
 * @returns {Promise<Object>} Result from action client
 */
async function sendDynamicEventControl(type, robot, options = {}) {
  // Send dynamic event control (cancel/end) goal
  
  if (!robot || !robot.robot_name || !robot.robot_fleet || !robot.dynamic_event_seq) {
    throw new Error('Robot context must include robot_name, robot_fleet, and dynamic_event_seq');
  }
  let goal = {
    robot_name: robot.robot_name,
    robot_fleet: robot.robot_fleet,
    dynamic_event_seq: robot.dynamic_event_seq
  };
  
  if (type === 'cancel') {
    // For cancel operations, we need some form of ID
    // Prefer dynamic_event_id, but fall back to dynamic_event_seq if needed
    let eventId = robot.dynamic_event_id;
    if (eventId === undefined) {
      console.warn(`[RMF][WARN] No dynamic_event_id available for cancel, using dynamic_event_seq (${robot.dynamic_event_seq}) as fallback`);
      eventId = robot.dynamic_event_seq;
      if (eventId === undefined) {
        throw new Error('Robot context must include dynamic_event_id or dynamic_event_seq for cancel event');
      }
    }
    goal.event_type = 2;
    // Ensure id is BigInt for ROS2 compatibility
    goal.id = typeof eventId === 'bigint' ? eventId : BigInt(eventId);
    console.log(`[RMF][DEBUG] Cancel goal - using event ID type: ${typeof eventId}, value: ${eventId}, goal.id: ${goal.id}`);
  } else if (type === 'end') {
    goal.event_type = 3;
  } else {
    throw new Error('Invalid type for sendDynamicEventControl: ' + type);
  }
  
  // Send the dynamic event control goal
  return await sendDynamicEventGoal(goal, options);
}

// Global state to track active end events to prevent duplicates
let activeEndEvents = new Set();

/**
 * Send a dynamic event goal using the ROS2 action client
 * @param {Object} goalData - Goal data to send
 * @param {Object} callbacks - Callbacks for feedback and completion
 * @returns {Promise<Object>} Result from action client
 */
async function sendDynamicEventGoal(goalData, callbacks = {}) {
  let safeActionClient = null;
  try {
    // For end events, check if there's already an active end event for this robot
    if (goalData.event_type === 3) { // end event
      const robotKey = `${goalData.robot_fleet}/${goalData.robot_name}`;
      if (activeEndEvents.has(robotKey)) {
        console.log(`RMF: End event already in progress for robot ${robotKey}, skipping duplicate`);
        return {
          success: false,
          error: 'End event already in progress for this robot'
        };
      }
      // Mark this robot as having an active end event
      activeEndEvents.add(robotKey);
      console.log(`RMF: Marked ${robotKey} as having active end event`);
    }
    console.log('RMF: Using safe action client wrapper...');
    const { SafeActionClient } = require('./rmf-safe-action-client');
    const actionPath = `/rmf/dynamic_event/command/${goalData.robot_fleet}/${goalData.robot_name}`;
    console.log('RMF: Using action server path:', actionPath);
    
    // Get the correct node ID from the bridge interface
    const nodeId = getROS2NodeId();
    console.log(`RMF: Using node ID: ${nodeId}`);
    
    // Create action client with bridge-managed persistent pattern
    safeActionClient = new SafeActionClient(
      nodeId, // Use the actual node ID from bridge
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

    // Construct description and category
    let description = goalData.description;
    let category = goalData.category || 'go_to_place';
    
    // If zone data is detected, update category
    const hasZoneTypes = (goalData.zone_types && goalData.zone_types.length > 0) || 
                        (goalData.zone_type && goalData.zone_type !== '' && goalData.zone_type !== 'all');
    
    if (hasZoneTypes || goalData.location_type === 'zone') {
      category = 'zone';
      console.log(`RMF: Zone dynamic event detected for: ${goalData.location_name}`);
    } else {
      console.log(`RMF: Standard dynamic event for waypoint: ${goalData.location_name}`);
    }
    
    // Ensure description is always stringified JSON for RMF action goal
    if (typeof description === 'object') {
      description = JSON.stringify(description);
    } else if (!description) {
      description = JSON.stringify({ waypoint: goalData.location_name });
    }
    
    const goal = {
      event_type: goalData.event_type || 1,
      category: category,
      description: description,
      dynamic_event_seq: dynamicEventSeq,
      stubborn_period: goalData.stubborn_period || 0.0
    };
    
    // Include id field for cancel operations
    if (goalData.id !== undefined) {
      goal.id = goalData.id;
      console.log(`[RMF][DEBUG] Including id field in goal: ${goal.id}`);
    }
    
    // Send the dynamic event goal
    const goalHandle = await safeActionClient.sendGoal(goal, function (feedback) {
      console.log('RMF: Feedback received:', feedback);
      // Update robot context with dynamic_event_status and dynamic_event_id if present in feedback
      if (feedback && goalData.robot_name && goalData.robot_fleet) {
        const updates = { dynamic_event_status: feedback.status };
        if (feedback.id !== undefined) {
          try {
            updates.dynamic_event_id = BigInt(feedback.id.toString());
          } catch (e) {
            console.warn(`[RMF][WARN] Could not convert feedback.id to BigInt: ${feedback.id}`);
          }
        }
        if (feedback.dynamic_event_id !== undefined) {
          try {
            updates.dynamic_event_id = BigInt(feedback.dynamic_event_id.toString());
          } catch (e) {
            console.warn(`[RMF][WARN] Could not convert feedback.dynamic_event_id to BigInt: ${feedback.dynamic_event_id}`);
          }
        }
        updateRobotContext(goalData.robot_name, goalData.robot_fleet, updates);
      }
      if (callbacks.onFeedback) {
        callbacks.onFeedback(feedback);
      }
    });
    
    // Check if goal was accepted immediately after sending
    if (!goalHandle.isAccepted()) {
      console.log('RMF: Goal was rejected');
      safeActionClient.destroy();
      safeActionClient = null;
      
      // For end events, remove from active tracking on rejection
      if (goalData.event_type === 3) {
        const robotKey = `${goalData.robot_fleet}/${goalData.robot_name}`;
        activeEndEvents.delete(robotKey);
        console.log(`RMF: Removed ${robotKey} from active end events tracking (goal rejected)`);
      }
      
      // Call completion callback if provided
      if (callbacks.onGoalComplete) {
        const completionData = {
          success: false,
          status: 'rejected',
          timestamp: new Date().toISOString(),
          result: null
        };
        callbacks.onGoalComplete(completionData);
      }
      
      // Reset dynamic_event_status to 'active' for rejected non-end events
      // This ensures robot context stays consistent even when goals are rejected
      if (goalData.event_type !== 3 && goalData.robot_name && goalData.robot_fleet) {
        console.log(`RMF: Resetting dynamic_event_status to 'active' for rejected ${goalData.event_type === 1 ? 'goto' : 'unknown'} event`);
        updateRobotContext(goalData.robot_name, goalData.robot_fleet, { 
          dynamic_event_status: 'active' 
        });
      }
      
      return {
        success: false,
        error: 'Goal rejected',
        result: null
      };
    }
    
    console.log('RMF: Goal was accepted');
    
    // Wait for the result
    console.log('RMF: Waiting for action result...');
    const result = await goalHandle.getResult();
    
    console.log('RMF: Action result received:', result);
    
    let success = false;
    let status = 'unknown';
    
    if (goalHandle.isSucceeded()) {
      console.log('RMF: Goal succeeded!');
      success = true;
      status = 'succeeded';
    } else if (goalHandle.isCanceled()) {
      console.log('RMF: Goal was canceled');
      success = true; // Consider canceled as successful completion
      status = 'canceled';
    } else if (goalHandle.isAborted()) {
      console.log('RMF: Goal was aborted');
      success = true; // Consider aborted (due to cancel) as successful completion
      status = 'aborted';
    } else {
      console.log('RMF: Goal failed with unknown status');
      success = false;
      status = 'failed';
    }
    
    safeActionClient.destroy();
    safeActionClient = null;
    console.log('RMF: Safe action client destroyed');
    
    // For end events, remove from active tracking
    if (goalData.event_type === 3) {
      const robotKey = `${goalData.robot_fleet}/${goalData.robot_name}`;
      activeEndEvents.delete(robotKey);
      console.log(`RMF: Removed ${robotKey} from active end events tracking`);
    }

    // Call completion callback if provided
    if (callbacks.onGoalComplete) {
      const completionData = {
        success: success,
        status: result && result.status ? result.status : status,
        timestamp: new Date().toISOString(),
        result: result
      };
      callbacks.onGoalComplete(completionData);
    }
    
    // Reset dynamic_event_status to 'active' for successful non-end events
    // This indicates the robot is ready for the next dynamic event in the sequence
    if (success && goalData.event_type !== 3 && goalData.robot_name && goalData.robot_fleet) {
      console.log(`RMF: Resetting dynamic_event_status to 'active' for completed ${goalData.event_type === 1 ? 'goto' : 'unknown'} event`);
      updateRobotContext(goalData.robot_name, goalData.robot_fleet, { 
        dynamic_event_status: 'active' 
      });
    } else if (success && goalData.event_type === 3 && goalData.robot_name && goalData.robot_fleet) {
      // For successful end events, set status to 'completed' to indicate task sequence is done
      console.log('RMF: Setting dynamic_event_status to \'completed\' for successful end event');
      updateRobotContext(goalData.robot_name, goalData.robot_fleet, { 
        dynamic_event_status: 'completed' 
      });
    }
    
    return {
      success: success,
      status: status,
      result: result,
      error: success ? undefined : (status === 'aborted' ? 'Goal was aborted by cancel request' : 'Goal failed')
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
    
    // For end events, remove from active tracking on error
    if (goalData.event_type === 3) {
      const robotKey = `${goalData.robot_fleet}/${goalData.robot_name}`;
      activeEndEvents.delete(robotKey);
      console.log(`RMF: Removed ${robotKey} from active end events tracking (error cleanup)`);
    }
    
    // Call completion callback if provided
    if (callbacks.onGoalComplete) {
      const completionData = {
        success: false,
        status: 'error',
        timestamp: new Date().toISOString(),
        result: null,
        error: error.message
      };
      callbacks.onGoalComplete(completionData);
    }
    
    // Reset dynamic_event_status to 'active' for errored non-end events
    // This ensures robot context stays consistent even when errors occur
    if (goalData && goalData.event_type !== 3 && goalData.robot_name && goalData.robot_fleet) {
      console.log(`RMF: Resetting dynamic_event_status to 'active' for errored ${goalData.event_type === 1 ? 'goto' : 'unknown'} event`);
      updateRobotContext(goalData.robot_name, goalData.robot_fleet, { 
        dynamic_event_status: 'active' 
      });
    }
    
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Update robot context with new information (delegates to robot context provider)
 * @param {string} robotName - Robot name
 * @param {string} fleetName - Fleet name
 * @param {Object} updates - Updates to apply
 * @returns {Object} Update result
 */
function updateRobotContext(robotName, fleetName, updates) {
  if (robotContextProvider && robotContextProvider.updateRobotContext) {
    return robotContextProvider.updateRobotContext(robotName, fleetName, updates);
  } else {
    console.warn('RMF Task Manager: Robot context provider not available');
    return { success: false, error: 'Robot context provider not available' };
  }
}

/**
 * Get robot context by name and fleet (delegates to robot context provider)
 * @param {string} robotName - Robot name
 * @param {string} fleetName - Fleet name
 * @returns {Object|null} Robot context or null if not found
 */
function getRobotContext(robotName, fleetName) {
  if (robotContextProvider && robotContextProvider.getRobotContext) {
    return robotContextProvider.getRobotContext(robotName, fleetName);
  } else {
    console.warn('RMF Task Manager: Robot context provider not available');
    return null;
  }
}

/**
 * Cancel an RMF task using the RMF Web API
 * @param {string} taskId - Task ID to cancel
 * @param {Object} configNode - RMF configuration node with host, port, jwt
 * @returns {Promise<Object>} Cancel result
 */
async function cancelRMFTask(taskId, configNode) {
  try {
    if (!taskId) {
      throw new Error('Task ID is required');
    }
    
    if (!configNode) {
      throw new Error('No RMF config provided');
    }

    const axios = require('axios');
    const { host, port, jwt } = configNode;
    const baseUrl = `http://${host}:${port}`;

    const payload = {
      type: 'cancel_task_request',
      task_id: taskId,
      labels: []  // Empty array as specified
    };

    console.log(`RMF Task Manager: Sending cancel request for task ${taskId}`);

    const response = await axios.post(`${baseUrl}/tasks/cancel_task`, payload, {
      headers: {
        'Content-Type': 'application/json',
        ...(jwt && { 'Authorization': `Bearer ${jwt}` }),
      }
    });

    const result = response.data;
    console.log(`RMF Task Manager: Cancel response:`, result);

    return {
      success: true,
      result: result,
      taskId: taskId
    };
  } catch (error) {
    console.error('RMF Task Manager: Error cancelling task:', error);
    return {
      success: false,
      error: error.response?.data?.message || error.message,
      taskId: taskId
    };
  }
}

/**
 * Clear active end events tracking (for cleanup or reset)
 * @returns {void}
 */
function clearActiveEndEvents() {
  activeEndEvents.clear();
  console.log('RMF: Cleared all active end events tracking');
}

module.exports = {
  setRobotContextProvider,
  createRMFTask,
  createTaskV2,
  cancelRMFTask,
  subscribeToTaskStatus,
  unsubscribeFromTaskStatus,
  getActiveTaskSubscriptions,
  cleanupAllTaskSubscriptions,
  getTaskSubscriptionStats,
  sendDynamicEventGoal,
  sendDynamicEventControl,
  updateRobotContext,
  getRobotContext,
  clearActiveEndEvents
};
