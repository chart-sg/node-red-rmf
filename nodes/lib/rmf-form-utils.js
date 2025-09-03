/**
 * Shared RMF Form Utilities for Node-RED RMF Nodes
 * This file provides common form handling functionality for robot/fleet dropdowns
 * and RMF data management across all RMF nodes.
 */

(function(global) {
  'use strict';

  // RMF Form Utilities - Shared across all RMF nodes
  const RMFFormUtils = {
    
    /**
     * Populate robot dropdown with available robots
     * @param {Object} options - Configuration options
     */
    populateRobotDropdown: function(options = {}) {
      const { node, selectId = 'node-input-robot_name', placeholder = 'Use msg.rmf_robot_name', valueProperty = 'robot_name' } = options;
      const select = $(`#${selectId}`);
      const currentValue = node.isLoaded ? select.val() : node[valueProperty];
      
      select.empty().append(`<option value="">${placeholder}</option>`);
      
      if (node.rmfData && node.rmfData.robots && node.rmfData.robots.length > 0) {
        node.rmfData.robots.forEach(robot => {
          select.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
        });
      }
      
      select.val(currentValue || '');
    },

    /**
     * Populate fleet dropdown with available fleets
     * @param {Object} options - Configuration options
     */
    populateFleetDropdown: function(options = {}) {
      const { node, selectId = 'node-input-robot_fleet', placeholder = 'Use msg.rmf_robot_fleet', valueProperty = 'robot_fleet' } = options;
      const select = $(`#${selectId}`);
      const currentValue = node.isLoaded ? select.val() : node[valueProperty];
      
      select.empty().append(`<option value="">${placeholder}</option>`);
      
      if (node.rmfData && node.rmfData.fleets && node.rmfData.fleets.length > 0) {
        node.rmfData.fleets.forEach(fleet => {
          select.append(`<option value="${fleet}">${fleet}</option>`);
        });
      }
      
      select.val(currentValue || '');
    },

    /**
     * Setup robot and fleet dropdown interaction handlers
     * @param {Object} options - Configuration options
     */
    setupRobotFleetHandlers: function(options = {}) {
      const { node, robotSelectId = 'node-input-robot_name', fleetSelectId = 'node-input-robot_fleet' } = options;
      const robotSelect = $(`#${robotSelectId}`);
      const fleetSelect = $(`#${fleetSelectId}`);

      // Robot selection change handler
      robotSelect.off('change').on('change', function() {
        const selectedRobot = $(this).val();
        const selectedOption = $(this).find('option:selected');
        const robotFleet = selectedOption.data('fleet');
        
        if (selectedRobot && selectedRobot !== '' && robotFleet) {
          fleetSelect.val(robotFleet);
        } else {
          fleetSelect.val('');
        }
      });

      // Fleet selection change handler
      fleetSelect.off('change').on('change', function() {
        const selectedFleet = $(this).val();
        const currentRobot = robotSelect.val();
        
        if (currentRobot && selectedFleet && node.rmfData && node.rmfData.robots) {
          const robot = node.rmfData.robots.find(r => r.name === currentRobot);
          if (robot && robot.fleet !== selectedFleet) {
            robotSelect.val('');
          }
        }
        
        // Filter robots by fleet
        if (selectedFleet && selectedFleet !== '') {
          robotSelect.empty().append('<option value="">Use msg.rmf_robot_name</option>');
          if (node.rmfData && node.rmfData.robots) {
            node.rmfData.robots.forEach(robot => {
              if (robot.fleet === selectedFleet) {
                robotSelect.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
              }
            });
          }
          const robotFromFleet = node.rmfData.robots ? node.rmfData.robots.find(r => r.name === currentRobot && r.fleet === selectedFleet) : null;
          if (robotFromFleet) {
            robotSelect.val(currentRobot);
          }
        } else {
          robotSelect.empty().append('<option value="">Use msg.rmf_robot_name</option>');
          if (node.rmfData && node.rmfData.robots) {
            node.rmfData.robots.forEach(robot => {
              robotSelect.append(`<option value="${robot.name}" data-fleet="${robot.fleet}">${robot.name} (${robot.fleet})</option>`);
            });
          }
          robotSelect.val(currentRobot);
        }
      });
    },

    /**
     * Show data status message
     * @param {string} message - Status message to display
     * @param {string} type - Message type ('info', 'error', 'success')
     * @param {string} configSelectId - ID of the config select element
     */
    showDataStatus: function(message, type = 'info', configSelectId = 'node-input-config') {
      $('.rmf-data-status').remove();
      let color = '#2196f3', icon = 'fa-info-circle';
      if (type === 'error') { color = '#f44336'; icon = 'fa-exclamation-triangle'; }
      else if (type === 'success') { color = '#4caf50'; icon = 'fa-check-circle'; }
      const statusDiv = $(`<div class="rmf-data-status form-tips" style="color: ${color}; margin-top: 10px;"><i class="fa ${icon}" style="margin-right: 5px;"></i>${message}</div>`);
      $(`#${configSelectId}`).closest('.form-row').after(statusDiv);
    },

    /**
     * Load RMF data from the server
     * @param {Object} node - Node instance with rmfData property
     * @returns {Promise} Promise that resolves when data is loaded
     */
    async loadRMFData(node) {
      try {
        // Clear any existing status messages
        $('.rmf-data-status').remove();
        
        const response = await $.get('/rmf/data');
        
        if (response && response.robots) {
          node.rmfData.robots = response.robots;
          node.rmfData.fleets = [...new Set(response.robots.map(r => r.fleet))];
          
          this.populateRobotDropdown({ node });
          this.populateFleetDropdown({ node });
          this.showDataStatus(`Loaded ${response.robots.length} robots`, 'success');
        } else {
          node.rmfData.robots = [];
          node.rmfData.fleets = [];
          this.populateRobotDropdown({ node });
          this.populateFleetDropdown({ node });
          this.showDataStatus('No robot data available', 'warning');
        }
        
      } catch (error) {
        console.error('Failed to load RMF data:', error);
        node.rmfData.robots = [];
        node.rmfData.fleets = [];
        this.populateRobotDropdown({ node });
        this.populateFleetDropdown({ node });
        this.showDataStatus('Failed to load RMF data', 'error');
      }
    },

    /**
     * Setup refresh button functionality
     * @param {Object} node - Node instance
     * @param {string} buttonId - ID of the refresh button
     */
    setupRefreshButton: function(node, buttonId = 'refresh-rmf-data') {
      const self = this;
      $(`#${buttonId}`).on('click', function() {
        const button = $(this);
        const originalText = button.html();
        
        // Show loading state
        button.html('<i class="fa fa-spinner fa-spin"></i> Loading...');
        button.prop('disabled', true);
        
        // Reload data
        self.loadRMFData(node).then(() => {
          // Restore button
          button.html(originalText);
          button.prop('disabled', false);
        }).catch(() => {
          button.html(originalText);
          button.prop('disabled', false);
        });
      });
    },

    /**
     * Initialize RMF form for a node (complete setup)
     * @param {Object} node - Node instance
     * @param {Object} options - Configuration options
     */
    async initializeRMFForm(node, options = {}) {
      // Initialize data storage
      node.rmfData = {
        robots: [],
        fleets: []
      };
      
      // Load RMF data from context
      await this.loadRMFData(node);
      
      // Setup change handlers
      this.setupRobotFleetHandlers({ node, ...options });
      
      // Setup refresh button
      this.setupRefreshButton(node, options.refreshButtonId);
    }
  };

  // Export for Node.js environment (server-side)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = RMFFormUtils;
  }
  
  // Export for browser environment (client-side)
  if (typeof window !== 'undefined') {
    window.RMFFormUtils = RMFFormUtils;
  }
  
  // Export for global scope
  global.RMFFormUtils = RMFFormUtils;

})(typeof window !== 'undefined' ? window : this);
