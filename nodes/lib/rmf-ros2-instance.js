const { ROS2BridgeInterface } = require('./ros2-bridge-interface');

/**
 * Legacy ROS2 instance wrapper for backward compatibility
 * Now uses the ROS2 bridge interface internally
 */
class Ros2Instance {
  static #_instance = undefined;
  static #_bridgeInterface = null;
  
  constructor() {
    console.warn('RMF: Using legacy Ros2Instance. Consider migrating to shared ROS2 manager directly.');
  }

  static instance()
  {
    if (Ros2Instance.#_instance == undefined) {
      Ros2Instance.#_instance = new Ros2Instance();
    }

    return Ros2Instance.#_instance;
  }

  get node() {
    // Get the ROS2 node from rmfCore context
    try {
      const rmfCore = require('./rmfCore');
      if (rmfCore.context && rmfCore.context.node) {
        return rmfCore.context.node;
      }
    } catch (error) {
      console.warn('RMF: Could not access rmfCore context:', error.message);
    }
    
    console.warn('RMF: Legacy Ros2Instance accessed but bridge interface not available');
    return null;
  }
}

module.exports = { 
  Ros2Instance,
  RMF_Ros2Instance: Ros2Instance  // Alias for backward compatibility
};
