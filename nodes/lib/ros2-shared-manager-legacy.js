/**
 * ROS2 Shared Manager Legacy - STUB VERSION
 * 
 * This is a compatibility stub for legacy imports.
 * The actual functionality has been moved to @chart/node-red-ros2-bridge
 */

console.warn('WARNING: ros2-shared-manager-legacy.js is deprecated. Use @chart/node-red-ros2-bridge instead.');

// Stub implementation for backward compatibility
const ros2SharedManager = {
    isInitialized: () => {
        console.warn('ros2SharedManager.isInitialized() is deprecated');
        return true; // Assume bridge is initialized
    },
    
    initialize: async () => {
        console.warn('ros2SharedManager.initialize() is deprecated');
        return Promise.resolve();
    },
    
    getNode: () => {
        console.warn('ros2SharedManager.getNode() is deprecated');
        return null; // Bridge handles node management
    },
    
    cleanup: () => {
        console.warn('ros2SharedManager.cleanup() is deprecated');
        return Promise.resolve();
    }
};

module.exports = {
    ros2SharedManager,
    ROS2SharedManager: class {
        constructor() {
            console.warn('ROS2SharedManager class is deprecated');
        }
    }
};