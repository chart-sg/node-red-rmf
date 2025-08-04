/**
 * RMF ROS2 Compatibility - STUB VERSION
 * 
 * This is a compatibility stub for legacy imports.
 * Compatibility checking is now handled by the bridge package.
 */

console.warn('WARNING: rmfRos2Compatibility.js is deprecated. Compatibility handled by bridge.');

const compatibilityManager = {
    checkCompatibility: () => {
        console.warn('compatibilityManager.checkCompatibility() is deprecated');
        return { compatible: true, version: 'bridge-managed' };
    },
    
    cleanup: () => {
        console.warn('compatibilityManager.cleanup() is deprecated');
        // No-op for compatibility
    },
    
    initialize: () => {
        console.warn('compatibilityManager.initialize() is deprecated');
        return Promise.resolve();
    }
};

module.exports = {
    compatibilityManager
};
