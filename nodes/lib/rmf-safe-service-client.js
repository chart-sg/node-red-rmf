// File: nodes/lib/rmf-safe-service-client.js
const { Ros2Instance } = require('./rmf-ros2-instance');

/**
 * Safe service client wrapper that creates and destroys clients per use
 * This follows the same pattern as the action client to prevent crashes
 */
class SafeServiceClient {
  constructor(serviceType, serviceName) {
    this.serviceType = serviceType;
    this.serviceName = serviceName;
    this.ros2Instance = Ros2Instance.instance();
  }

  async callService(request) {
    console.log(`RMF: Creating service client for ${this.serviceName}...`);
    
    // Create client for this specific call
    const client = this.ros2Instance.node.createClient(
      this.serviceType,
      this.serviceName
    );

    try {
      // Wait for service to be available
      console.log(`RMF: Waiting for service ${this.serviceName} to be available...`);
      const serviceAvailable = await client.waitForService(5000); // 5 second timeout
      
      if (!serviceAvailable) {
        console.error(`RMF: Service ${this.serviceName} not available after 5 seconds`);
        return null;
      }

      console.log(`RMF: Service ${this.serviceName} is available, making request...`);
      
      // Create a promise to handle the callback-based service call
      const serviceName = this.serviceName;
      const servicePromise = new Promise((resolve, reject) => {
        try {
          client.sendRequest(request, function(response) {
            console.log(`RMF: Service ${serviceName} callback received response`);
            resolve(response);
          });
        } catch (error) {
          console.error(`RMF: Failed to send request to ${serviceName}:`, error.message);
          reject(error);
        }
      });

      // Wait for response with timeout
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Service call timeout')), 10000);
      });

      const response = await Promise.race([servicePromise, timeoutPromise]);
      console.log(`RMF: Service ${this.serviceName} response received successfully`);
      
      return response;

    } catch (error) {
      console.error(`RMF: Service ${this.serviceName} call failed:`, error.message);
      throw error;
    } finally {
      // Clean up client immediately after use
      console.log(`RMF: Destroying service client for ${this.serviceName}...`);
      try {
        if (client && client.destroy) {
          client.destroy();
        }
      } catch (error) {
        console.error(`RMF: Error destroying service client for ${this.serviceName}:`, error.message);
      }
    }
  }
}

module.exports = { SafeServiceClient };
