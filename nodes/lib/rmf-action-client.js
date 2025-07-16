const { RMF_Ros2Instance } = require('./rmf-ros2-instance');
const { ActionClient } = require("rclnodejs");

/**
 * RMF Action Client - Exact copy of edu-nodered-ros2-plugin pattern
 * 
 * This creates action clients that use the shared ROS2 node instance,
 * following the exact same lifecycle pattern as the working plugin.
 */
class RMF_ActionClient {
  constructor(actionType, actionTopic) {
    console.log(`RMF: Creating action client for ${actionTopic}`);
    
    this.actionType = actionType;
    this.actionTopic = actionTopic;
    this.action_client = null;
    this.ready = false;
    
    this.createActionClient();
  }

  createActionClient() {
    try {
      console.log(`RMF: Creating action client with topic: ${this.actionTopic}`);
      
      // Use the shared ROS2 node instance - this is the key!
      this.action_client = new ActionClient(
        RMF_Ros2Instance.instance().node,  // Shared singleton node
        this.actionType,
        this.actionTopic
      );
      
      this.ready = true;
      console.log(`RMF: Action client created successfully for ${this.actionTopic}`);
      
    } catch (error) {
      console.error(`RMF: Error creating action client for ${this.actionTopic}:`, error);
      this.ready = false;
      throw error;
    }
  }

  /**
   * Check if action server is available
   */
  isActionServerAvailable() {
    if (!this.action_client) {
      return false;
    }
    return this.action_client.isActionServerAvailable();
  }

  /**
   * Wait for action server to become available
   */
  async waitForServer(timeout = 5000) {
    if (!this.action_client) {
      return false;
    }
    return await this.action_client.waitForServer(timeout);
  }

  /**
   * Send goal - following exact edu-nodered-ros2-plugin pattern
   */
  async sendGoal(goalRequest, feedbackCallback = null) {
    if (!this.ready || !this.action_client) {
      throw new Error('Action client not ready');
    }

    console.log(`RMF: Sending goal to ${this.actionTopic}:`, goalRequest);
    
    try {
      // This is the exact pattern from edu-nodered-ros2-plugin
      const goal_handle_promise = this.action_client.sendGoal(goalRequest, function(feedback) {
        if (feedbackCallback) {
          feedbackCallback(feedback);
        }
      });

      console.log(`RMF: Goal request sent to ${this.actionTopic}`);
      const goal_handle = await goal_handle_promise;

      if (!goal_handle.isAccepted()) {
        console.log(`RMF: Goal rejected by ${this.actionTopic}`);
        const result = await goal_handle.getResult();
        return { success: false, result, goalHandle: goal_handle };
      }

      console.log(`RMF: Goal accepted by ${this.actionTopic}`);
      
      // Get the result
      const result = await goal_handle.getResult();
      console.log(`RMF: Received result from ${this.actionTopic}`);

      const success = goal_handle.isSucceeded();
      console.log(`RMF: Goal ${success ? 'succeeded' : 'failed'} on ${this.actionTopic}`);
      
      return { success, result, goalHandle: goal_handle };
      
    } catch (error) {
      console.error(`RMF: Error sending goal to ${this.actionTopic}:`, error);
      throw error;
    }
  }

  /**
   * Destroy the action client - following Node-RED lifecycle pattern
   */
  destroy() {
    if (this.action_client) {
      console.log(`RMF: Destroying action client for ${this.actionTopic}`);
      try {
        this.action_client.destroy();
        console.log(`RMF: Action client destroyed for ${this.actionTopic}`);
      } catch (error) {
        console.error(`RMF: Error destroying action client for ${this.actionTopic}:`, error);
      }
      this.action_client = null;
    }
    this.ready = false;
  }
}

module.exports = { RMF_ActionClient };
