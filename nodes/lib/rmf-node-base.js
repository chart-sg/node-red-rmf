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
    
    // Get RMF config
    this.configNode = this.RED.nodes.getNode(this.config.config);
    
    if (!this.configNode) {
      this.setStatus('red', 'dot', 'RMF Config not found');
      return false;
    }

    // Setup RMF connection and event handlers
    this._setupRMFConnection();
    this._setupEventHandlers();
    
    return true;
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
        console.log(`[${this.nodeType.toUpperCase()}] RMF config ready, checking connection...`);
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
    console.log(`[${this.nodeType.toUpperCase()}] Setting node status: ${text}`);
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
    const dynamicEventSeq = msg._rmf_dynamic_event_seq || msg.payload?.dynamic_event_seq;

    return {
      robotName,
      robotFleet,
      taskId,
      dynamicEventSeq
    };
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
        error: 'Missing required RMF task context. This node should be connected after a start-task node.'
      };
    }

    if (dynamicEventSeq === undefined || dynamicEventSeq === null) {
      return {
        valid: false,
        error: 'Missing required dynamic event sequence number. This node should be connected after a start-task node.'
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
        onCompletion: (result) => {
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
    this.node.send([null, { 
      payload: { 
        status: 'error', 
        reason: errorReason,
        action: action
      } 
    }]);
  }

  /**
   * Send success response
   * @param {Object} msg - Original message
   * @param {Object} payload - Success payload
   */
  sendSuccess(msg, payload) {
    const successMsg = Object.assign({}, msg, { payload });
    this.node.send([successMsg, null]);
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
          
          if (validation.error === 'robot_info') {
            this.sendError('Missing robot name or fleet', validation.message);
          } else if (validation.error === 'task_context') {
            this.sendError('Missing task context', validation.message);
          }
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
