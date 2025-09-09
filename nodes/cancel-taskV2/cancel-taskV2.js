module.exports = function (RED) {
  const rmfContextManager = require('../lib/rmfContextManager');
  const rmfEvents = rmfContextManager.rmfEvents;
  const { validateRobotAndFleet, handleValidationResult } = require('../lib/rmfValidation');
  const { cancelRMFTask } = require('../lib/rmfTaskManager');

  function CancelTaskV2Node(config) {
    RED.nodes.createNode(this, config);
    const node = this;

    node.robot_name = config.robot_name;
    node.robot_fleet = config.robot_fleet;
    node.task_id = config.task_id;

    // Get reference to rmf-config
    node.configNode = RED.nodes.getNode(config.config);

    // Simple function to set node status
    function setStatus(fill, shape, text) {
      console.log(`[CANCEL-TASKV2] Setting node status: ${text}`);
      node.status({ fill: fill, shape: shape, text: text });
    }
    
    // Initialize with waiting status
    setStatus('yellow', 'ring', 'Waiting for RMF config...');
    
    function updateRMFStatus() {
      try {
        if (!rmfContextManager || !rmfContextManager.context) {
          setStatus('red', 'ring', 'RMF context unavailable');
          return;
        }
        
        const socket = rmfContextManager.context.socket;
        if (!socket || !socket.connected) {
          setStatus('red', 'ring', 'RMF connection failed');
          return;
        }
        
        // All good - socket connected
        setStatus('green', 'dot', 'Ready');
      } catch (error) {
        console.error('[CANCEL-TASKV2] Error in updateRMFStatus:', error);
        setStatus('red', 'ring', 'RMF error');
      }
    }

    // Wait for RMF config to be ready
    let rmfConfigReady = false;
    if (node.configNode) {
      node.configNode.on('rmf-ready', (readyInfo) => {
        console.log('[CANCEL-TASKV2] RMF config ready, checking connection...');
        rmfConfigReady = true;
        setStatus('yellow', 'ring', 'Connecting to RMF...');
        // Small delay to allow RMF context to fully initialize
        setTimeout(updateRMFStatus, 1000);
      });
    }

    // Listen for RMF context events - but only after config is ready
    function onReady() {
      if (rmfConfigReady) updateRMFStatus();
    }
    function onSocketConnected() {
      if (rmfConfigReady) updateRMFStatus();
    }
    function onSocketDisconnected() {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF disconnected');
    }
    function onCleanedUp() {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF cleaned up');
    }
    function onError(err) {
      if (rmfConfigReady) setStatus('red', 'ring', 'RMF error: ' + (err && err.message ? err.message : 'unknown'));
    }

    rmfEvents.on('ready', onReady);
    rmfEvents.on('socket_connected', onSocketConnected);
    rmfEvents.on('socket_disconnected', onSocketDisconnected);
    rmfEvents.on('cleanedUp', onCleanedUp);
    rmfEvents.on('error', onError);

    // Clear listeners on close
    node.on('close', async (removed, done) => {
      rmfEvents.off('ready', onReady);
      rmfEvents.off('socket_connected', onSocketConnected);
      rmfEvents.off('socket_disconnected', onSocketDisconnected);
      rmfEvents.off('cleanedUp', onCleanedUp);
      rmfEvents.off('error', onError);
      if (done) done();
    });

    node.on('input', async (msg, send, done) => {
      try {
        // Check RMF connection
        if (!rmfContextManager.context.socket || !rmfContextManager.context.socket.connected) {
          setStatus('yellow', 'ring', 'Waiting for RMF connection');
          msg.payload = { 
            status: 'waiting', 
            reason: 'RMF socket not connected yet' 
          };
          send([null, msg]); // Send to failed output
          return done();
        }

        // Get configuration values (prefer message properties, then node config)
        let robotName = msg.rmf_robot_name || msg.robot_name || node.robot_name;
        let robotFleet = msg.rmf_robot_fleet || msg.robot_fleet || node.robot_fleet;
        let taskId = msg.task_id || node.task_id;

        // Validation logic based on requirements
        if (!taskId && !robotName) {
          setStatus('red', 'ring', 'Missing required parameters');
          msg.payload = { 
            status: 'failed', 
            reason: 'Either task_id or robot_name must be provided' 
          };
          send([null, msg]);
          return done();
        }

        // If we have robot name but no fleet, try to get fleet from robot data
        if (robotName && !robotFleet) {
          const rmfData = rmfContextManager.getRMFData();
          if (rmfData && rmfData.robots) {
            const robot = rmfData.robots.find(r => r.name === robotName);
            if (robot) {
              robotFleet = robot.fleet;
              console.log(`[CANCEL-TASKV2] Auto-detected fleet ${robotFleet} for robot ${robotName}`);
            }
          }
        }

        // If we have robot name and fleet but no task_id, get task_id from robot context
        if (robotName && robotFleet && !taskId) {
          const robotContext = rmfContextManager.getRobotContext(robotName, robotFleet);
          if (robotContext && robotContext.task_id) {
            taskId = robotContext.task_id;
            console.log(`[CANCEL-TASKV2] Found active task ${taskId} for robot ${robotName} from robot context`);
          } else {
            setStatus('red', 'ring', 'No active task found');
            msg.payload = { 
              status: 'failed', 
              reason: `No active task found for robot ${robotName} in fleet ${robotFleet}` 
            };
            send([null, msg]);
            return done();
          }
        }

        // Validate we have a task_id at this point
        if (!taskId) {
          setStatus('red', 'ring', 'No task ID available');
          msg.payload = { 
            status: 'failed', 
            reason: 'Could not determine task_id to cancel' 
          };
          send([null, msg]);
          return done();
        }

        setStatus('blue', 'dot', 'Cancelling task');

        // Cancel the task using rmfTaskManager
        const cancelResult = await cancelRMFTask(taskId, node.configNode);
        
        if (cancelResult.success) {
          setStatus('green', 'dot', 'Task cancelled');
          msg.payload = {
            status: 'cancelled',
            task_id: taskId,
            robot_name: robotName,
            robot_fleet: robotFleet,
            timestamp: new Date().toISOString()
          };
          send([msg, null]); // Send to success output
        } else {
          setStatus('red', 'ring', 'Cancel failed');
          msg.payload = {
            status: 'failed',
            task_id: taskId,
            reason: cancelResult.error,
            timestamp: new Date().toISOString()
          };
          send([null, msg]); // Send to failed output
        }
        
        done();

      } catch (error) {
        setStatus('red', 'ring', 'Cancel error');
        msg.payload = { 
          status: 'error', 
          reason: error.message 
        };
        send([null, msg]);
        done(error);
      }
    });
  }

  RED.nodes.registerType('cancel-taskV2', CancelTaskV2Node, {
    outputs: 2  // Success, Failed
  });
};
