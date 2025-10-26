// File: nodes/lib/rmf-safe-action-client.js

/**
 * Safe action client wrapper that uses the shared ROS2 bridge
 * This prevents node destruction issues by using centralized action management
 */

class SafeActionClient {
  constructor(nodeId, actionType, actionPath) {
    this.nodeId = nodeId; // Changed from node to nodeId
    this.actionType = actionType;
    this.actionPath = actionPath;
    this.actionClientId = null; // Bridge action client ID
    this.isDestroyed = false;
    this.isInitialized = false;
    this.bridge = null;
  }

  async initialize() {
    if (this.isInitialized || this.isDestroyed) {
      return;
    }

    try {
      // Get the shared ROS2 manager
      const bridge = require('@chart/node-red-ros2-manager');
      this.bridge = bridge.getROS2Manager();
      
      if (!this.bridge || !this.bridge.initialized) {
        throw new Error('ROS2 manager not available. Ensure manager is initialized first.');
      }
      
      // Create action client through the manager
      this.actionClientId = await this.bridge.createActionClient(
        this.nodeId,
        this.actionType,
        this.actionPath,
        {
          onFeedback: null, // Will be provided per-goal
          onResult: null    // Will be provided per-goal
        }
      );
      
      this.isInitialized = true;      
      console.log('SafeActionClient: Action client initialized via manager:', this.actionClientId);
      
    } catch (error) {
      console.error('SafeActionClient: Failed to initialize action client:', error.message);
      throw error;
    }
  }

  isActionServerAvailable() {
    if (!this.isInitialized || this.isDestroyed || !this.actionClientId || !this.bridge) {
      return false;
    }
    
    try {
      return this.bridge.isActionServerAvailable(this.actionClientId);
    } catch (error) {
      console.warn('SafeActionClient: Error checking server availability:', error.message);
      return false;
    }
  }

  async sendGoal(goal, feedbackCallback = null) {
    if (!this.isInitialized || this.isDestroyed || !this.actionClientId || !this.bridge) {
      throw new Error('Action client not initialized or destroyed');
    }

    try {
      // Send goal through the manager
      const result = await this.bridge.sendGoal(this.actionClientId, goal, feedbackCallback);
      
      // Create a goal handle-like object for compatibility
      const goalHandle = {
        isAccepted: () => true, // If we got here, it was accepted
        isSucceeded: () => result.success,
        isCanceled: () => result.canceled,
        isAborted: () => result.aborted,
        getResult: async () => result.result,
        result: result.result
      };
      
      return goalHandle;
      
    } catch (error) {
      console.error('SafeActionClient: Error sending goal via manager:', error.message);
      throw error;
    }
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    if (this.actionClientId && this.bridge) {
      try {
        this.bridge.destroyActionClient(this.actionClientId);
        
      } catch (error) {
        console.warn('SafeActionClient: Error during destroy:', error.message);
      } finally {
        this.actionClientId = null;
        this.bridge = null;
      }
    }
  }
}

module.exports = { SafeActionClient };
