/**
 * RMF Validation Utilities
 * 
 * Shared validation functions for robot and fleet validation across RMF nodes.
 * Eliminates code duplication and ensures consistent validation behavior.
 */

/**
 * Validates robot name and fleet combination against available RMF data
 * 
 * @param {Object} params - Validation parameters
 * @param {string} params.robotName - Robot name to validate
 * @param {string} params.robotFleet - Robot fleet to validate  
 * @param {Object} params.rmfContextManager - RMF context manager instance
 * @param {string} params.nodeType - Node type for logging (e.g., 'GOTO-PLACE', 'START-TASK')
 * @param {boolean} [params.skipIfEmpty=true] - Skip validation if robot/fleet not specified
 * 
 * @returns {Object} Validation result object
 * @returns {boolean} result.isValid - Whether validation passed
 * @returns {string|null} result.error - Error message if validation failed
 * @returns {Object|null} result.errorPayload - Payload object for failed validation
 */
function validateRobotAndFleet({ robotName, robotFleet, rmfContextManager, nodeType, skipIfEmpty = true }) {
  // Skip validation if robot/fleet not specified (for optional cases like start-task)
  if (skipIfEmpty && (!robotName || !robotFleet)) {
    return { isValid: true, error: null, errorPayload: null };
  }

  // Require both robot name and fleet if either is specified
  if (!robotName || !robotFleet) {
    return {
      isValid: false,
      error: 'Robot name and fleet are required',
      errorPayload: {
        status: 'failed',
        reason: 'Robot name and fleet are required'
      }
    };
  }

  // Get real-time robot data from RMF context manager
  console.log(`[${nodeType}] Getting robots from rmfContextManager...`);
  const allRobots = rmfContextManager.getRobots() || [];
  const availableRobots = allRobots.map(robot => robot.name);
  
  console.log(`[${nodeType}] Available robots from rmfContextManager: [${availableRobots.join(', ')}]`);
  console.log(`[${nodeType}] Validating robot "${robotName}" against available robots`);

  // 1) Validate robot name is in available robot names
  if (availableRobots.length === 0) {
    console.log(`[${nodeType}] No robots available in rmfContextManager, skipping robot validation`);
  } else if (robotName && !availableRobots.includes(robotName)) {
    return {
      isValid: false,
      error: 'Invalid robot name',
      errorPayload: {
        status: 'failed',
        reason: `Robot name "${robotName}" not found in available robots: [${availableRobots.join(', ')}]`
      }
    };
  }

  // 2) Validate robot fleet is in available robot fleets
  const availableFleets = [...new Set(allRobots.map(robot => robot.fleet))];
  
  console.log(`[${nodeType}] Available fleets: [${availableFleets.join(', ')}]`);
  
  if (availableFleets.length === 0) {
    console.log(`[${nodeType}] No fleets available in rmfContextManager, skipping fleet validation`);
  } else if (robotFleet && !availableFleets.includes(robotFleet)) {
    return {
      isValid: false,
      error: 'Invalid robot fleet',
      errorPayload: {
        status: 'failed',
        reason: `Robot fleet "${robotFleet}" not found in available fleets: [${availableFleets.join(', ')}]`
      }
    };
  }

  // 3) Validate robot name belongs to the specified fleet
  if (robotName && robotFleet && allRobots.length > 0) {
    const robotsInFleet = allRobots.filter(robot => robot.fleet === robotFleet).map(robot => robot.name);
    
    console.log(`[${nodeType}] Robots in fleet "${robotFleet}": [${robotsInFleet.join(', ')}]`);
    
    if (!robotsInFleet.includes(robotName)) {
      return {
        isValid: false,
        error: 'Robot not in fleet',
        errorPayload: {
          status: 'failed',
          reason: `Robot "${robotName}" not found in fleet "${robotFleet}". Available robots in fleet: [${robotsInFleet.join(', ')}]`
        }
      };
    }
  }

  // All validations passed
  console.log(`[${nodeType}] Robot "${robotName}" in fleet "${robotFleet}" validation passed`);
  return { isValid: true, error: null, errorPayload: null };
}

/**
 * Validates that basic inputs are provided for RMF operations
 * 
 * @param {Object} params - Validation parameters
 * @param {string} params.robotName - Robot name to validate
 * @param {string} params.robotFleet - Robot fleet to validate
 * @param {string} [params.locationName] - Location name to validate (for goto-place)
 * @param {string} params.nodeType - Node type for logging
 * 
 * @returns {Object} Validation result object
 */
function validateBasicInputs({ robotName, robotFleet, locationName, nodeType }) {
  const required = [];
  
  if (!robotName) required.push('robot name');
  if (!robotFleet) required.push('fleet');
  if (locationName !== undefined && !locationName) required.push('location name');
  
  if (required.length > 0) {
    const missingFields = required.join(', ');
    const message = `${missingFields.charAt(0).toUpperCase() + missingFields.slice(1)} ${required.length > 1 ? 'are' : 'is'} required`;
    
    return {
      isValid: false,
      error: message,
      errorPayload: {
        status: 'failed',
        reason: message
      }
    };
  }

  return { isValid: true, error: null, errorPayload: null };
}

/**
 * Helper function to handle validation results in Node-RED nodes
 * 
 * @param {Object} validationResult - Result from validateRobotAndFleet
 * @param {Function} setStatus - Node's setStatus function
 * @param {Function} send - Node's send function  
 * @param {Function} done - Node's done function
 * @param {Object} msg - Node-RED message object
 * @param {Array} [outputPorts] - Array defining which output ports to use [success, error, ...]
 * 
 * @returns {boolean} Whether to continue execution (true) or stop (false)
 */
function handleValidationResult(validationResult, setStatus, send, done, msg, outputPorts = [null, null]) {
  if (!validationResult.isValid) {
    setStatus('red', 'ring', validationResult.error);
    msg.payload = validationResult.errorPayload;
    
    // Send to error output (second port typically)
    const outputs = outputPorts.map((port, index) => index === 1 ? msg : null);
    send(outputs.length > 1 ? outputs : msg);
    
    done();
    return false; // Stop execution
  }
  
  return true; // Continue execution
}

module.exports = {
  validateRobotAndFleet,
  validateBasicInputs,
  handleValidationResult
};
