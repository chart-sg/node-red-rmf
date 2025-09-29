/**
 * RMF Form Utilities
 * 
 * Shared form functions for robot/fleet dropdowns and validation across RMF nodes.
 * Eliminates code duplication and ensures consistent UI behavior.
 * 
 * Usage: Include this script in your HTML files and call the functions.
 */

window.RMFFormUtils = (function() {
  'use strict';

  /**
   * Populates the robot dropdown with available robots
   * @param {Object} options - Configuration options
   * @param {string} options.selectId - ID of the robot select element (default: 'node-input-robot_name')
   * @param {Object} options.node - Node object with rmfData and current values
   * @param {string} [options.placeholder] - Placeholder text for empty option
   * @param {string} [options.valueProperty] - Property to use for robot value (default: 'robot_name')
   */
  function populateRobotDropdown(options = {}) {
    const {
      selectId = 'node-input-robot_name',
      node,
      placeholder = 'Use msg.rmf_robot_name',
      valueProperty = 'robot_name'
    } = options;

    const select = $(`#${selectId}`);
    const currentValue = node.isLoaded ? select.val() : node[valueProperty];
    
    select.empty().append(`<option value="">${placeholder}</option>`);
    
    if (node.rmfData && node.rmfData.robots && node.rmfData.robots.length > 0) {
      node.rmfData.robots.forEach(robot => {
        select.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
      });
    }
    
    select.val(currentValue || '');
  }

  /**
   * Populates the fleet dropdown with available fleets
   * @param {Object} options - Configuration options
   * @param {string} options.selectId - ID of the fleet select element (default: 'node-input-robot_fleet')
   * @param {Object} options.node - Node object with rmfData and current values
   * @param {string} [options.placeholder] - Placeholder text for empty option
   * @param {string} [options.valueProperty] - Property to use for fleet value (default: 'robot_fleet')
   */
  function populateFleetDropdown(options = {}) {
    const {
      selectId = 'node-input-robot_fleet',
      node,
      placeholder = 'Use msg.rmf_robot_fleet',
      valueProperty = 'robot_fleet'
    } = options;

    const select = $(`#${selectId}`);
    const currentValue = node.isLoaded ? select.val() : node[valueProperty];
    
    select.empty().append(`<option value="">${placeholder}</option>`);
    
    if (node.rmfData && node.rmfData.fleets && node.rmfData.fleets.length > 0) {
      node.rmfData.fleets.forEach(fleet => {
        select.append(`<option value="${fleet}">${fleet}</option>`);
      });
    }
    
    select.val(currentValue || '');
  }

  /**
   * Sets up consistent robot/fleet change handlers
   * @param {Object} options - Configuration options
   * @param {string} [options.robotSelectId] - ID of robot select (default: 'node-input-robot_name')
   * @param {string} [options.fleetSelectId] - ID of fleet select (default: 'node-input-robot_fleet')
   * @param {Object} options.node - Node object with rmfData
   * @param {Function} [options.onRobotChange] - Additional callback when robot changes
   * @param {Function} [options.onFleetChange] - Additional callback when fleet changes
   * @param {boolean} [options.enableFleetFiltering] - Whether to filter robots by fleet (default: true)
   */
  function setupRobotFleetHandlers(options = {}) {
    const {
      robotSelectId = 'node-input-robot_name',
      fleetSelectId = 'node-input-robot_fleet',
      node,
      onRobotChange,
      onFleetChange,
      enableFleetFiltering = true
    } = options;

    const robotSelect = $(`#${robotSelectId}`);
    const fleetSelect = $(`#${fleetSelectId}`);

    // Robot selection change handler: auto-select fleet
    robotSelect.off('change').on('change', function() {
      const selectedRobot = $(this).val();
      const selectedOption = $(this).find('option:selected');
      const robotFleet = selectedOption.data('fleet');
      
      // Auto-select fleet to match the robot's fleet
      if (selectedRobot && selectedRobot !== '' && robotFleet) {
        fleetSelect.val(robotFleet);
      } else {
        // If "Use msg..." is selected, clear fleet selection
        fleetSelect.val('');
      }

      // Call additional callback if provided
      if (typeof onRobotChange === 'function') {
        onRobotChange(selectedRobot, robotFleet);
      }
    });

    // Fleet selection change handler: validate robot, filter robot list
    fleetSelect.off('change').on('change', function() {
      const selectedFleet = $(this).val();
      const currentRobot = robotSelect.val();
      
      console.log('Fleet changed to:', selectedFleet || '(Use msg)');
      
      // If robot doesn't belong to selected fleet, clear it
      if (currentRobot && selectedFleet && node.rmfData && node.rmfData.robots) {
        const robot = node.rmfData.robots.find(r => r.name === currentRobot);
        if (robot && robot.fleet !== selectedFleet) {
          robotSelect.val('');
          console.log('Cleared robot selection - does not belong to selected fleet');
        }
      }
      
      // Filter robots by fleet if enabled
      if (enableFleetFiltering) {
        filterRobotsByFleet({
          robotSelectId,
          fleetSelectId,
          node,
          selectedFleet,
          currentRobot
        });
      }

      // Call additional callback if provided
      if (typeof onFleetChange === 'function') {
        onFleetChange(selectedFleet, currentRobot);
      }
    });
  }

  /**
   * Filters robot dropdown to show only robots from selected fleet
   * @param {Object} options - Configuration options
   */
  function filterRobotsByFleet(options = {}) {
    const {
      robotSelectId = 'node-input-robot_name',
      fleetSelectId = 'node-input-robot_fleet',
      node,
      selectedFleet,
      currentRobot
    } = options;

    const robotSelect = $(`#${robotSelectId}`);

    if (selectedFleet && selectedFleet !== '') {
      // Filter robots to only show those from the selected fleet
      robotSelect.empty();
      robotSelect.append('<option value="">Use msg.rmf_robot_name</option>');
      
      if (node.rmfData && node.rmfData.robots && node.rmfData.robots.length > 0) {
        node.rmfData.robots.forEach(robot => {
          if (robot.fleet === selectedFleet) {
            robotSelect.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
          }
        });
      }
      
      // Restore selection if robot is from the selected fleet
      const robotFromFleet = node.rmfData.robots ? 
        node.rmfData.robots.find(r => r.name === currentRobot && r.fleet === selectedFleet) : null;
      if (robotFromFleet) {
        robotSelect.val(currentRobot);
      }
    } else {
      // If "Use msg.rmf_robot_fleet" is selected, show all robots
      robotSelect.empty();
      robotSelect.append('<option value="">Use msg.rmf_robot_name</option>');
      
      if (node.rmfData && node.rmfData.robots && node.rmfData.robots.length > 0) {
        node.rmfData.robots.forEach(robot => {
          robotSelect.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
        });
      }
      
      // Restore the current robot selection
      robotSelect.val(currentRobot);
    }
  }

  /**
   * Shows a status message near the config dropdown
   * @param {string} message - Message to display
   * @param {string} type - Type of message ('error', 'success', 'info')
   * @param {string} [configSelectId] - ID of config select element
   */
  function showDataStatus(message, type = 'info', configSelectId = 'node-input-config') {
    // Remove any existing status messages
    $('.rmf-data-status').remove();
    
    let statusClass = 'form-tips';
    let icon = 'fa-info-circle';
    let color = '#2196f3';
    
    if (type === 'error') {
      statusClass = 'form-tips';
      icon = 'fa-exclamation-triangle';
      color = '#f44336';
    } else if (type === 'success') {
      statusClass = 'form-tips';
      icon = 'fa-check-circle';
      color = '#4caf50';
    }
    
    const statusDiv = $(`
      <div class="rmf-data-status ${statusClass}" style="color: ${color}; margin-top: 10px;">
        <i class="fa ${icon}" style="margin-right: 5px;"></i>
        ${message}
      </div>
    `);
    
    $(`#${configSelectId}`).closest('.form-row').after(statusDiv);
  }

  /**
   * Sets up RMF data loading and dropdown population
   * @param {Object} options - Configuration options
   * @param {Object} options.node - Node object
   * @param {string} [options.configSelectId] - ID of config select element
   * @param {Function} [options.onDataLoaded] - Callback when data is loaded
   * @param {Function} [options.onDataError] - Callback when data loading fails
   */
  function setupRMFDataHandling(options = {}) {
    const {
      node,
      configSelectId = 'node-input-config',
      onDataLoaded,
      onDataError
    } = options;

    // Initialize RMF data structure
    node.rmfData = { robots: [], fleets: [] };

    // Config selection change handler
    $(`#${configSelectId}`).on('change', function() {
      const configId = $(this).val();
      if (configId) {
        console.log('Loading RMF data for config:', configId);
        
        // Simulate loading RMF data (replace with actual data loading logic)
        $.get(`/rmf-config/${configId}/data`)
          .done(function(data) {
            console.log('RMF data loaded:', data);
            node.rmfData = data;
            
            showDataStatus(`Loaded ${data.robots.length} robots from ${data.fleets.length} fleets`, 'success', configSelectId);
            
            // Repopulate dropdowns
            populateRobotDropdown({ node });
            populateFleetDropdown({ node });
            
            if (typeof onDataLoaded === 'function') {
              onDataLoaded(data);
            }
          })
          .fail(function() {
            console.log('Failed to load RMF data');
            node.rmfData = { robots: [], fleets: [] };
            showDataStatus('Failed to load RMF data. Check RMF Config node.', 'error', configSelectId);
            
            if (typeof onDataError === 'function') {
              onDataError();
            }
          });
      } else {
        node.rmfData = { robots: [], fleets: [] };
        populateRobotDropdown({ node });
        populateFleetDropdown({ node });
      }
    });
  }

  // Public API
  return {
    populateRobotDropdown,
    populateFleetDropdown,
    setupRobotFleetHandlers,
    filterRobotsByFleet,
    showDataStatus,
    setupRMFDataHandling
  };
})();
