// File: nodes/lib/rmf-safe-service-client.js

// Import bridge interface for ROS2 node access
const { getROS2BridgeInterface } = require('./ros2-bridge-interface');

/**
 * Safe service client wrapper that creates and destroys clients per use and uses bridge manager
 */
class SafeServiceClient {
  constructor(serviceType, serviceName) {
    this.serviceType = serviceType;
    this.serviceName = serviceName;
  }

  async callService(request) {
    console.log(`RMF: Creating service client for ${this.serviceName}...`);
    
    let node = null;
    
    // Use bridge to get ROS2 node
    console.log('RMF: Getting ROS2 node from bridge for service client...');
    
    try {
      // Get bridge interface and node
      const bridgeInterface = getROS2BridgeInterface();
      if (!bridgeInterface || !bridgeInterface.initialized) {
        throw new Error('Bridge interface not available or not initialized');
      }
      
      // Get node from bridge interface
      node = bridgeInterface.getNode();
      console.log('RMF: Node from bridge:', !!node);
    } catch (error) {
      console.error('RMF: Error getting node from bridge:', error.message);
    }    if (!node) {
      console.error('RMF: No ROS2 node available from any source!');
      console.error('RMF: This usually means ROS2 initialization is not complete yet');
      throw new Error('RMF ROS2 node not available. Ensure RMF is initialized first.');
    }
    
    // Validate that the node is actually a valid ROS2 node
    if (!node.createClient || typeof node.createClient !== 'function') {
      console.error('RMF: Node object is invalid - missing createClient method');
      console.error('RMF: Node object keys:', Object.keys(node || {}));
      throw new Error('RMF ROS2 node is invalid or corrupted');
    }
    
    console.log(`RMF: Using node for service client: ${this.serviceName}`);
    
    // Create client for this specific call
    const client = node.createClient(
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
          client.sendRequest(request, (response) => {
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
      try {
        if (client && typeof client.destroy === 'function') {
          try {
            client.destroy();
            console.log(`RMF: Service client for ${this.serviceName} destroyed successfully`);
          } catch (destroyError) {
            if (destroyError.message && destroyError.message.includes('already destroyed')) {
              // This is normal - rclnodejs auto-destroys service clients after successful calls
              console.debug(`RMF: Service client for ${this.serviceName} was auto-destroyed by rclnodejs (normal behavior)`);
            } else {
              console.warn(`RMF: Error destroying service client for ${this.serviceName}:`, destroyError.message);
            }
          }
        } else {
          // This is normal - rclnodejs auto-destroys service clients after successful calls
          console.debug(`RMF: Service client for ${this.serviceName} was auto-cleaned by rclnodejs (normal behavior)`);
        }
      } catch (error) {
        console.warn(`RMF: Error in cleanup process for ${this.serviceName}:`, error.message);
      }
    }
  }
}

module.exports = { SafeServiceClient };
