// File: nodes/lib/rmfRobotManager.js

/**
 * RMF Robot Manager - Handles robot context management, fleet operations, and robot state tracking
 * This module provides comprehensive robot management capabilities including state tracking,
 * fleet management, robot discovery, and dynamic event status management.
 */

class RMFRobotManager {
  constructor(rmfCore, rmfConnection, rmfDataProcessor) {
    this.rmfCore = rmfCore;
    this.rmfConnection = rmfConnection;
    this.rmfDataProcessor = rmfDataProcessor;
    
    // Robot state tracking
    this.robotStates = new Map(); // robotKey -> state info
    this.fleetManagers = new Map(); // fleetName -> fleet manager
    this.robotDiscoveryCallbacks = new Set();
    this.robotModeChangeCallbacks = new Set(); // Track mode change callbacks
    this.previousRobotModes = new Map(); // Track previous robot modes for change detection
    
    // Performance optimization
    this.lastRobotUpdate = 0;
    this.robotUpdateThrottle = 100; // ms
    
    console.log('RMF Robot Manager: Initialized');
  }

  /**
   * Get all robots from the core context
   * @returns {Array} Array of robot objects
   */
  getAllRobots() {
    return this.rmfCore.getRobots() || [];
  }

  /**
   * Get robot by name and fleet
   * @param {string} robotName - Robot name
   * @param {string} fleetName - Fleet name
   * @returns {Object|null} Robot object or null if not found
   */
  getRobotByNameAndFleet(robotName, fleetName) {
    const robots = this.getAllRobots();
    const robot = robots.find(r => r.name === robotName && r.fleet === fleetName);
    
    return robot || null;
  }

  /**
   * Get all robots in a specific fleet
   * @param {string} fleetName - Fleet name
   * @returns {Array} Array of robots in the fleet
   */
  getRobotsByFleet(fleetName) {
    const robots = this.getAllRobots();
    const fleetRobots = robots.filter(r => r.fleet === fleetName);
    
    console.log(`RMF Robot Manager: Found ${fleetRobots.length} robots in fleet ${fleetName}`);
    return fleetRobots;
  }

  /**
   * Get all available fleets
   * @returns {Array} Array of fleet names
   */
  getAllFleets() {
    const robots = this.getAllRobots();
    const fleets = [...new Set(robots.map(r => r.fleet))];
    
    console.log(`RMF Robot Manager: Found ${fleets.length} fleets: ${fleets.join(', ')}`);
    return fleets;
  }

  /**
   * Get fleet statistics
   * @param {string} fleetName - Fleet name (optional)
   * @returns {Object} Fleet statistics
   */
  getFleetStats(fleetName = null) {
    const robots = fleetName ? this.getRobotsByFleet(fleetName) : this.getAllRobots();
    
    const stats = {
      totalRobots: robots.length,
      byStatus: {},
      byDynamicEventStatus: {},
      averageBattery: 0,
      fleetName: fleetName || 'All Fleets'
    };

    let batterySum = 0;
    let batteryCount = 0;

    robots.forEach(robot => {
      // Count by general status
      const status = robot.status || 'unknown';
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;

      // Count by dynamic event status
      const dynamicStatus = robot.dynamic_event_status || 'idle';
      stats.byDynamicEventStatus[dynamicStatus] = (stats.byDynamicEventStatus[dynamicStatus] || 0) + 1;

      // Calculate average battery
      if (robot.battery !== null && robot.battery !== undefined) {
        batterySum += robot.battery;
        batteryCount++;
      }
    });

    if (batteryCount > 0) {
      stats.averageBattery = Math.round(batterySum / batteryCount);
    }

    return stats;
  }

  /**
   * Update robot context with new information
   * @param {string} robotName - Robot name
   * @param {string} fleetName - Fleet name
   * @param {Object} updates - Updates to apply
   * @returns {Object} Update result
   */
  updateRobotContext(robotName, fleetName, updates) {
    try {
      const robots = this.getAllRobots();
      const robotIndex = robots.findIndex(r => 
        r.name === robotName && r.fleet === fleetName
      );

      if (robotIndex !== -1) {
        const currentRobot = robots[robotIndex];
        
        // Preserve dynamic_event_id if it exists and updates don't include it
        if (currentRobot.dynamic_event_id !== undefined && updates.dynamic_event_id === undefined) {
          console.log(`[RMF][DEBUG] Preserving existing dynamic_event_id: ${currentRobot.dynamic_event_id} for robot ${robotName}`);
          updates.dynamic_event_id = currentRobot.dynamic_event_id;
        }
        
        // Merge updates with current robot data
        const mergedUpdate = {
          ...currentRobot,
          ...updates,
          last_updated: new Date().toISOString()
        };
        
        // Validate the updated robot data
        if (this.rmfDataProcessor) {
          const validation = this.rmfDataProcessor.validateData('robot', mergedUpdate);
          if (!validation.valid) {
            console.warn(`RMF Robot Manager: Robot update validation failed - ${validation.error}`);
            return { success: false, error: validation.error };
          }
        }
        
        // Update the robot in context
        robots[robotIndex] = mergedUpdate;
        
        // Update robot state tracking
        const robotKey = `${fleetName}:${robotName}`;
        this.robotStates.set(robotKey, {
          ...mergedUpdate,
          lastUpdated: Date.now()
        });
        
        // Trigger context update
        this.rmfCore.updateGlobalContext();
        
        // Log status update if present
        if (updates.dynamic_event_status !== undefined) {
          this.logDynamicEventStatusUpdate(robotName, fleetName, updates.dynamic_event_status);
        }
        
        console.log(`RMF Robot Manager: Updated robot ${robotName} (${fleetName}) context:`, updates);
        return { success: true, robot: mergedUpdate };
      } else {
        console.warn(`RMF Robot Manager: Robot ${robotName} from fleet ${fleetName} not found in context`);
        return { success: false, error: 'Robot not found' };
      }
    } catch (error) {
      console.error('RMF Robot Manager: Failed to update robot context:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log dynamic event status update
   * @param {string} robotName - Robot name
   * @param {string} fleetName - Fleet name
   * @param {string} status - New status
   */
  logDynamicEventStatusUpdate(robotName, fleetName, status) {
    console.log(`[RMF][ROBOT] ${robotName} (${fleetName}) dynamic_event_status: ${status}`);
    
    // Emit event for subscribers
    if (this.rmfCore.rmfEvents) {
      this.rmfCore.rmfEvents.emit('robot_dynamic_event_status_changed', {
        robotName,
        fleetName,
        status,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Find available robots for task assignment
   * @param {Object} criteria - Search criteria
   * @returns {Array} Array of available robots
   */
  findAvailableRobots(criteria = {}) {
    const robots = this.getAllRobots();
    
    let availableRobots = robots.filter(robot => {
      // Check if robot is available for tasks
      const isAvailable = robot.dynamic_event_status === 'active' || 
                         robot.dynamic_event_status === 'idle' ||
                         robot.dynamic_event_status === null ||
                         robot.dynamic_event_status === undefined;
      
      if (!isAvailable) return false;

      // Apply fleet filter if specified
      if (criteria.fleet && robot.fleet !== criteria.fleet) {
        return false;
      }

      // Apply battery level filter if specified
      if (criteria.minBattery && (robot.battery === null || robot.battery < criteria.minBattery)) {
        return false;
      }

      // Apply location proximity filter if specified
      if (criteria.nearLocation && robot.location !== criteria.nearLocation) {
        return false;
      }

      return true;
    });

    // Sort by battery level (highest first) if battery data is available
    availableRobots = availableRobots.sort((a, b) => {
      const batteryA = a.battery || 0;
      const batteryB = b.battery || 0;
      return batteryB - batteryA;
    });

    console.log(`RMF Robot Manager: Found ${availableRobots.length} available robots matching criteria:`, criteria);
    return availableRobots;
  }

  /**
   * Get robot by dynamic event sequence
   * @param {number} dynamicEventSeq - Dynamic event sequence number
   * @param {string} fleetName - Fleet name (optional for filtering)
   * @returns {Object|null} Robot with matching dynamic event sequence
   */
  getRobotByDynamicEventSeq(dynamicEventSeq, fleetName = null) {
    const robots = fleetName ? this.getRobotsByFleet(fleetName) : this.getAllRobots();
    
    const robot = robots.find(r => r.dynamic_event_seq === dynamicEventSeq);
    
    if (robot) {
      console.log(`RMF Robot Manager: Found robot with dynamic_event_seq ${dynamicEventSeq}:`, robot);
      return robot;
    } else {
      console.log(`RMF Robot Manager: No robot found with dynamic_event_seq ${dynamicEventSeq}`);
      return null;
    }
  }

  /**
   * Register a callback for robot discovery events
   * @param {Function} callback - Callback function
   */
  onRobotDiscovered(callback) {
    if (typeof callback === 'function') {
      this.robotDiscoveryCallbacks.add(callback);
      console.log('RMF Robot Manager: Robot discovery callback registered');
    }
  }

  /**
   * Unregister a robot discovery callback
   * @param {Function} callback - Callback function to remove
   */
  offRobotDiscovered(callback) {
    this.robotDiscoveryCallbacks.delete(callback);
    console.log('RMF Robot Manager: Robot discovery callback unregistered');
  }

  /**
   * Register a callback for robot mode change events
   * @param {Function} callback - Callback function (robotName, fleetName, oldMode, newMode)
   */
  onRobotModeChanged(callback) {
    if (typeof callback === 'function') {
      this.robotModeChangeCallbacks.add(callback);
      console.log('RMF Robot Manager: Robot mode change callback registered');
    }
  }

  /**
   * Unregister a robot mode change callback
   * @param {Function} callback - Callback function to remove
   */
  offRobotModeChanged(callback) {
    this.robotModeChangeCallbacks.delete(callback);
    console.log('RMF Robot Manager: Robot mode change callback unregistered');
  }

  /**
   * Trigger robot mode change event
   * @param {string} robotName - Robot name
   * @param {string} fleetName - Fleet name
   * @param {number} oldMode - Previous mode
   * @param {number} newMode - New mode
   */
  triggerRobotModeChanged(robotName, fleetName, oldMode, newMode) {
    console.log(`RMF Robot Manager: Robot mode changed - ${robotName}/${fleetName}: ${oldMode} -> ${newMode}`);
    
    this.robotModeChangeCallbacks.forEach(callback => {
      try {
        callback(robotName, fleetName, oldMode, newMode);
      } catch (error) {
        console.error('RMF Robot Manager: Error in robot mode change callback:', error);
      }
    });
  }

  /**
   * Trigger robot discovery event
   * @param {Object} robot - Newly discovered robot
   */
  triggerRobotDiscovered(robot) {
    console.log('RMF Robot Manager: Robot discovered:', robot);
    
    this.robotDiscoveryCallbacks.forEach(callback => {
      try {
        callback(robot);
      } catch (error) {
        console.error('RMF Robot Manager: Error in robot discovery callback:', error);
      }
    });
  }

  /**
   * Get robot state history (if tracking is enabled)
   * @param {string} robotName - Robot name
   * @param {string} fleetName - Fleet name
   * @returns {Array} Array of historical states
   */
  getRobotStateHistory(robotName, fleetName) {
    const robotKey = `${fleetName}:${robotName}`;
    const state = this.robotStates.get(robotKey);
    
    // For now, just return current state. In the future, this could return historical data
    return state ? [state] : [];
  }

  /**
   * Process and update robot data from subscriptions
   * @param {Array} robotData - Raw robot data from subscriptions
   */
  processRobotUpdates(robotData) {
    const now = Date.now();
    
    // Throttle updates to avoid overwhelming the system
    if (now - this.lastRobotUpdate < this.robotUpdateThrottle) {
      return;
    }
    
    this.lastRobotUpdate = now;
    
    try {
      // Process robot data through data processor if available
      let processedRobots = robotData;
      if (this.rmfDataProcessor) {
        processedRobots = this.rmfDataProcessor.processRobotData(robotData);
      }
      
      // Update context with processed robot data
      this.rmfCore.updateContextData('robots', processedRobots);
      
      // Check for newly discovered robots and mode changes
      processedRobots.forEach(robot => {
        const robotKey = `${robot.fleet}:${robot.name}`;
        
        // Check for newly discovered robots
        if (!this.robotStates.has(robotKey)) {
          this.triggerRobotDiscovered(robot);
        }
        
        // Check for robot mode changes
        if (robot.mode && typeof robot.mode.mode === 'number') {
          const previousMode = this.previousRobotModes.get(robotKey);
          const currentMode = robot.mode.mode;
          
          if (previousMode !== undefined && previousMode !== currentMode) {
            // Mode changed - trigger callback
            this.triggerRobotModeChanged(robot.name, robot.fleet, previousMode, currentMode);
          }
          
          // Update stored mode
          this.previousRobotModes.set(robotKey, currentMode);
        }
        
        this.robotStates.set(robotKey, {
          ...robot,
          lastUpdated: now
        });
      });
      
      console.log(`RMF Robot Manager: Processed ${processedRobots.length} robot updates`);
    } catch (error) {
      console.error('RMF Robot Manager: Error processing robot updates:', error);
    }
  }

  /**
   * Get robot manager statistics
   * @returns {Object} Statistics about robot management
   */
  getManagerStats() {
    return {
      totalRobotsTracked: this.robotStates.size,
      totalFleets: this.fleetManagers.size,
      discoveryCallbacks: this.robotDiscoveryCallbacks.size,
      lastUpdateTime: this.lastRobotUpdate,
      updateThrottle: this.robotUpdateThrottle
    };
  }

  /**
   * Set robot update throttle interval
   * @param {number} intervalMs - Throttle interval in milliseconds
   */
  setUpdateThrottle(intervalMs) {
    this.robotUpdateThrottle = Math.max(50, intervalMs); // Minimum 50ms
    console.log(`RMF Robot Manager: Update throttle set to ${this.robotUpdateThrottle}ms`);
  }

  /**
   * Clear robot state tracking
   */
  clearRobotStates() {
    this.robotStates.clear();
    console.log('RMF Robot Manager: Robot states cleared');
  }

  /**
   * Cleanup method
   */
  cleanup() {
    console.log('RMF Robot Manager: Cleaning up...');
    
    // Clear all tracking data
    this.robotStates.clear();
    this.fleetManagers.clear();
    this.robotDiscoveryCallbacks.clear();
    
    // Reset timing
    this.lastRobotUpdate = 0;
    
    console.log('RMF Robot Manager: Cleanup completed');
  }
}

module.exports = RMFRobotManager;
