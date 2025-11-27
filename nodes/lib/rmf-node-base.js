/**
 * Base class for RMF nodes providing common functionality
 * This eliminates code duplication across RMF nodes by providing:
 * - RMF connection monitoring
 * - Status management  
 * - Event handling
 * - Cleanup
 */

const rmfContextManager = require('./rmfContextManager');

class RMFNodeBase {
  constructor(RED, config, nodeType) {
    this.RED = RED;
    this.config = config;
    this.nodeType = nodeType;
    this.node = null;
    this.rmfConfigReady = false;
    this.eventHandlers = {};
    this.currentMsg = null;
  }

  /**
   * Initialize the base functionality with an existing Node-RED node
   * This should be called after RED.nodes.createNode()
   */
  initialize(node) {
    this.node = node;
    
    // For nodes that don't use config nodes (action nodes depend on start-task context)
    // We validate RMF context directly from the global rmfContextManager
    this.configNode = this.RED.nodes.getNode(this.config.config);
    
    if (!this.configNode) {
      // No config node - this is expected for action nodes that depend on start-task
      console.log(`[${this.nodeType.toUpperCase()}] No config node - will validate global RMF context on each message`);
      this._setupDirectRMFConnection();
    } else {
      // Has config node - traditional pattern for start-task nodes
      this._setupRMFConnection();
    }
    
    this._setupEventHandlers();
    return true;
  }

  /**
   * Setup direct RMF connection validation (for nodes without config)
   * @private
   */
  _setupDirectRMFConnection() {
    // Set initial status
    this.setStatus('yellow', 'ring', 'Ready');
    
    // These nodes validate RMF context on each message rather than at startup
    this.rmfConfigReady = true; // Allow processing to proceed to message-level validation
  }

  /**
   * Setup RMF connection monitoring
   * @private
   */
  _setupRMFConnection() {
    // Set initial status
    this.setStatus('yellow', 'ring', 'Waiting for RMF config...');

    // Wait for RMF config to be ready
    if (this.configNode) {
      this.configNode.on('rmf-ready', (readyInfo) => {
        // RMF config ready, checking connection silently
        this.rmfConfigReady = true;
        this.setStatus('yellow', 'ring', 'Connecting to RMF...');
        // Small delay to allow RMF context to fully initialize
        setTimeout(() => this._updateRMFStatus(), 1000);
      });
    }
  }

  /**
   * Setup RMF event handlers
   * @private
   */
  _setupEventHandlers() {
    const rmfEvents = rmfContextManager.rmfEvents;
    
    // Define event handlers
    this.eventHandlers.onReady = () => {
      if (this.rmfConfigReady) this._updateRMFStatus();
    };
    
    this.eventHandlers.onSocketConnected = () => {
      if (this.rmfConfigReady) this._updateRMFStatus();
    };
    
    this.eventHandlers.onSocketDisconnected = () => {
      this.setStatus('red', 'ring', 'RMF disconnected');
    };
    
    this.eventHandlers.onCleanedUp = () => {
      this.setStatus('red', 'ring', 'RMF cleaned up');
    };
    
    this.eventHandlers.onError = (err) => {
      this.setStatus('red', 'ring', 'RMF error: ' + (err && err.message ? err.message : 'unknown'));
    };

    // Register event handlers
    rmfEvents.on('ready', this.eventHandlers.onReady);
    rmfEvents.on('socket_connected', this.eventHandlers.onSocketConnected);
    rmfEvents.on('socket_disconnected', this.eventHandlers.onSocketDisconnected);
    rmfEvents.on('cleanedUp', this.eventHandlers.onCleanedUp);
    rmfEvents.on('error', this.eventHandlers.onError);

    // Setup cleanup on close
    this.node.on('close', (removed, done) => {
      this._cleanup();
      if (done) done();
    });
  }

  /**
   * Update RMF connection status
   * @private
   */
  _updateRMFStatus() {
    try {
      if (!rmfContextManager || !rmfContextManager.context) {
        this.setStatus('red', 'ring', 'RMF context unavailable');
        return;
      }
      
      const socket = rmfContextManager.context.socket;
      if (!socket || !socket.connected) {
        this.setStatus('red', 'ring', 'RMF connection failed');
      } else {
        this.setStatus('green', 'dot', 'Ready');
      }
    } catch (error) {
      console.error(`[${this.nodeType.toUpperCase()}] Error in updateRMFStatus:`, error);
      this.setStatus('red', 'ring', 'RMF error');
    }
  }

  /**
   * Set node status with logging
   * @param {string} fill - Status color
   * @param {string} shape - Status shape  
   * @param {string} text - Status text
   */
  setStatus(fill, shape, text) {
    this.node.status({ fill: fill, shape: shape, text: text });
  }

  /**
   * Extract RMF metadata from message
   * @param {Object} msg - Input message
   * @returns {Object} Extracted RMF metadata
   */
  extractRMFMetadata(msg) {
    return {
      robotName: msg._rmf_robot_name || msg.rmf_robot_name || msg.robot_name || this.config.robot_name,
      robotFleet: msg._rmf_robot_fleet || msg.rmf_robot_fleet || msg.robot_fleet || this.config.robot_fleet,
      taskId: msg._rmf_task_id || msg.rmf_task_id || msg.task_id,
      dynamicEventSeq: msg._rmf_dynamic_event_seq || msg.rmf_dynamic_event_seq || msg.dynamic_event_seq || 
                       (msg.payload && msg.payload.dynamic_event_seq)
    };
  }

  /**
   * Validate RMF metadata
   * @param {Object} metadata - Extracted metadata
   * @returns {Object} Validation result
   */
  validateRMFMetadata(metadata) {
    const { robotName, robotFleet, taskId, dynamicEventSeq } = metadata;
    
    if (!robotName || !robotFleet) {
      return {
        valid: false,
        error: 'robot_info',
        message: 'Robot name and fleet are required. Pass via RMF metadata or configure in node.'
      };
    }

    if (!taskId || dynamicEventSeq === undefined) {
      return {
        valid: false,
        error: 'task_context',
        message: 'Task ID and dynamic event sequence required. Connect after start-task node.'
      };
    }

    return { valid: true };
  }

  /**
   * Extract RMF parameters from message (alias for extractRMFMetadata)
   * @param {Object} msg - Input message
   * @returns {Object} Extracted parameters
   */
  extractRMFParameters(msg) {
    // Extract parameters with precedence: message > config > metadata
    // Support both underscore and non-underscore formats for compatibility
    const robotName = msg.robot_name || this.config.robot_name || msg._rmf_robot_name || msg.rmf_robot_name;
    const robotFleet = msg.robot_fleet || this.config.robot_fleet || msg._rmf_robot_fleet || msg.rmf_robot_fleet;
    const taskId = msg._rmf_task_id || msg.rmf_task_id;
    
    // Get dynamic event sequence from RMF context instead of relying on message
    let dynamicEventSeq = null;
    if (robotName && robotFleet) {
      const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
      dynamicEventSeq = robotContext?.dynamic_event_seq;
    }
    
    // Fallback to message if context not available
    if (dynamicEventSeq === null || dynamicEventSeq === undefined) {
      dynamicEventSeq = msg.rmf_dynamic_event_seq || msg._rmf_dynamic_event_seq || msg.dynamic_event_seq || msg.payload?.rmf_dynamic_event_seq || msg.payload?.dynamic_event_seq;
    }

    return {
      robotName,
      robotFleet,
      taskId,
      dynamicEventSeq
    };
  }

  /**
   * Validate global RMF context availability (for nodes without config)
   * @returns {Object} Validation result with valid flag, error message, and error_type
   */
  validateGlobalRMFContext() {
    // 1. Check if rmfContextManager exists
    if (!rmfContextManager || !rmfContextManager.context) {
      return {
        valid: false,
        error: 'RMF context not available. Ensure an RMF Config node is deployed and connected to a start-task node.',
        error_type: 'rmf_context_missing',
        help: 'Deploy an RMF Config node and connect it to a start-task node before using this action node.'
      };
    }

    // 2. Check RMF socket connection
    if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
      return {
        valid: false,
        error: 'RMF socket not connected. Check RMF server status and config.',
        error_type: 'rmf_connection_waiting',
        help: 'Ensure RMF server is running and RMF Config node is properly configured.'
      };
    }

    // 3. Check RMF data availability (optional - some nodes may not need this)
    const rmfData = rmfContextManager.getRMFData();
    if (!rmfData) {
      return {
        valid: false,
        error: 'RMF building data not available. Check RMF system and building map.',
        error_type: 'rmf_data_missing',
        help: 'Ensure RMF system is running with valid building map data.'
      };
    }

    return { valid: true };
  }

  /**
   * Validate RMF parameters (alias for validateRMFMetadata)
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result with valid flag and error message
   */
  validateRMFParameters(params) {
    const { robotName, robotFleet, taskId, dynamicEventSeq } = params;

    // Validate required RMF metadata
    if (!taskId) {
      return {
        valid: false,
        error: `Missing required RMF task_id. Found: ${taskId}. This ${this.nodeType} node should be connected after a start-task node.`,
        field: 'task_id',
        value: taskId
      };
    }

    if (dynamicEventSeq === undefined || dynamicEventSeq === null) {
      return {
        valid: false,
        error: `Missing required dynamic_event_seq. Found: ${dynamicEventSeq}. This ${this.nodeType} node should be connected after a start-task node.`,
        field: 'dynamic_event_seq', 
        value: dynamicEventSeq
      };
    }

    return { valid: true };
  }

  /**
   * Create dynamic event goal data structure
   * @param {Object} params - RMF parameters
   * @param {string} eventType - Type of dynamic event (e.g., 'perform_action')
   * @param {Object} eventData - Event-specific data
   * @returns {Object} Dynamic event goal data
   */
  createDynamicEventGoal(params, eventType, eventData) {
    return {
      task_type: 'dispatch_task',
      start_time: { sec: 0, nanosec: 0 },
      requester: `node-red-${this.nodeType}`,
      description: {
        task_type: {
          type: 'compose_task',
          data: {
            category: eventType,
            detail: {
              category: 'multi_delivery',
              phases: [
                {
                  activity: {
                    category: 'sequence',
                    detail: {
                      activities: [
                        {
                          category: 'dynamic_event',
                          detail: {
                            unix_millis_action_duration_estimate: 60000,
                            category: eventType,
                            detail: {
                              sequence_number: params.dynamicEventSeq,
                              expected_task_id: params.taskId,
                              type: eventType,
                              data: eventData
                            }
                          }
                        }
                      ]
                    }
                  }
                }
              ]
            }
          }
        }
      }
    };
  }

  /**
   * Send dynamic event goal to RMF
   * @param {string} category - Event category (e.g., 'perform_action')
   * @param {Object} eventData - Event-specific data (e.g., { category: 'teleop', description: {...} })
   * @param {Object} successData - Data to include in success response
   */
  async sendDynamicEventGoal(category, eventData, successData) {
    try {
      this.setStatus('blue', 'dot', 'Sending to RMF...');

      // Extract parameters for the goal
      const params = this.extractRMFParameters(this.currentMsg);
      
      // Create the goal data in the format expected by rmfTaskManager
      const goalData = {
        robot_name: params.robotName || '',
        robot_fleet: params.robotFleet || '',
        task_id: params.taskId,
        dynamic_event_seq: params.dynamicEventSeq,
        event_type: 1, // New request
        category: category,
        description: JSON.stringify(eventData)
      };

      console.log(`[${this.nodeType.toUpperCase()}] Sending dynamic event goal:`, goalData);

      // Set up goal callbacks
      const goalCallbacks = {
        onGoalComplete: (result) => {
          if (result && result.success) {
            this.setStatus('green', 'dot', 'Completed');
            this.sendSuccess(this.currentMsg, {
              status: 'completed',
              action: this.nodeType,
              ...successData,
              timestamp: new Date().toISOString()
            });
          } else {
            this.sendError('Goal failed', result?.message || 'Unknown error');
          }
        },
        onFeedback: (feedback) => {
          if (feedback && feedback.status) {
            this.setStatus('blue', 'dot', `${this.nodeType}: ${feedback.status}`);
            
            // Send status update with robot mode
            this.sendStatus(this.currentMsg, {
              status: feedback.status,
              action: this.nodeType,
              feedback: feedback,
              timestamp: new Date().toISOString()
            });
          }
        }
      };

      // Send using rmfContextManager
      const result = await rmfContextManager.sendDynamicEventGoal(goalData, goalCallbacks);
      
      if (!result || !result.success) {
        this.sendError('Failed to send goal', result?.message || 'Failed to send dynamic event goal');
      }
    } catch (error) {
      console.error(`[${this.nodeType.toUpperCase()}] Error sending goal:`, error);
      this.sendError('Send failed', error.message);
    }
  }

  /**
   * Send error response
   * @param {string} statusText - Status text to display
   * @param {string} errorReason - Error reason for output
   * @param {string} action - Action type for error context
   */
  sendError(statusText, errorReason, action = this.nodeType) {
    this.setStatus('red', 'dot', statusText);
    // Send on second output: [success, failed, status]
    this.node.send([null, { 
      payload: { 
        status: 'error', 
        reason: errorReason,
        action: action
      } 
    }, null]);
  }

  /**
   * Get robot mode from RMF context manager (preferred approach)
   * @param {string} robotName - Robot name
   * @param {string} robotFleet - Robot fleet
   * @param {string} taskId - Task ID (fallback identifier)
   * @returns {number|null} Robot mode integer or null if not found
   */
  getRobotMode(robotName, robotFleet, taskId) {
    try {
      // Method 1: Use rmfContextManager.getRobotContext() - BEST APPROACH
      if (robotName && robotFleet) {
        const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
        if (robotContext && robotContext.mode && typeof robotContext.mode.mode === 'number') {
          console.log(`[${this.nodeType.toUpperCase()}] Found robot mode ${robotContext.mode.mode} for ${robotName}/${robotFleet} via context manager`);
          return robotContext.mode.mode;
        }
      }

      // Method 2: Search all robots (useful when robot name/fleet unknown or for task_id lookup)
      if (taskId || robotName) {
        const allRobots = rmfContextManager.getAllRobots();
        if (allRobots && allRobots.length > 0) {
          // First try by task_id if available
          if (taskId) {
            const robot = allRobots.find(r => r.task_id === taskId);
            if (robot && robot.mode && typeof robot.mode.mode === 'number') {
              console.log(`[${this.nodeType.toUpperCase()}] Found robot mode ${robot.mode.mode} for task ${taskId} via getAllRobots`);
              return robot.mode.mode;
            }
          }
          
          // Then try by name/fleet combination
          if (robotName && robotFleet) {
            const robot = allRobots.find(r => r.name === robotName && r.fleet === robotFleet);
            if (robot && robot.mode && typeof robot.mode.mode === 'number') {
              console.log(`[${this.nodeType.toUpperCase()}] Found robot mode ${robot.mode.mode} for ${robotName}/${robotFleet} via getAllRobots`);
              return robot.mode.mode;
            }
          }
        }
      }

      console.log(`[${this.nodeType.toUpperCase()}] Robot mode not found for ${robotName}/${robotFleet}/${taskId}`);
      return null;
    } catch (error) {
      console.error(`[${this.nodeType.toUpperCase()}] Error getting robot mode:`, error);
      return null;
    }
  }

  /**
   * Send success response
   * @param {Object} msg - Original message
   * @param {Object} payload - Success payload
   */
  sendSuccess(msg, payload) {
    const successMsg = Object.assign({}, msg, { payload });
    
    // Preserve RMF metadata for next node in chain
    const params = this.extractRMFParameters(msg);
    if (params.taskId) successMsg.rmf_task_id = params.taskId;
    if (params.robotName) successMsg.rmf_robot_name = params.robotName;
    if (params.robotFleet) successMsg.rmf_robot_fleet = params.robotFleet;
    if (params.dynamicEventSeq !== undefined && params.dynamicEventSeq !== null) {
      successMsg.rmf_dynamic_event_seq = params.dynamicEventSeq;
    }
    
    // Send on first output: [success, failed, status]
    this.node.send([successMsg, null, null]);
  }

  /**
   * Send status response
   * @param {Object} msg - Original message
   * @param {Object} statusPayload - Status payload
   */
  sendStatus(msg, statusPayload) {
    const statusMsg = Object.assign({}, msg, { payload: statusPayload });
    
    // Add robot mode to both payload and msg for redundancy
    const params = this.extractRMFParameters(msg);
    const robotMode = this.getRobotMode(params.robotName, params.robotFleet, params.taskId);
    if (robotMode !== null) {
      statusMsg.payload.rmf_robot_mode = robotMode;  // In payload
      statusMsg.rmf_robot_mode = robotMode;          // In msg for redundancy
    }
    
    // Send on third output: [success, failed, status]
    this.node.send([null, null, statusMsg]);
  }

  /**
   * Setup input handler with common validation
   * @param {Function} handler - Custom input handler function
   */
  onInput(handler) {
    this.node.on('input', async (msg) => {
      try {
        // Extract and validate RMF metadata
        const metadata = this.extractRMFMetadata(msg);
        const validation = this.validateRMFMetadata(metadata);
        
        if (!validation.valid) {
          console.log(`[${this.nodeType.toUpperCase()}] Validation failed: ${validation.error}`);
          console.log(`  Metadata:`, metadata);
          console.log(`  Missing field: ${validation.field}, Found value: ${validation.value}`);
          
          // Send detailed error message
          this.sendError(`Validation failed: ${validation.field}`, validation.error);
          return;
        }

        // Call the custom handler with validated metadata
        await handler.call(this, msg, metadata);
        
      } catch (error) {
        console.error(`[${this.nodeType.toUpperCase()}] Error processing request:`, error);
        this.sendError(`Error: ${error.message}`, error.message);
      }
    });
  }

  /**
   * Cleanup resources
   * @private
   */
  _cleanup() {
    const rmfEvents = rmfContextManager.rmfEvents;
    
    // Remove event listeners
    rmfEvents.off('ready', this.eventHandlers.onReady);
    rmfEvents.off('socket_connected', this.eventHandlers.onSocketConnected);
    rmfEvents.off('socket_disconnected', this.eventHandlers.onSocketDisconnected);
    rmfEvents.off('cleanedUp', this.eventHandlers.onCleanedUp);
    rmfEvents.off('error', this.eventHandlers.onError);
    
    // Clear status
    this.node.status({});
  }
}

module.exports = RMFNodeBase;
