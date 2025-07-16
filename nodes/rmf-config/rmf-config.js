module.exports = function (RED) {
  const {
    initROS2,
    connectSocket,
    setGlobalContext,
    cleanup,
    softCleanup
  } = require('../lib/rmfContextManager');

  function RmfConfigNode(config) {
    RED.nodes.createNode(this, config);

    this.name = config.name;
    this.host = config.host;
    this.port = config.port;
    this.jwt = config.jwt;
    this.rosDomain = config.rosDomain;

    // Set ROS domain ID
    process.env.RCLNODEJS_ROS_DOMAIN_ID = this.rosDomain;

    // Initialize edu-pattern ROS2 instance
    const { Ros2Instance } = require('../lib/rmf-ros2-instance');

    // Initialize ROS2 and socket connection
    (async () => {
      try {
        this.status({ fill: 'yellow', shape: 'dot', text: 'connecting...' });
        
        // Initialize edu-pattern ROS2 instance first
        console.log('RMF Config: Initializing edu-pattern ROS2 instance...');
        const ros2Instance = Ros2Instance.instance();
        console.log('RMF Config: Edu-pattern ROS2 instance ready');
        
        // Try ROS2 initialization for rmfContextManager
        await initROS2();
        
        // Socket connection is required for task status updates
        await connectSocket({ host: this.host, port: this.port, jwt: this.jwt });
        setGlobalContext(this.context().global);
        
        this.status({ fill: 'green', shape: 'dot', text: 'connected' });
      } catch (err) {
        this.status({ fill: 'red', shape: 'ring', text: 'connection failed' });
        this.error('RMF Config Error: ' + err.message);
      }
    })();

    // Cleanup on node close with proper shutdown pattern
    this.on('close', async (removed, done) => {
      try {
        console.log('RMF Config node closing...');
        
        // Use soft cleanup during deployment to preserve RMF data
        // Only do full cleanup on actual shutdown
        if (removed) {
          console.log('RMF Config node being removed, triggering full cleanup...');
          
          // Use a timeout to ensure cleanup happens but doesn't block Node-RED
          setTimeout(async () => {
            try {
              await cleanup();
              console.log('Full RMF cleanup completed');
            } catch (error) {
              console.error('Error during full RMF cleanup:', error);
            }
          }, 100);
        } else {
          console.log('RMF Config node being restarted, triggering soft cleanup...');
          
          // Use a timeout to ensure cleanup happens but doesn't block Node-RED
          setTimeout(async () => {
            try {
              await softCleanup();
              console.log('Soft RMF cleanup completed');
            } catch (error) {
              console.error('Error during soft RMF cleanup:', error);
            }
          }, 100);
        }
        
        // Call done immediately to not block Node-RED
        if (done) done();
        
      } catch (err) {
        console.error('Error during RMF Config node close:', err);
        if (done) done(err);
      }
    });
  }

  RED.nodes.registerType('rmf-config', RmfConfigNode);
};
