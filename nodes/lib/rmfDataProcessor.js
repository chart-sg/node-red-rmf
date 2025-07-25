// File: nodes/lib/rmfDataProcessor.js

/**
 * RMF Data Processor - Handles data validation, processing, and advanced subscription management
 * This module provides utilities for processing RMF data, validating contexts, and managing
 * complex subscription behaviors.
 */

class RMFDataProcessor {
  constructor(rmfCore, rmfConnection) {
    this.rmfCore = rmfCore;
    this.rmfConnection = rmfConnection;
    this.processingCache = new Map();
    this.validationRules = new Map();
    
    // Initialize default validation rules
    this.initializeValidationRules();
  }

  /**
   * Initialize default validation rules for RMF data
   */
  initializeValidationRules() {
    // Robot validation rules
    this.validationRules.set('robot', {
      required: ['name', 'fleet'],
      optional: ['location', 'battery', 'status', 'dynamic_event_seq', 'dynamic_event_status', 'dynamic_event_id'],
      validate: (robot) => {
        if (!robot.name || typeof robot.name !== 'string') {
          return { valid: false, error: 'Robot name must be a non-empty string' };
        }
        if (!robot.fleet || typeof robot.fleet !== 'string') {
          return { valid: false, error: 'Robot fleet must be a non-empty string' };
        }
        return { valid: true };
      }
    });

    // Location validation rules
    this.validationRules.set('location', {
      required: ['name'],
      optional: ['x', 'y', 'yaw', 'level_name', 'graph_index'],
      validate: (location) => {
        if (!location.name || typeof location.name !== 'string') {
          return { valid: false, error: 'Location name must be a non-empty string' };
        }
        if (location.x !== undefined && typeof location.x !== 'number') {
          return { valid: false, error: 'Location x coordinate must be a number' };
        }
        if (location.y !== undefined && typeof location.y !== 'number') {
          return { valid: false, error: 'Location y coordinate must be a number' };
        }
        return { valid: true };
      }
    });

    // Task validation rules
    this.validationRules.set('task', {
      required: ['task_id'],
      optional: ['status', 'fleet_name', 'robot_name', 'phases', 'progress'],
      validate: (task) => {
        if (!task.task_id || typeof task.task_id !== 'string') {
          return { valid: false, error: 'Task ID must be a non-empty string' };
        }
        return { valid: true };
      }
    });
  }

  /**
   * Validate data against predefined rules
   * @param {string} type - Type of data to validate (robot, location, task, etc.)
   * @param {Object} data - Data to validate
   * @returns {Object} Validation result with valid flag and error message if invalid
   */
  validateData(type, data) {
    try {
      const rules = this.validationRules.get(type);
      if (!rules) {
        console.warn(`RMF Data Processor: No validation rules found for type '${type}'`);
        return { valid: true }; // Allow unknown types by default
      }

      // Check required fields
      for (const field of rules.required) {
        if (data[field] === undefined || data[field] === null) {
          return { 
            valid: false, 
            error: `Required field '${field}' is missing for ${type}` 
          };
        }
      }

      // Run custom validation function if provided
      if (rules.validate && typeof rules.validate === 'function') {
        return rules.validate(data);
      }

      return { valid: true };
    } catch (error) {
      console.error(`RMF Data Processor: Validation error for ${type}:`, error);
      return { 
        valid: false, 
        error: `Validation failed: ${error.message}` 
      };
    }
  }

  /**
   * Process and clean robot data
   * @param {Array} robots - Raw robot data
   * @returns {Array} Processed and validated robot data
   */
  processRobotData(robots) {
    if (!Array.isArray(robots)) {
      console.warn('RMF Data Processor: Robot data is not an array');
      return [];
    }

    const processedRobots = [];
    
    for (const robot of robots) {
      // Validate robot data
      const validation = this.validateData('robot', robot);
      if (!validation.valid) {
        console.warn(`RMF Data Processor: Invalid robot data - ${validation.error}:`, robot);
        continue;
      }

      // Process robot data
      const processedRobot = {
        name: robot.name,
        fleet: robot.fleet,
        location: robot.location || 'unknown',
        battery: robot.battery !== undefined ? Math.max(0, Math.min(100, robot.battery)) : null,
        status: robot.status || 'unknown',
        dynamic_event_seq: robot.dynamic_event_seq || 0,
        dynamic_event_status: robot.dynamic_event_status || 'idle',
        dynamic_event_id: robot.dynamic_event_id || null,
        last_updated: new Date().toISOString()
      };

      processedRobots.push(processedRobot);
    }

    console.log(`RMF Data Processor: Processed ${processedRobots.length} robots from ${robots.length} raw entries`);
    return processedRobots;
  }

  /**
   * Process and clean location data
   * @param {Array} locations - Raw location data
   * @returns {Array} Processed and validated location data
   */
  processLocationData(locations) {
    if (!Array.isArray(locations)) {
      console.warn('RMF Data Processor: Location data is not an array');
      return [];
    }

    const processedLocations = [];
    
    for (const location of locations) {
      // Validate location data
      const validation = this.validateData('location', location);
      if (!validation.valid) {
        console.warn(`RMF Data Processor: Invalid location data - ${validation.error}:`, location);
        continue;
      }

      // Process location data
      const processedLocation = {
        name: location.name,
        x: location.x || 0,
        y: location.y || 0,
        yaw: location.yaw || 0,
        level_name: location.level_name || 'L1',
        graph_index: location.graph_index || 0,
        accessible: location.accessible !== false, // Default to true
        last_updated: new Date().toISOString()
      };

      processedLocations.push(processedLocation);
    }

    console.log(`RMF Data Processor: Processed ${processedLocations.length} locations from ${locations.length} raw entries`);
    return processedLocations;
  }

  /**
   * Process door state data
   * @param {Object} doorStates - Raw door state data
   * @returns {Object} Processed door state data
   */
  processDoorStates(doorStates) {
    if (!doorStates || typeof doorStates !== 'object') {
      console.warn('RMF Data Processor: Door states data is not an object');
      return {};
    }

    const processedDoorStates = {};
    
    for (const [doorName, doorState] of Object.entries(doorStates)) {
      if (doorState && typeof doorState === 'object') {
        processedDoorStates[doorName] = {
          current_mode: doorState.current_mode || 'unknown',
          door_time: doorState.door_time || new Date().toISOString(),
          door_name: doorName
        };
      }
    }

    console.log(`RMF Data Processor: Processed ${Object.keys(processedDoorStates).length} door states`);
    return processedDoorStates;
  }

  /**
   * Process lift state data
   * @param {Object} liftStates - Raw lift state data
   * @returns {Object} Processed lift state data
   */
  processLiftStates(liftStates) {
    if (!liftStates || typeof liftStates !== 'object') {
      console.warn('RMF Data Processor: Lift states data is not an object');
      return {};
    }

    const processedLiftStates = {};
    
    for (const [liftName, liftState] of Object.entries(liftStates)) {
      if (liftState && typeof liftState === 'object') {
        processedLiftStates[liftName] = {
          current_floor: liftState.current_floor || 'unknown',
          destination_floor: liftState.destination_floor || 'unknown',
          door_state: liftState.door_state || 'unknown',
          motion_state: liftState.motion_state || 'unknown',
          lift_time: liftState.lift_time || new Date().toISOString(),
          lift_name: liftName
        };
      }
    }

    console.log(`RMF Data Processor: Processed ${Object.keys(processedLiftStates).length} lift states`);
    return processedLiftStates;
  }

  /**
   * Process building map data
   * @param {Object} buildingMap - Raw building map data
   * @returns {Object} Processed building map data
   */
  processBuildingMap(buildingMap) {
    if (!buildingMap || typeof buildingMap !== 'object') {
      console.warn('RMF Data Processor: Building map data is not an object');
      return null;
    }

    try {
      const processedMap = {
        name: buildingMap.name || 'Unknown Building',
        levels: Array.isArray(buildingMap.levels) ? buildingMap.levels : [],
        lifts: Array.isArray(buildingMap.lifts) ? buildingMap.lifts : [],
        nav_graphs: Array.isArray(buildingMap.nav_graphs) ? buildingMap.nav_graphs : [],
        last_updated: new Date().toISOString()
      };

      console.log(`RMF Data Processor: Processed building map with ${processedMap.levels.length} levels, ${processedMap.lifts.length} lifts, ${processedMap.nav_graphs.length} nav graphs`);
      return processedMap;
    } catch (error) {
      console.error('RMF Data Processor: Error processing building map:', error);
      return null;
    }
  }

  /**
   * Add custom validation rule
   * @param {string} type - Data type
   * @param {Object} rule - Validation rule object
   */
  addValidationRule(type, rule) {
    this.validationRules.set(type, rule);
    console.log(`RMF Data Processor: Added validation rule for type '${type}'`);
  }

  /**
   * Get processing statistics
   * @returns {Object} Processing statistics
   */
  getProcessingStats() {
    return {
      cacheSize: this.processingCache.size,
      validationRules: Array.from(this.validationRules.keys()),
      lastProcessedTime: new Date().toISOString()
    };
  }

  /**
   * Clear processing cache
   */
  clearCache() {
    this.processingCache.clear();
    console.log('RMF Data Processor: Cache cleared');
  }

  /**
   * Cleanup method
   */
  cleanup() {
    console.log('RMF Data Processor: Cleaning up...');
    this.clearCache();
    this.validationRules.clear();
    console.log('RMF Data Processor: Cleanup completed');
  }
}

module.exports = RMFDataProcessor;
