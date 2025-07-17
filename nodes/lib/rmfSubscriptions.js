// File: nodes/lib/rmfSubscriptions.js
const { processBuildingMapData, processFleetStateData, processDoorStateData, processLiftStateData } = require('./rmfDataProcessors');

class RMFSubscriptions {
  constructor(rosNode, context, updateCallback) {
    this.rosNode = rosNode;
    this.context = context;
    this.updateCallback = updateCallback;
    this.subscribers = {};
    this.serviceClients = {};
    
    // Data processing throttling - limit how often we actually process the data
    this.processThrottling = {
      buildingMap: { lastProcessed: 0, interval: 5000 },  // Process every 5 seconds (reduced from 30s for debugging)
      fleetState: { lastProcessed: 0, interval: 1000 },   // Process every 1 second (robot positions)
      doorState: { lastProcessed: 0, interval: 1000 },    // Process every 1 second (reduced from 5s for debugging)
      liftState: { lastProcessed: 0, interval: 1000 }     // Process every 1 second (reduced from 5s for debugging)
    };
    
    // Store latest messages for each type (so we don't lose the most recent data)
    this.latestMessages = {
      buildingMap: null,
      fleetState: {},  // Store by fleet name
      doorState: {},   // Store by door name
      liftState: {}    // Store by lift name
    };
    
    // Message counters for monitoring
    this.messageCounters = {
      buildingMap: 0,
      fleetState: 0,
      doorState: 0,
      liftState: 0,
      dynamicEvent: 0
    };
    
    // Processed message counters
    this.processedCounters = {
      buildingMap: 0,
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

      // Setup service clients first
      await this.setupServiceClients();

      // Then setup topic subscriptions (excluding nav_graphs/buildingMap)
      await this.setupFleetStateSubscription();
      await this.setupDoorStateSubscription();
      await this.setupLiftStateSubscription();
      // Setup dynamic event subscription to capture dynamic_event_seq
      await this.setupDynamicEventSubscription();

      // Always use service for building map/locations
      console.log('RMF: Requesting building map from service (topic subscription removed)...');
      await this.requestBuildingMapFromService();

      console.log('RMF: All RMF subscriptions setup successfully (using service for building map)');

    } catch (error) {
      console.error('RMF: Failed to setup subscriptions:', error.message);
    }
  }

  async setupServiceClients() {
    try {
      console.log('RMF: Setting up service clients...');
      
      // Setup building map service client
      const rclnodejs = require('rclnodejs');
      
      this.serviceClients.buildingMap = this.rosNode.createClient(
        'rmf_building_map_msgs/srv/GetBuildingMap',
        '/get_building_map'
      );
      
      console.log('RMF: Building map service client created');
      
    } catch (error) {
      console.error('RMF: Failed to create service clients:', error.message);
    }
  }

  async requestBuildingMapFromService() {
    try {
      console.log('RMF: Requesting building map from service using SafeServiceClient...');
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
        // Process the building map data
        const { processBuildingMapFromService } = require('./rmfDataProcessors');
        processBuildingMapFromService(response.building_map, this.context, this.updateCallback);
        return true;
      } else {
        console.error('RMF: Invalid response from building map service');
        return false;
      }
    } catch (error) {
      console.error('RMF: Failed to request building map from service:', error.message);
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
      console.log('RMF: Dynamic event begin received:', eventData);
      
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
        
        console.log(`RMF: Updated robot ${robot} (${fleet}) with dynamic_event_seq: ${dynamic_event_seq}`);
        
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
        
        // Trigger context update
        if (this.updateCallback) {
          this.updateCallback();
        }
      } else {
        console.warn(`RMF: Robot ${robot} from fleet ${fleet} not found in context for dynamic event`);
        
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
        
        console.log(`RMF: Created new robot entry for ${robot} (${fleet}) with dynamic_event_seq: ${dynamic_event_seq}`);
        
        // Increment processed counter
        this.processedCounters.dynamicEvent++;
        
        // Trigger context update
        if (this.updateCallback) {
          this.updateCallback();
        }
      }
      
    } catch (error) {
      console.error('RMF: Failed to process dynamic event begin:', error.message);
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
        throttleIntervalMs: throttleConfig.interval,
        lastProcessedTime: throttleConfig.lastProcessed,
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
      } else {
        const processor = {
          buildingMap: processBuildingMapData,
          doorState: processDoorStateData,
          liftState: processLiftStateData
        }[subscriptionType];
        
        if (processor) {
          // For door and lift states, process all stored messages
          if (subscriptionType === 'doorState' || subscriptionType === 'liftState') {
            Object.values(this.latestMessages[subscriptionType]).forEach(msg => {
              processor(msg, this.context, this.updateCallback);
            });
          } else {
            // For building map, process the single message
            processor(this.latestMessages[subscriptionType], this.context, this.updateCallback);
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
}

module.exports = RMFSubscriptions;
