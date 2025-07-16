// File: nodes/lib/rmf-safe-action-client.js

/**
 * Safe action client wrapper that prevents heap corruption
 * This wrapper ensures proper resource lifecycle management
 */

class SafeActionClient {
  constructor(rosNode, actionType, actionPath) {
    this.rosNode = rosNode;
    this.actionType = actionType;
    this.actionPath = actionPath;
    this.actionClient = null;
    this.isDestroyed = false;
    this.isInitialized = false;
  }

  async initialize() {
    if (this.isInitialized || this.isDestroyed) {
      return;
    }

    try {
      const { ActionClient } = require('rclnodejs');
      
      console.log('SafeActionClient: Creating action client for', this.actionPath);
      
      this.actionClient = new ActionClient(
        this.rosNode,
        this.actionType,
        this.actionPath
      );
      
      this.isInitialized = true;
      console.log('SafeActionClient: Action client initialized');
      
    } catch (error) {
      console.error('SafeActionClient: Failed to initialize action client:', error.message);
      throw error;
    }
  }

  isActionServerAvailable() {
    if (!this.isInitialized || this.isDestroyed || !this.actionClient) {
      return false;
    }
    
    try {
      return this.actionClient.isActionServerAvailable();
    } catch (error) {
      console.warn('SafeActionClient: Error checking server availability:', error.message);
      return false;
    }
  }

  async sendGoal(goal, feedbackCallback = null) {
    if (!this.isInitialized || this.isDestroyed || !this.actionClient) {
      throw new Error('Action client not initialized or destroyed');
    }

    try {
      console.log('SafeActionClient: Sending goal:', goal);
      
      const goalHandlePromise = this.actionClient.sendGoal(goal, feedbackCallback);
      const goalHandle = await goalHandlePromise;
      
      console.log('SafeActionClient: Goal sent, handle received');
      return goalHandle;
      
    } catch (error) {
      console.error('SafeActionClient: Error sending goal:', error.message);
      throw error;
    }
  }

  destroy() {
    if (this.isDestroyed) {
      return;
    }

    this.isDestroyed = true;

    if (this.actionClient) {
      try {
        console.log('SafeActionClient: Destroying action client');
        
        // Use timeout to prevent hanging
        const destroyTimeout = setTimeout(() => {
          console.warn('SafeActionClient: Destroy timeout, forcing cleanup');
          this.actionClient = null;
        }, 5000);
        
        this.actionClient.destroy();
        clearTimeout(destroyTimeout);
        
        console.log('SafeActionClient: Action client destroyed successfully');
        
      } catch (error) {
        console.warn('SafeActionClient: Error during destroy:', error.message);
      } finally {
        this.actionClient = null;
      }
    }
  }
}

module.exports = { SafeActionClient };
