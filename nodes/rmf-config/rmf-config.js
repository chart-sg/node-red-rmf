module.exports = function (RED) {
  const {
    initROS2,
    connectSocket,
    setGlobalContext,
    cleanup,
    softCleanup
  } = require('../lib/rmfContextManager');
  // Bridge-based shared manager is now handled internally

  function RmfConfigNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name;
    this.host = config.host;
    this.port = config.port;
    this.jwt = config.jwt;
    this.rosDomain = config.rosDomain; // Default RMF to domain 42
    this.initializationDelay = parseInt(config.initializationDelay) || 0; // No delay needed with shared manager
    this.maxRetries = parseInt(config.maxRetries) || 3;

    console.log(`RMF Config: Using ROS domain ID ${this.rosDomain} with shared manager`);

    // Initialize ROS2 using shared manager
    (async () => {
      try {
        this.status({ fill: 'yellow', shape: 'dot', text: 'initializing...' });
        
        console.log('RMF Config: Starting RMF initialization with shared ROS2 manager...');
        
        // Initialize using shared manager - this is safe and conflict-free
        await initROS2({
          domainId: this.rosDomain,
          args: []
        });
        
        this.status({ fill: 'yellow', shape: 'dot', text: 'connecting socket...' });
        
        // Socket connection is required for task status updates
        await connectSocket({ host: this.host, port: this.port, jwt: this.jwt });
        setGlobalContext(this.context().global);
        
        this.status({ fill: 'green', shape: 'dot', text: 'connected' });
        console.log('RMF Config: Initialization completed successfully with shared manager');
        
      } catch (err) {
        console.error('RMF Config: Initialization failed:', err.message);
        this.status({ fill: 'red', shape: 'ring', text: 'initialization failed' });
        this.error('RMF Config Error: ' + err.message);
      }
    })();

    // Cleanup on node close with proper shutdown pattern
    this.on('close', async (removed, done) => {
      try {
        console.log('RMF Config node closing...');
        
        if (removed) {
          console.log('RMF Config: Node removed - performing full cleanup...');
          // Full cleanup when node is actually removed (not just redeployed)
          setTimeout(async () => {
            try {
              await cleanup();
              console.log('RMF Config: Full cleanup completed');
            } catch (error) {
              console.error('RMF Config: Error during full cleanup:', error);
            }
          }, 100);
        } else {
          console.log('RMF Config: Redeployment detected - preserving shared manager...');
          // During redeployment, don't destroy shared manager
          // Just clean up local references
          setTimeout(async () => {
            try {
              await softCleanup();
              console.log('RMF Config: Soft cleanup completed (shared manager preserved)');
            } catch (error) {
              console.error('RMF Config: Error during soft cleanup:', error);
            }
          }, 100);
        }
        
        if (done) done();
        
      } catch (err) {
        console.error('RMF Config: Error during node close:', err);
        if (done) done(err);
      }
    });
  }

  RED.nodes.registerType('rmf-config', RmfConfigNode);
  
  // Central API endpoint for all RMF nodes to get robot/location data
  RED.httpAdmin.get('/rmf/data', RED.auth.needsPermission('read'), function(req, res) {
    try {
      const rmfContextManager = require('../lib/rmfContextManager');
      
      // Get data directly from rmfContextManager
      let rmfData = rmfContextManager.getRMFData();
      
      // If no data available, try to force refresh
      if (!rmfData || (rmfData.robots.length === 0 && rmfData.locations.length === 0)) {
        // Try to force-refresh the data
        rmfContextManager.forceProcessAllLatest();
        
        // Re-check after forcing refresh
        rmfData = rmfContextManager.getRMFData();
      }
      
      // Check if RMF context is initialized and has data
      if (!rmfData) {
        return res.json({
          robots: [],
          locations: [],
          fleets: [],
          lastUpdated: {},
          status: 'not_initialized',
          message: 'RMF context not initialized'
        });
      }
      
      // Extract unique fleets from robots
      const fleets = [...new Set(rmfData.robots.map(robot => robot.fleet))];
      
      // Prepare response data
      const responseData = {
        robots: rmfData.robots.map(robot => ({
          name: robot.name,
          fleet: robot.fleet,
          battery: robot.battery_percent,
          status: robot.status
        })),
        locations: rmfData.locations.map(location => ({
          name: location.name,
          level: location.level,
          x: location.x,
          y: location.y
        })),
        fleets: fleets,
        lastUpdated: rmfData.lastUpdated,
        status: 'ready',
        message: 'RMF data available'
      };
      
      res.json(responseData);
    } catch (error) {
      console.error('Error fetching RMF data:', error);
      res.status(500).json({ 
        error: 'Failed to fetch RMF data',
        robots: [],
        locations: [],
        fleets: [],
        lastUpdated: {},
        status: 'error',
        message: error.message
      });
    }
  });
};
