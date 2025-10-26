// File: nodes/lib/rmfSubscriptions.js
const { processBuildingMapData, processFleetStateData, processDoorStateData, processLiftStateData } = require('./rmfMessageTransformers');

class RMFSubscriptions {
  constructor(rosNode, context, updateCallback) {
    this.rosNode = rosNode;
    this.context = context;
    this.updateCallback = updateCallback;
    this.subscribers = {};
    this.serviceClients = {};
    
    // Building map caching to prevent duplicate requests
    this.buildingMapCache = {
      data: null,
      promise: null,
      lastRequested: 0,
      cacheTimeout: 30000 // Cache for 30 seconds
    };
    
    // Data processing throttling - limit how often we actually process the data
    this.processThrottling = {
      buildingMap: { lastProcessed: 0, interval: 5000 },  // Process every 5 seconds (nav_graphs subscription)
      fleetState: { lastProcessed: 0, interval: 1000 },   // Process every 1 second (robot positions)
      doorState: { lastProcessed: 0, interval: 1000 },    // Process every 1 second (reduced from 5s for debugging)
      liftState: { lastProcessed: 0, interval: 1000 }     // Process every 1 second (reduced from 5s for debugging)
    };
    
    // Store latest messages for each type (so we don't lose the most recent data)
    this.latestMessages = {
      buildingMap: null,  // Now stores nav_graphs data instead of service response
      fleetState: {},  // Store by fleet name
      doorState: {},   // Store by door name
      liftState: {}    // Store by lift name
    };
    
    // Message counters for monitoring
    this.messageCounters = {
      buildingMap: 0,  // Now counts nav_graphs messages
      fleetState: 0,
      doorState: 0,
      liftState: 0,
      dynamicEvent: 0
    };
    
    // Processed message counters
    this.processedCounters = {
      buildingMap: 0,  // Now counts nav_graphs processing
      fleetState: 0,
      doorState: 0,
      liftState: 0,
      dynamicEvent: 0
    };
  }

  async setupAllSubscriptions() {
    if (!this.rosNode) {
      console.log('RMF: Cannot setup subscriptions - ROS node not available');
      return;
    }

    try {
      console.log('RMF: Setting up RMF topic subscriptions...');

      // Setup nav_graphs subscription first for building map and zone data
      await this.setupNavGraphsSubscription();

      // Then setup other topic subscriptions
      await this.setupFleetStateSubscription();
      await this.setupDoorStateSubscription();
      await this.setupLiftStateSubscription();
      // Setup dynamic event subscription to capture dynamic_event_seq
      await this.setupDynamicEventSubscription();

      console.log('RMF: All RMF subscriptions setup successfully (using nav_graphs topic for building map and zones)');

    } catch (error) {
      console.error('RMF: Failed to setup subscriptions:', error.message);
    }
  }

  async setupNavGraphsSubscription() {
    try {
      console.log('RMF: Setting up nav_graphs subscription for building map and zone data...');
      
      // Use the correct QoS configuration that works with TRANSIENT_LOCAL
      // Get rclnodejs from SharedManager (required dependency)
      const ros2Bridge = require('@chart/node-red-ros2-manager');
      const manager = ros2Bridge.getROS2Manager();
      const rclnodejs = manager.getRclnodejs();
      
      const qos = new rclnodejs.QoS();
      qos.reliability = rclnodejs.QoS.ReliabilityPolicy.RMW_QOS_POLICY_RELIABILITY_RELIABLE;
      qos.durability = rclnodejs.QoS.DurabilityPolicy.RMW_QOS_POLICY_DURABILITY_TRANSIENT_LOCAL;
      qos.history = rclnodejs.QoS.HistoryPolicy.RMW_QOS_POLICY_HISTORY_KEEP_LAST;
      qos.depth = 10;
      
      const subscription = this.rosNode.createSubscription(
        'rmf_building_map_msgs/msg/Graph',
        '/nav_graphs',
        { qos: qos },
        (msg) => {
          console.log(`RMF: Received nav_graphs message - Graph: ${msg.name}, Vertices: ${msg.vertices?.length || 0}, Edges: ${msg.edges?.length || 0}, Zones: ${msg.zones?.length || 0}`);
          // Process immediately since nav_graphs is typically published once at startup
          this.processNavGraphsData(msg);
        }
      );
      
      this.subscribers.navGraphs = subscription;
      console.log('RMF: Nav_graphs subscription created with TRANSIENT_LOCAL QoS');
      
    } catch (error) {
      console.error('RMF: Failed to create nav_graphs subscription:', error.message);
    }
  }

  // Process nav_graphs messages (contains building map structure + zone data)
  // Process nav_graphs data and extract zones and navigation information
  processNavGraphsData(navGraphMsg) {
    try {
      // Update message counters
      this.messageCounters.buildingMap = (this.messageCounters.buildingMap || 0) + 1;
      this.processedCounters.buildingMap = (this.processedCounters.buildingMap || 0) + 1;
      
      // Always store the latest message
      this.latestMessages.buildingMap = navGraphMsg;
      
      // Process navigation graph data
      
      // Extract zones, vertices, and edges from the nav_graphs message
      const zones = navGraphMsg.zones || [];
      const vertices = navGraphMsg.vertices || [];
      const edges = navGraphMsg.edges || [];
      

      
      // Process zones
      if (zones.length > 0) {
        // Zone processing logic
      }
      
      // Process vertices as locations
      const locations = [];
      if (vertices.length > 0) {
        vertices.forEach((vertex, idx) => {
          // Extract parameters from vertex params
          const params = vertex.params || [];
          const mapNameParam = params.find(p => p.name === 'map_name');
          const isChargerParam = params.find(p => p.name === 'is_charger');
          const isParkingSpotParam = params.find(p => p.name === 'is_parking_spot');
          const isHoldingPointParam = params.find(p => p.name === 'is_holding_point');
          
          const location = {
            name: vertex.name,
            x: vertex.x || 0,
            y: vertex.y || 0,
            yaw: 0, // vertices don't typically have yaw in nav_graphs
            level_name: mapNameParam ? mapNameParam.value_string : 'L1',
            graph_index: 0,
            type: 'waypoint', // default type
            is_charger: isChargerParam ? isChargerParam.value_bool : false,
            is_parking_spot: isParkingSpotParam ? isParkingSpotParam.value_bool : false,
            is_holding_point: isHoldingPointParam ? isHoldingPointParam.value_bool : false,
            accessible: true,
            last_updated: new Date().toISOString()
          };
          
          // Determine location type based on parameters
          if (location.is_charger) {
            location.type = 'charger';
          } else if (location.is_parking_spot) {
            location.type = 'parking';
          } else if (location.is_holding_point) {
            location.type = 'holding';
          }
          
          locations.push(location);
        });
        
        // Group locations by type for final summary
        const locationsByType = locations.reduce((acc, loc) => {
          acc[loc.type] = (acc[loc.type] || 0) + 1;
          return acc;
        }, {});
        
        // Store for final summary
        this.tempLocationsByType = locationsByType;
      }
      
      // Update context with zone, location, and navigation data
      if (!this.context.zones) {
        this.context.zones = [];
      }
      
      if (!this.context.locations) {
        this.context.locations = [];
      }
      
      // Update zones: Handle shared zones across multiple fleets
      zones.forEach(zone => {
        // Check if zone already exists (by name and position)
        const existingZoneIndex = this.context.zones.findIndex(
          z => z.name === zone.name && 
               Math.abs(z.center.x - zone.center_x) < 0.01 && 
               Math.abs(z.center.y - zone.center_y) < 0.01
        );
        
        if (existingZoneIndex >= 0) {
          // Zone exists - add this fleet to its accessibility list
          const existingZone = this.context.zones[existingZoneIndex];
          if (!existingZone.fleets) {
            existingZone.fleets = [existingZone.fleet]; // Convert single fleet to array
            delete existingZone.fleet; // Remove old single fleet property
          }
          if (!existingZone.fleets.includes(navGraphMsg.name)) {
            existingZone.fleets.push(navGraphMsg.name);
          }
          // Update other properties if needed (keep most recent data)
          existingZone.type = zone.zone_type;
          existingZone.level = zone.level;
          existingZone.center = { x: zone.center_x, y: zone.center_y };
          existingZone.yaw = zone.yaw;
          existingZone.dimensions = { length: zone.length, width: zone.width };
          existingZone.vertices = zone.zone_vertices || [];
          existingZone.transitionLanes = zone.zone_transition_lanes || [];
          existingZone.graph = navGraphMsg.name;
          existingZone.fleets = [...new Set(existingZone.fleets)]; // Remove duplicates
        } else {
          // New zone - add with fleet list
          this.context.zones.push({
            name: zone.name,
            type: zone.zone_type,
            level: zone.level,
            center: {
              x: zone.center_x,
              y: zone.center_y
            },
            yaw: zone.yaw,
            dimensions: {
              length: zone.length,
              width: zone.width
            },
            vertices: zone.zone_vertices || [],
            transitionLanes: zone.zone_transition_lanes || [],
            graph: navGraphMsg.name,
            fleets: [navGraphMsg.name]  // Set fleets array when creating zone
          });
        }
      });
      
      // Update locations: Handle shared locations across multiple fleets
      locations.forEach(location => {
        // Check if location already exists (by name and position)
        const existingLocationIndex = this.context.locations.findIndex(
          loc => loc.name === location.name && 
                 Math.abs(loc.x - location.x) < 0.01 && 
                 Math.abs(loc.y - location.y) < 0.01
        );
        
        if (existingLocationIndex >= 0) {
          // Location exists - add this fleet to its accessibility list
          const existingLocation = this.context.locations[existingLocationIndex];
          if (!existingLocation.fleets) {
            existingLocation.fleets = [existingLocation.fleet]; // Convert single fleet to array
            delete existingLocation.fleet; // Remove old single fleet property
          }
          if (!existingLocation.fleets.includes(navGraphMsg.name)) {
            existingLocation.fleets.push(navGraphMsg.name);
          }
          // Update other properties if needed (keep most recent data)
          Object.assign(existingLocation, location);
          existingLocation.fleets = [...new Set(existingLocation.fleets)]; // Remove duplicates
        } else {
          // New location - add with fleet list
          location.fleets = [navGraphMsg.name];
          this.context.locations.push(location);
        }
      });
      
      // Update navigation graph data
      if (!this.context.navGraphs) {
        this.context.navGraphs = [];
      }
      
      // Find existing graph or add new one
      const existingGraphIndex = this.context.navGraphs.findIndex(g => g.name === navGraphMsg.name);
      const graphData = {
        name: navGraphMsg.name,
        fleet: navGraphMsg.name, // Graph name typically corresponds to fleet name
        vertices: vertices,
        edges: edges,
        zones: zones,
        lastUpdated: Date.now()
      };
      
      if (existingGraphIndex >= 0) {
        this.context.navGraphs[existingGraphIndex] = graphData;
      } else {
        this.context.navGraphs.push(graphData);
      }
      
      // Generate final summary with location types
      let summary = `RMF: Updated context with ${zones.length} zones, ${locations.length} locations, and navigation graph '${navGraphMsg.name}'`;
      
      if (this.tempLocationsByType && Object.keys(this.tempLocationsByType).length > 0) {
        const typeSummary = Object.entries(this.tempLocationsByType)
          .map(([type, count]) => `${count} ${type}${count !== 1 ? 's' : ''}`)
          .join(', ');
        summary += ` (${typeSummary})`;
        delete this.tempLocationsByType; // Clean up
      }
      
      console.log(summary);
      
      // Update the global rmfCore context as well for compatibility
      const rmfCore = require('./rmfCore');
      if (rmfCore.updateContextData) {
        rmfCore.updateContextData('locations', this.context.locations);
        rmfCore.updateContextData('zones', this.context.zones);
        rmfCore.updateContextData('navGraphs', this.context.navGraphs);
      }
      
      // Notify context update via callback
      if (this.contextUpdateCallback) {
        this.contextUpdateCallback();
      }
      
      // Trigger context update callback
      if (this.updateCallback) {
        this.updateCallback();
      }
      
    } catch (error) {
      console.error('RMF: Failed to process nav_graphs data:', error.message);
    }
  }

  // DEPRECATED: Service-based building map methods replaced by nav_graphs subscription
  // Keeping methods for backward compatibility but they're no longer used in setupAllSubscriptions()
  
  async setupServiceClients() {
    try {
      console.log('RMF: Setting up service clients... (DEPRECATED - using nav_graphs subscription instead)');
      
      // Setup building map service client (kept for backward compatibility)
      // Note: We don't actually use rclnodejs directly here, just for consistency
      const ros2Bridge = require('@chart/node-red-ros2-manager');
      const manager = ros2Bridge.getROS2Manager();
      // Verify SharedManager is available (no need to store rclnodejs here)
      manager.getRclnodejs();
      
      this.serviceClients.buildingMap = this.rosNode.createClient(
        'rmf_building_map_msgs/srv/GetBuildingMap',
        '/get_building_map'
      );
      
      console.log('RMF: Building map service client created (but nav_graphs subscription is preferred)');
      
    } catch (error) {
      console.error('RMF: Failed to create service clients:', error.message);
    }
  }

  async requestBuildingMapFromService() {
    try {
      const now = Date.now();
      
      // Check if we have cached data that's still valid
      if (this.buildingMapCache.data && 
          (now - this.buildingMapCache.lastRequested) < this.buildingMapCache.cacheTimeout) {
        console.log('RMF: Using cached building map data');
        return true;
      }
      
      // Check if there's already a request in progress
      if (this.buildingMapCache.promise) {
        console.log('RMF: Building map request already in progress, waiting...');
        return await this.buildingMapCache.promise;
      }
      
      // Create new request promise
      console.log('RMF: Requesting building map from service using SafeServiceClient...');
      this.buildingMapCache.promise = this._fetchBuildingMapFromService();
      
      try {
        const result = await this.buildingMapCache.promise;
        this.buildingMapCache.lastRequested = now;
        return result;
      } finally {
        // Clear the promise regardless of success/failure
        this.buildingMapCache.promise = null;
      }
      
    } catch (error) {
      console.error('RMF: Failed to request building map from service:', error.message);
      this.buildingMapCache.promise = null;
      return false;
    }
  }
  
  async _fetchBuildingMapFromService() {
    const { SafeServiceClient } = require('./rmf-safe-service-client');
    const serviceClient = new SafeServiceClient(
      'rmf_building_map_msgs/srv/GetBuildingMap',
      '/get_building_map'
    );
    
    const response = await serviceClient.callService({});
    if (response && response.building_map) {
      console.log('RMF: Building map received from service');
      console.log(`RMF: Building: ${response.building_map.name}`);
      console.log(`RMF: Levels: ${response.building_map.levels.length}`);
      
      // Cache the building map data
      this.buildingMapCache.data = response.building_map;
      
      // Process the building map data
      const { processBuildingMapFromService } = require('./rmfMessageTransformers');
      processBuildingMapFromService(response.building_map, this.context, this.updateCallback);
      return true;
    } else {
      console.error('RMF: Invalid response from building map service');
      return false;
    }
  }

  // setupBuildingMapSubscription removed: always use service for building map/locations

  async setupFleetStateSubscription() {
    try {
      console.log('RMF: Setting up fleet state subscription...');
      
      // QoS settings for fleet state - typically best effort for frequent updates
      const qosProfile = {
        reliability: 'best_effort',
        durability: 'volatile'
      };
      
      const subscription = this.rosNode.createSubscription(
        'rmf_fleet_msgs/msg/FleetState',
        '/fleet_states',
        (msg) => {
          this.throttledProcessFleetState(msg);
        },
        qosProfile
      );
      
      this.subscribers.fleetState = subscription;
      console.log('RMF: Fleet state subscription created with QoS settings');
      
    } catch (error) {
      console.error('RMF: Failed to create fleet state subscription:', error.message);
    }
  }

  async setupDoorStateSubscription() {
    try {
      console.log('RMF: Setting up door state subscription...');
      
      // QoS settings for door state - reliable for state changes
      const qosProfile = {
        reliability: 'reliable',
        durability: 'transient_local'
      };
      
      const subscription = this.rosNode.createSubscription(
        'rmf_door_msgs/msg/DoorState',
        '/door_states',
        (msg) => {
          this.throttledProcess('doorState', msg, processDoorStateData, msg.door_name);
        },
        qosProfile
      );
      
      this.subscribers.doorState = subscription;
      console.log('RMF: Door state subscription created with QoS settings');
      
    } catch (error) {
      console.error('RMF: Failed to create door state subscription:', error.message);
    }
  }

  async setupLiftStateSubscription() {
    try {
      console.log('RMF: Setting up lift state subscription...');
      
      // QoS settings for lift state - reliable for state changes
      const qosProfile = {
        reliability: 'reliable',
        durability: 'transient_local'
      };
      
      const subscription = this.rosNode.createSubscription(
        'rmf_lift_msgs/msg/LiftState',
        '/lift_states',
        (msg) => {
          this.throttledProcess('liftState', msg, processLiftStateData, msg.lift_name);
        },
        qosProfile
      );
      
      this.subscribers.liftState = subscription;
      console.log('RMF: Lift state subscription created with QoS settings');
      
    } catch (error) {
      console.error('RMF: Failed to create lift state subscription:', error.message);
    }
  }

  async setupDynamicEventSubscription() {
    try {
      console.log('RMF: Setting up dynamic event subscription...');
      
      // QoS settings for dynamic events - reliable for important state changes
      const qosProfile = {
        reliability: 'reliable',
        durability: 'transient_local'
      };
      
      const subscription = this.rosNode.createSubscription(
        'rmf_task_msgs/msg/DynamicEventDescription',  // Use the correct message type
        '/rmf/dynamic_event/begin',
        (msg) => {
          try {
            // The message is already a structured object, not a JSON string
            console.log('RMF: Received dynamic event begin message:', msg);
            this.processDynamicEventBegin(msg);
          } catch (error) {
            console.error('RMF: Failed to process dynamic event begin message:', error.message);
          }
        },
        qosProfile
      );
      
      this.subscribers.dynamicEvent = subscription;
      console.log('RMF: Dynamic event subscription created');
      
    } catch (error) {
      console.error('RMF: Failed to create dynamic event subscription:', error.message);
    }
  }

  // Dynamic event processing disabled to avoid conflicts with existing subscriber nodes
  processDynamicEventBegin(eventData) {
    try {
      // Increment message counter
      this.messageCounters.dynamicEvent++;
      
      // Extract data from the DynamicEventDescription message
      const { fleet, robot, dynamic_event_seq, description, start_time } = eventData;
      
      // Convert ROS2 time to milliseconds
      const startTimeMs = start_time ? (start_time.sec * 1000 + start_time.nanosec / 1000000) : Date.now();
      
      // Find the robot in our context
      const robotIndex = this.context.robots.findIndex(r => 
        r.name === robot && r.fleet === fleet
      );
      
      if (robotIndex !== -1) {
        // Update the robot with dynamic event session info
        this.context.robots[robotIndex] = {
          ...this.context.robots[robotIndex],
          dynamic_event_seq,
          dynamic_event_description: description,
          dynamic_event_start_time: startTimeMs,
          dynamic_event_status: 'active'
        };
        
        console.log(`[RMF][DEBUG] Updated robot ${robot} (${fleet}) with dynamic_event_seq: ${dynamic_event_seq}, status: active, description: ${JSON.stringify(description)}, start_time: ${startTimeMs}`);
        // Enhanced: Log full robot context after update
        try {
          console.log('[RMF][DEBUG] Robot context after update:', JSON.stringify(this.context.robots[robotIndex], null, 2));
        } catch (logErr) {
          console.log('[RMF][DEBUG] Robot context after update: [unserializable]');
        }
        // Increment processed counter
        this.processedCounters.dynamicEvent++;
        
        // IMPORTANT: Also update the global context manager's robot context
        // This ensures that getRobotContext() will find the dynamic_event_seq
        const { updateRobotContext } = require('./rmfContextManager');
        updateRobotContext(robot, fleet, {
          dynamic_event_seq,
          dynamic_event_description: description,
          dynamic_event_start_time: startTimeMs,
          dynamic_event_status: 'active'
        });
        console.log(`[RMF][DEBUG] Called updateRobotContext for ${robot} (${fleet}) with status: active`);
        // Trigger context update
        if (this.updateCallback) {
          console.log('[RMF][DEBUG] Triggering updateCallback after dynamic event begin');
          this.updateCallback();
        }
      } else {
        console.warn(`[RMF][WARN] Robot ${robot} from fleet ${fleet} not found in context for dynamic event`);
        // If robot not found, create a basic robot entry with dynamic event info
        this.context.robots.push({
          name: robot,
          fleet: fleet,
          dynamic_event_seq,
          dynamic_event_description: description,
          dynamic_event_start_time: startTimeMs,
          dynamic_event_status: 'active',
          location: { x: 0, y: 0, yaw: 0 },
          battery: { charge: 0 },
          status: 'unknown'
        });
        console.log(`[RMF][DEBUG] Created new robot entry for ${robot} (${fleet}) with dynamic_event_seq: ${dynamic_event_seq}, status: active`);
        // Enhanced: Log full robot context after creation
        try {
          console.log('[RMF][DEBUG] New robot context:', JSON.stringify(this.context.robots[this.context.robots.length - 1], null, 2));
        } catch (logErr) {
          console.log('[RMF][DEBUG] New robot context: [unserializable]');
        }
        // Increment processed counter
        this.processedCounters.dynamicEvent++;
        // Trigger context update
        if (this.updateCallback) {
          console.log('[RMF][DEBUG] Triggering updateCallback after new robot entry');
          this.updateCallback();
        }
      }
      
    } catch (error) {
      console.error('[RMF][ERROR] Failed to process dynamic event begin:', error.message);
    }
  }

  // Helper to log when status is set to 'underway' (or any status)
  logDynamicEventStatusUpdate(robotName, fleetName, status) {
    if (status === 'underway') {
      console.log(`[RMF][DEBUG] Dynamic event status for ${robotName} (${fleetName}) set to 'underway'`);
    } else {
      console.log(`[RMF][DEBUG] Dynamic event status for ${robotName} (${fleetName}) set to '${status}'`);
    }
  }

  // Throttled processing for generic messages
  throttledProcess(messageType, msg, processor, key = null) {
    this.messageCounters[messageType]++;
    
    // Always store the latest message
    if (key) {
      this.latestMessages[messageType][key] = msg;
    } else {
      this.latestMessages[messageType] = msg;
    }
    
    const now = Date.now();
    const throttleConfig = this.processThrottling[messageType];
    
    if (now - throttleConfig.lastProcessed >= throttleConfig.interval) {
      // Process the latest messages
      if (key) {
        // For keyed messages (doors, lifts), process all stored messages
        Object.values(this.latestMessages[messageType]).forEach(messageToProcess => {
          if (messageToProcess) {
            processor(messageToProcess, this.context, this.updateCallback);
          }
        });
      } else {
        // For non-keyed messages (building map), process the single latest message
        const messageToProcess = this.latestMessages[messageType];
        if (messageToProcess) {
          processor(messageToProcess, this.context, this.updateCallback);
        }
      }
      
      this.processedCounters[messageType]++;
      throttleConfig.lastProcessed = now;
    }
  }
  
  // Special handling for fleet state since we need to process each fleet separately
  throttledProcessFleetState(msg) {
    this.messageCounters.fleetState++;
    
    // Always store the latest message for this fleet
    this.latestMessages.fleetState[msg.name] = msg;
    
    const now = Date.now();
    const throttleConfig = this.processThrottling.fleetState;
    
    if (now - throttleConfig.lastProcessed >= throttleConfig.interval) {
      // Process all latest fleet states
      Object.values(this.latestMessages.fleetState).forEach(fleetMsg => {
        processFleetStateData(fleetMsg, this.context, this.updateCallback);
      });
      
      this.processedCounters.fleetState++;
      throttleConfig.lastProcessed = now;
    }
  }

  cleanup() {
    console.log('Cleaning up RMF subscriptions...');
    
    // Clean up topic subscriptions
    Object.keys(this.subscribers).forEach(key => {
      if (this.subscribers[key] && this.subscribers[key].destroy) {
        this.subscribers[key].destroy();
      }
    });
    
    // Clean up service clients
    Object.keys(this.serviceClients).forEach(key => {
      if (this.serviceClients[key] && this.serviceClients[key].destroy) {
        this.serviceClients[key].destroy();
      }
    });
    
    this.subscribers = {};
    this.serviceClients = {};
    console.log('RMF subscriptions and service clients cleaned up');
  }

  getSubscribers() {
    return this.subscribers;
  }

  // Get statistics about message frequency and processing
  getMessageStats() {
    const stats = {};
    Object.keys(this.messageCounters).forEach(key => {
      const received = this.messageCounters[key];
      const processed = this.processedCounters[key];
      const throttleConfig = this.processThrottling[key];
      
      stats[key] = {
        messagesReceived: received,
        messagesProcessed: processed,
        messagesSkipped: received - processed,
        throttleIntervalMs: throttleConfig ? throttleConfig.interval : 'N/A',
        lastProcessedTime: throttleConfig ? throttleConfig.lastProcessed : 'N/A',
        processingRate: processed > 0 ? (received / processed).toFixed(2) : 'N/A'
      };
    });
    return stats;
  }

  // Method to adjust throttle intervals if needed
  setThrottleInterval(subscriptionType, intervalMs) {
    if (this.processThrottling[subscriptionType]) {
      this.processThrottling[subscriptionType].interval = intervalMs;
      console.log(`RMF: Throttle interval for ${subscriptionType} set to ${intervalMs}ms`);
    }
  }

  // Method to get current throttle settings
  getThrottleSettings() {
    const settings = {};
    Object.keys(this.processThrottling).forEach(key => {
      settings[key] = {
        interval: this.processThrottling[key].interval,
        lastProcessed: this.processThrottling[key].lastProcessed
      };
    });
    return settings;
  }

  // Method to force immediate processing (useful for testing)
  forceProcessLatest(subscriptionType) {
    if (this.latestMessages[subscriptionType]) {
      if (subscriptionType === 'fleetState') {
        Object.values(this.latestMessages.fleetState).forEach(fleetMsg => {
          processFleetStateData(fleetMsg, this.context, this.updateCallback);
        });
      } else if (subscriptionType === 'buildingMap') {
        // Process nav_graphs data
        this.processNavGraphsData(this.latestMessages.buildingMap);
      } else {
        const processor = {
          doorState: processDoorStateData,
          liftState: processLiftStateData
        }[subscriptionType];
        
        if (processor) {
          // For door and lift states, process all stored messages
          if (subscriptionType === 'doorState' || subscriptionType === 'liftState') {
            Object.values(this.latestMessages[subscriptionType]).forEach(msg => {
              processor(msg, this.context, this.updateCallback);
            });
          }
        }
      }
      
      this.processedCounters[subscriptionType]++;
      this.processThrottling[subscriptionType].lastProcessed = Date.now();
    }
  }

  // Method to force processing of all stored messages
  forceProcessAllLatest() {
    Object.keys(this.latestMessages).forEach(subscriptionType => {
      this.forceProcessLatest(subscriptionType);
    });
  }

  // Method to manually request building map from service
  async requestBuildingMap() {
    return await this.requestBuildingMapFromService();
  }

  // Method to get service client status
  getServiceClientStatus() {
    const status = {};
    Object.keys(this.serviceClients).forEach(key => {
      status[key] = {
        exists: !!this.serviceClients[key],
        isDestroyed: this.serviceClients[key] ? this.serviceClients[key].isDestroyed() : 'N/A'
      };
    });
    return status;
  }

  // Method to get zone information from nav_graphs
  getZones() {
    return this.context.zones || [];
  }

  // Method to get navigation graphs information
  getNavGraphs() {
    return this.context.navGraphs || [];
  }

  // Method to get zone by name
  getZoneByName(zoneName) {
    const zones = this.getZones();
    return zones.find(zone => zone.name === zoneName);
  }

  // Method to get zones by type
  getZonesByType(zoneType) {
    const zones = this.getZones();
    return zones.filter(zone => zone.type === zoneType);
  }

  // Method to get zones by level
  getZonesByLevel(level) {
    const zones = this.getZones();
    return zones.filter(zone => zone.level === level);
  }
  
  // Location accessor methods
  getLocations() {
    return this.context.locations || [];
  }
  
  getLocationByName(locationName) {
    const locations = this.getLocations();
    return locations.find(location => location.name === locationName);
  }
  
  getLocationsByType(locationType) {
    const locations = this.getLocations();
    return locations.filter(location => location.type === locationType);
  }
  
  getLocationsByLevel(level) {
    const locations = this.getLocations();
    return locations.filter(location => location.level_name === level);
  }
  
  getChargerLocations() {
    const locations = this.getLocations();
    return locations.filter(location => location.is_charger === true);
  }
  
  getParkingLocations() {
    const locations = this.getLocations();
    return locations.filter(location => location.is_parking_spot === true);
  }
}

module.exports = RMFSubscriptions;
