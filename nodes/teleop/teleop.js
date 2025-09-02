const rmfContextManager = require('../lib/rmfContextManager');

// RED argument provides the module access to Node-RED runtime api
module.exports = function(RED) {
    function TeleopNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;
        
        // Get RMF config
        node.configNode = RED.nodes.getNode(config.config);
        
        if (!node.configNode) {
            node.status({ fill: "red", shape: "dot", text: "RMF Config not found" });
            return;
        }

        // Simple function to set node status
        function setStatus(fill, shape, text) {
            console.log(`[TELEOP] Setting node status: ${text}`);
            node.status({ fill: fill, shape: shape, text: text });
        }

        // Set initial status
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
                } else {
                    setStatus('green', 'dot', 'Ready');
                }
            } catch (error) {
                console.error('[TELEOP] Error in updateRMFStatus:', error);
                setStatus('red', 'ring', 'RMF error');
            }
        }

        // Wait for RMF config to be ready
        let rmfConfigReady = false;
        if (node.configNode) {
            node.configNode.on('rmf-ready', (readyInfo) => {
                console.log('[TELEOP] RMF config ready, checking connection...');
                rmfConfigReady = true;
                setStatus('yellow', 'ring', 'Connecting to RMF...');
                // Small delay to allow RMF context to fully initialize
                setTimeout(updateRMFStatus, 1000);
            });
        }

        // Listen for RMF context events - but only after config is ready
        const rmfEvents = rmfContextManager.rmfEvents;
        function onReady() {
            if (rmfConfigReady) updateRMFStatus();
        }
        function onSocketConnected() {
            if (rmfConfigReady) updateRMFStatus();
        }
        function onSocketDisconnected() {
            setStatus('red', 'ring', 'RMF disconnected');
        }
        function onCleanedUp() {
            setStatus('red', 'ring', 'RMF cleaned up');
        }
        function onError(err) {
            setStatus('red', 'ring', 'RMF error: ' + (err && err.message ? err.message : 'unknown'));
        }

        rmfEvents.on('ready', onReady);
        rmfEvents.on('socket_connected', onSocketConnected);
        rmfEvents.on('socket_disconnected', onSocketDisconnected);
        rmfEvents.on('cleanedUp', onCleanedUp);
        rmfEvents.on('error', onError);

        // Input handler
        node.on('input', async function(msg) {
            try {
                // Debug logging to see what's in the message
                console.log('[TELEOP] Received message:', JSON.stringify(msg, null, 2));
                console.log('[TELEOP] Message keys:', Object.keys(msg));
                
                // Extract robot information (prefer RMF metadata, fallback to direct properties)
                const robotName = msg._rmf_robot_name || msg.rmf_robot_name || msg.robot_name || config.robot_name;
                const robotFleet = msg._rmf_robot_fleet || msg.rmf_robot_fleet || msg.robot_fleet || config.robot_fleet;
                const taskId = msg._rmf_task_id || msg.rmf_task_id || msg.task_id;
                const dynamicEventSeq = msg._rmf_dynamic_event_seq || msg.rmf_dynamic_event_seq || msg.dynamic_event_seq || 
                                      (msg.payload && msg.payload.dynamic_event_seq);

                // Debug the extracted values
                console.log('[TELEOP] Extracted values:');
                console.log(`  robotName: ${robotName}`);
                console.log(`  robotFleet: ${robotFleet}`);
                console.log(`  taskId: ${taskId}`);
                console.log(`  dynamicEventSeq: ${dynamicEventSeq}`);

                // Extract teleop parameters
                const teleopDescription = msg.teleop_description || config.teleop_description || "";
                const teleopDuration = msg.teleop_duration || config.teleop_duration;

                // Validation
                if (!robotName || !robotFleet) {
                    console.log('[TELEOP] Validation failed: Missing robot name or fleet');
                    console.log(`  robotName: "${robotName}", robotFleet: "${robotFleet}"`);
                    node.status({ fill: "red", shape: "dot", text: "Missing robot name or fleet" });
                    node.send([null, { 
                        payload: { 
                            status: "error", 
                            reason: "Robot name and fleet are required. Pass via RMF metadata or configure in node." 
                        } 
                    }]);
                    return;
                }

                if (!taskId || dynamicEventSeq === undefined) {
                    console.log('[TELEOP] Validation failed: Missing task context');
                    console.log(`  taskId: "${taskId}", dynamicEventSeq: ${dynamicEventSeq}`);
                    node.status({ fill: "red", shape: "dot", text: "Missing task context" });
                    node.send([null, { 
                        payload: { 
                            status: "error", 
                            reason: "Task ID and dynamic event sequence required. Connect after start-task node." 
                        } 
                    }]);
                    return;
                }

                node.status({ fill: "blue", shape: "dot", text: "Starting teleop..." });

                // Prepare teleop description object
                let teleopDescObj = {
                    description: teleopDescription
                };

                // Add duration if specified
                if (teleopDuration && teleopDuration > 0) {
                    teleopDescObj.duration = teleopDuration;
                }

                // Prepare dynamic event data
                const dynamicEventData = {
                    robot_name: robotName,
                    robot_fleet: robotFleet,
                    task_id: taskId,
                    dynamic_event_seq: dynamicEventSeq,
                    event_type: 1, // New request
                    category: 'perform_action',
                    description: JSON.stringify({
                        category: 'teleop',
                        description: teleopDescObj
                    })
                };

                // Set up goal callbacks
                const goalCallbacks = {
                    onCompletion: (result) => {
                        if (result.success) {
                            node.status({ fill: "green", shape: "dot", text: "Teleop completed" });
                            // Pass through RMF metadata
                            const successMsg = Object.assign({}, msg, {
                                payload: {
                                    status: "completed",
                                    action: "teleop",
                                    teleop_description: teleopDescription,
                                    teleop_duration: teleopDuration,
                                    robot_name: robotName,
                                    robot_fleet: robotFleet,
                                    task_id: taskId,
                                    dynamic_event_seq: dynamicEventSeq,
                                    timestamp: new Date().toISOString()
                                }
                            });
                            node.send([successMsg, null]);
                        } else {
                            node.status({ fill: "red", shape: "dot", text: "Teleop failed" });
                            node.send([null, { 
                                payload: { 
                                    status: "failed", 
                                    reason: result.message || "Unknown error",
                                    action: "teleop",
                                    robot_name: robotName,
                                    robot_fleet: robotFleet
                                } 
                            }]);
                        }
                    },
                    onFeedback: (feedback) => {
                        // Update status based on feedback
                        if (feedback && feedback.status) {
                            node.status({ fill: "blue", shape: "dot", text: `Teleop: ${feedback.status}` });
                        }
                    }
                };

                // Send dynamic event goal
                const actionResult = await rmfContextManager.sendDynamicEventGoal(dynamicEventData, goalCallbacks);

                if (!actionResult.success) {
                    node.status({ fill: "red", shape: "dot", text: "Failed to start teleop" });
                    node.send([null, { 
                        payload: { 
                            status: "error", 
                            reason: actionResult.message || "Failed to send teleop goal",
                            action: "teleop"
                        } 
                    }]);
                }

            } catch (error) {
                console.error('[TELEOP] Error processing request:', error);
                node.status({ fill: "red", shape: "dot", text: "Error: " + error.message });
                node.send([null, { 
                    payload: { 
                        status: "error", 
                        reason: error.message,
                        action: "teleop"
                    } 
                }]);
            }
        });

        // Cleanup on close
        node.on('close', function(removed, done) {
            rmfEvents.off('ready', onReady);
            rmfEvents.off('socket_connected', onSocketConnected);
            rmfEvents.off('socket_disconnected', onSocketDisconnected);
            rmfEvents.off('cleanedUp', onCleanedUp);
            rmfEvents.off('error', onError);
            node.status({});
            if (done) done();
        });
    }

    RED.nodes.registerType("teleop", TeleopNode);
};
