/**
 * ROS2 Manager Interface for RMF Plugin
 * 
 * This module provides a unified interface to the ROS2 management platform.
 * It abstracts the choice between using the shared manager or standalone rclnodejs.
 */

let bridge = null;
let rclnodejs = null;
let useBridge = true;

// Try to load the ROS2 manager first
try {
    bridge = require('@chart/node-red-ros2-manager');
    console.log('[RMF-ROS2Manager] Successfully loaded @chart/node-red-ros2-manager');
} catch (error) {
    console.log('[RMF-ROS2Manager] Manager not available, falling back to rclnodejs:', error.message);
    useBridge = false;
    try {
        rclnodejs = require('rclnodejs');
        console.log('[RMF-ROS2Manager] Direct rclnodejs loaded as fallback');
    } catch (rclError) {
        console.error('[RMF-ROS2Manager] Failed to load rclnodejs:', rclError.message);
        throw new Error('Neither ROS2 manager nor rclnodejs is available');
    }
}

/**
 * ROS2 Bridge Interface Class
 * Provides a unified interface for ROS2 operations using the bridge or fallback
 */
class ROS2BridgeInterface {
    constructor() {
        this.initialized = false;
        this.initializing = false;
        this.node = null;
        this.nodeId = null;
        this.domain = null;
        this.useBridge = !!bridge;
        this.fallbackContext = null;
        console.log(`[RMF-ROS2Manager] Interface created, using bridge: ${this.useBridge}`);
    }

    /**
     * Get the rclnodejs instance for message operations
     * Ensures compatibility between bridge and fallback modes
     * @returns {Object} rclnodejs instance
     */
    getRclnodejs() {
        if (this.useBridge && bridge) {
            const manager = bridge.getROS2Manager();
            return manager.getRclnodejs();
        }
        
        if (!rclnodejs) {
            throw new Error('rclnodejs is not available in fallback mode');
        }
        
        return rclnodejs;
    }

    /**
     * Initialize ROS2 context
     * @param {Object} options - Initialization options
     * @param {number} options.domainId - ROS2 domain ID
     * @returns {Promise<void>}
     */
    async initialize(options = {}) {
        if (this.initialized) {
            console.log('[RMF-ROS2Manager] Already initialized');
            return;
        }

        if (this.initializing) {
            console.log('[RMF-ROS2Manager] Initialization already in progress');
            return;
        }

        this.initializing = true;

        try {
            const domain = options.domainId || process.env.ROS_DOMAIN_ID || 42;
            this.domain = parseInt(domain);

            if (this.useBridge) {
                console.log(`[RMF-ROS2Manager] Initializing using bridge with domain ${this.domain}`);
                
                // Initialize the bridge
                await bridge.initializeROS2({ domain: this.domain });
                
                // Create a node for RMF operations
                const result = await bridge.createNode('node_red_rmf_manager');
                this.nodeId = result.nodeId;
                this.node = result.node;
                
                console.log(`[RMF-ROS2Manager] Bridge initialization complete, node ID: ${this.nodeId}`);
            } else {
                console.log(`[RMF-ROS2Manager] Initializing using direct rclnodejs with domain ${this.domain}`);
                
                // Set domain for rclnodejs
                process.env.ROS_DOMAIN_ID = this.domain.toString();
                
                // Initialize rclnodejs directly
                await rclnodejs.init();
                this.node = rclnodejs.createNode('node_red_rmf_manager');
                this.fallbackContext = { spinning: false };
                
                // Start spinning for fallback mode using per-node approach
                setImmediate(() => {
                    if (!this.fallbackContext.spinning) {
                        try {
                            // Use spinOnce instead of global spin for better reliability
                            this.startPeriodicSpin();
                            this.fallbackContext.spinning = true;
                            console.log('[RMF-ROS2Manager] Fallback spinning started using spinOnce approach');
                        } catch (error) {
                            console.error('[RMF-ROS2Manager] Failed to start fallback spinning:', error);
                        }
                    }
                });
                
                console.log('[RMF-ROS2Manager] Direct rclnodejs initialization complete');
            }

            this.initialized = true;
            console.log('[RMF-ROS2Manager] ROS2 interface initialized successfully');

        } catch (error) {
            console.error('[RMF-ROS2Manager] Initialization failed:', error);
            this.initializing = false;
            throw error;
        } finally {
            this.initializing = false;
        }
    }

    /**
     * Start periodic spinning using spinOnce for fallback mode
     */
    startPeriodicSpin() {
        if (this.node && !this.spinInterval) {
            this.spinInterval = setInterval(() => {
                try {
                    rclnodejs.spinOnce(this.node, 10); // 10ms timeout
                } catch (error) {
                    console.error('[RMF-ROS2Manager] Periodic spin error:', error);
                    // Don't stop spinning on individual errors
                }
            }, 10); // Spin every 10ms
        }
    }

    /**
     * Get the ROS2 node
     * @returns {Object|null} The ROS2 node
     */
    getNode() {
        return this.node;
    }

    /**
     * Get initialization status
     * @returns {Object} Status information
     */
    getStatus() {
        if (this.useBridge && bridge) {
            const bridgeStatus = bridge.getStatus();
            return {
                initialized: this.initialized,
                initializing: this.initializing,
                domain: this.domain,
                nodeId: this.nodeId,
                useBridge: this.useBridge,
                bridgeStatus: bridgeStatus
            };
        } else {
            return {
                initialized: this.initialized,
                initializing: this.initializing,
                domain: this.domain,
                nodeId: null,
                useBridge: this.useBridge,
                fallbackSpinning: this.fallbackContext?.spinning || false
            };
        }
    }

    /**
     * Get information about the ROS2 interface
     * @returns {Object} Interface information
     */
    getInfo() {
        if (this.useBridge && bridge) {
            return bridge.getInfo();
        } else {
            return {
                package: 'rclnodejs-direct',
                version: 'unknown',
                mode: 'fallback',
                initialized: this.initialized
            };
        }
    }

    /**
     * Check if ROS2 is available
     * @returns {boolean}
     */
    static isROS2Available() {
        return !!(bridge || rclnodejs);
    }

    /**
     * Shutdown the interface
     * @returns {Promise<void>}
     */
    async shutdown() {
        if (!this.initialized) {
            return;
        }

        try {
            console.log('[RMF-ROS2Manager] Shutting down ROS2 interface...');

            if (this.useBridge && this.nodeId) {
                // Use bridge shutdown
                await bridge.destroyNode(this.nodeId);
                await bridge.shutdown();
            } else if (this.node && !this.useBridge) {
                // Direct rclnodejs shutdown
                if (this.node.destroy) {
                    this.node.destroy();
                }
                await rclnodejs.shutdown();
            }

            this.initialized = false;
            this.node = null;
            this.nodeId = null;
            this.fallbackContext = null;
            
            console.log('[RMF-ROS2Manager] Shutdown complete');
        } catch (error) {
            console.error('[RMF-ROS2Manager] Error during shutdown:', error);
        }
    }

    /**
     * Register a shutdown callback
     * @param {Function} callback - Shutdown callback
     */
    onShutdown(callback) {
        if (this.useBridge && bridge) {
            bridge.onShutdown(callback);
        } else {
            // For fallback mode, we could store callbacks and call them during shutdown
            console.warn('[RMF-ROS2Manager] Shutdown callbacks not supported in fallback mode');
        }
    }
}

// Singleton instance
let managerInterface = null;

/**
 * Get the shared manager interface instance
 * @returns {ROS2BridgeInterface}
 */
function getROS2ManagerInterface() {
    if (!managerInterface) {
        managerInterface = new ROS2BridgeInterface();
    }
    return managerInterface;
}

// Backward compatibility alias
function getROS2BridgeInterface() {
    return getROS2ManagerInterface();
}

/**
 * Initialize ROS2 using the manager interface
 * @param {Object} options - Initialization options
 * @returns {Promise<ROS2BridgeInterface>}
 */
async function initializeROS2Manager(options = {}) {
    const interface = getROS2ManagerInterface();
    await interface.initialize(options);
    return interface;
}

// Backward compatibility alias
async function initializeROS2Bridge(options = {}) {
    return await initializeROS2Manager(options);
}

/**
 * Shutdown ROS2 manager interface
 * @returns {Promise<void>}
 */
async function shutdownROS2Manager() {
    if (managerInterface) {
        await managerInterface.shutdown();
        managerInterface = null;
    }
}

// Backward compatibility alias
async function shutdownROS2Bridge() {
    return await shutdownROS2Manager();
}

module.exports = {
    ROS2BridgeInterface, // Keep class name for now to avoid breaking changes
    getROS2ManagerInterface,
    getROS2BridgeInterface, // Backward compatibility
    initializeROS2Manager,
    initializeROS2Bridge, // Backward compatibility
    shutdownROS2Manager,
    shutdownROS2Bridge // Backward compatibility
};
