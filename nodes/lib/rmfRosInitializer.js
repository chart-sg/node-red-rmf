// File: nodes/lib/rmfRosInitializer.js

const rclnodejs = require('rclnodejs');

class RMFRosInitializer {
  constructor(context, globalState) {
    this.context = context;
    this.globalState = globalState;
  }

  async initialize() {
    // Skip ROS initialization if disabled
    if (process.env.DISABLE_ROS === 'true') {
      console.log('ROS 2 initialization skipped (DISABLE_ROS=true)');
      return;
    }

    // If already initialized, return immediately
    if (this.globalState.isInitialized) {
      console.log('ROS 2 already initialized, reusing...');
      this.context.rosInitialized = true;
      return;
    }

    // If currently initializing, wait for it to complete
    if (this.globalState.isInitializing && this.globalState.initPromise) {
      console.log('ROS 2 initialization in progress, waiting...');
      try {
        await this.globalState.initPromise;
        this.context.rosInitialized = this.globalState.isInitialized;
        return;
      } catch (error) {
        console.error('Waiting for ROS initialization failed:', error.message);
        this.context.rosInitialized = false;
        return;
      }
    }

    // Start new initialization
    this.globalState.isInitializing = true;
    this.globalState.initPromise = this.performInitialization();

    try {
      await this.globalState.initPromise;
      this.context.rosInitialized = this.globalState.isInitialized;
    } catch (error) {
      console.error('ROS initialization failed:', error.message);
      this.context.rosInitialized = false;
    }
  }

  async performInitialization() {
    try {
      // Check if ROS_DOMAIN_ID is set
      if (!process.env.ROS_DOMAIN_ID && !process.env.RCLNODEJS_ROS_DOMAIN_ID) {
        console.warn('ROS_DOMAIN_ID not set, using default domain 0');
        process.env.RCLNODEJS_ROS_DOMAIN_ID = '0';
      }

      console.log('RMF initializing ROS 2 with domain:', process.env.RCLNODEJS_ROS_DOMAIN_ID || process.env.ROS_DOMAIN_ID);
      
      // First, try to use existing ROS 2 instance from edu-nodered-ros2-plugin
      let rosAlreadyInitialized = false;
      
      // Try multiple possible paths to find the edu-nodered-ros2-plugin
      const possiblePaths = [
        'edu-nodered-ros2-plugin/src/ros2/ros2-instance',
        './custom-nodes/edu_nodered_ros2_plugin/src/ros2/ros2-instance',
        '/home/asraf/.node-red/projects/rmf2_node_red/custom-nodes/edu_nodered_ros2_plugin/src/ros2/ros2-instance'
      ];
      
      for (const path of possiblePaths) {
        try {
          console.log(`RMF: Trying to load edu-nodered-ros2-plugin from: ${path}`);
          const { Ros2Instance } = require(path);
          const existingInstance = Ros2Instance.instance();
          
          if (existingInstance && existingInstance.node) {
            console.log('RMF: Found and reusing existing ROS 2 instance from edu-nodered-ros2-plugin');
            console.log('RMF: Note - using shared ROS context with edu-nodered-ros2-plugin configuration');
            this.context.node = existingInstance.node;
            rosAlreadyInitialized = true;
            break;
          }
        } catch (error) {
          console.log(`RMF: Failed to load from ${path}: ${error.message}`);
        }
      }
      
      if (!rosAlreadyInitialized) {
        console.log('RMF: No existing ROS 2 instance found, proceeding with own initialization');
        rosAlreadyInitialized = await this.initializeOwnRosInstance();
      }
      
      this.globalState.isInitialized = rosAlreadyInitialized;
      this.globalState.isInitializing = false;
      this.globalState.error = null;
      
      console.log('RMF ROS 2 initialization successful - other nodes can now proceed');
      
    } catch (error) {
      this.globalState.isInitialized = false;
      this.globalState.isInitializing = false;
      this.globalState.error = error;
      
      console.error('RMF ROS2 initialization failed:', error.message);
      console.log('Continuing without ROS 2 support...');
      
      throw error;
    }
  }

  async initializeOwnRosInstance() {
    try {
      // Try to create a node without initializing (ROS might already be initialized)
      const nodeName = `rmf_node_red_${Date.now()}`;
      this.context.node = rclnodejs.createNode(nodeName);
      console.log('RMF: Successfully created node on existing ROS instance (detected running ROS)');
      
      // Debug node capabilities
      this.debugNodeCapabilities();
      
      return true;
    } catch (nodeError) {
      console.log('RMF: Failed to create node on existing ROS instance, will try to initialize ROS');
      
      // Only try to initialize ROS if we can't create a node
      try {
        console.log('RMF: Initializing ROS2 in standalone mode (edu-nodered pattern)');
        
        // Use edu-nodered-ros2-plugin initialization pattern for consistency
        rclnodejs.init(); // Synchronous init like edu-nodered
        
        // Create node with unique name to avoid conflicts
        const nodeName2 = `rmf_node_red_${Date.now()}`;
        this.context.node = rclnodejs.createNode(nodeName2);
        
        // Start spinning the node (edu-nodered pattern)
        rclnodejs.spin(this.context.node);
        
        console.log('RMF: ROS2 initialization successful (standalone mode with edu-nodered pattern)');
        
        // Debug node capabilities
        this.debugNodeCapabilities();
        
        return true;
        
      } catch (rosError) {
        console.error('RMF: Complete ROS initialization failed:', rosError.message);
        throw rosError;
      }
    }
  }

  debugNodeCapabilities() {
    if (this.context.node) {
      console.log('RMF: ROS2 node methods available:');
      console.log('  - createPublisher:', typeof this.context.node.createPublisher);
      console.log('  - createSubscription:', typeof this.context.node.createSubscription);
      console.log('  - createService:', typeof this.context.node.createService);
      console.log('  - createClient:', typeof this.context.node.createClient);
      console.log('  - createActionClient:', typeof this.context.node.createActionClient);
      console.log('  - createActionServer:', typeof this.context.node.createActionServer);
      console.log('  - Other methods:', Object.getOwnPropertyNames(this.context.node).filter(name => typeof this.context.node[name] === 'function'));
    } else {
      console.log('RMF: ROS2 node not available for debugging');
    }
  }

  cleanup() {
    console.log('Cleaning up ROS initializer...');
    
    if (this.context.rosInitialized && this.context.node) {
      try {
        console.log('Destroying ROS node...');
        if (this.context.node.destroy) {
          this.context.node.destroy();
        }
        
        // Only shutdown if we're the last one using ROS
        // Note: This is simplified - in a real implementation, you'd want reference counting
        console.log('Note: ROS shutdown skipped to avoid conflicts with other nodes');
        
        this.context.rosInitialized = false;
        this.context.node = null;
        console.log('ROS node cleanup completed');
      } catch (error) {
        console.error('ROS2 cleanup failed:', error);
      }
    }
  }
}

module.exports = RMFRosInitializer;
