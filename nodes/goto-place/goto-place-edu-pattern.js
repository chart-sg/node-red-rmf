const { ActionClient } = require("rclnodejs");
const { Ros2Instance } = require("../lib/rmf-ros2-instance");

module.exports = function(RED) {
    function GotoPlaceNode(config) {
        RED.nodes.createNode(this, config);
        
        const node = this;
        node.ready = false;
        node.action_client = null;
        node.future_action_result = null;
        
        // Get RMF config
        const rmfConfig = RED.nodes.getNode(config.rmfConfig);
        if (!rmfConfig) {
            node.error("RMF configuration not found");
            return;
        }
        
        // Get fleet name from config
        const fleetName = rmfConfig.fleet_name || "tinyRobot";
        
        // Initialize based on configuration
        if (config.robot_name && config.waypoint) {
            // Static configuration - create action client on deploy
            try {
                console.log("Creating action client for static configuration...");
                const topic = `/rmf/dynamic_event/command/${fleetName}/${config.robot_name}`;
                
                node.action_client = new ActionClient(
                    Ros2Instance.instance().node,
                    'rmf_task_msgs/action/DynamicEvent',
                    topic
                );
                
                node.ready = true;
                node.status({ fill: "yellow", shape: "dot", text: "created" });
                console.log("Action client created successfully");
            } catch (error) {
                console.error("Error creating action client:", error);
                node.ready = false;
                node.status({ fill: "red", shape: "dot", text: "error" });
            }
        } else {
            // Dynamic configuration - await input
            console.log("Dynamic configuration - await input");
            node.ready = false;
            node.status({ fill: "green", shape: "dot", text: "await action" });
        }
        
        // Event emitted when the deploy is finished
        RED.events.once('flows:started', function () {
            if (node.ready) {
                node.status({ fill: "green", shape: "dot", text: "waiting for command" });
            }
        });
        
        // Handle input messages
        node.on('input', function(msg) {
            // Determine robot name and waypoint
            const robot_name = msg.robot_name || config.robot_name;
            const waypoint = msg.waypoint || config.waypoint;
            
            if (!robot_name || !waypoint) {
                node.status({ fill: "red", shape: "dot", text: "missing robot_name or waypoint" });
                return;
            }
            
            const topic = `/rmf/dynamic_event/command/${fleetName}/${robot_name}`;
            
            try {
                // Destroy existing action client if it exists
                if (node.action_client) {
                    node.action_client.destroy();
                    node.action_client = null;
                    console.log("Previous action client destroyed");
                }
                
                // Create new action client with the determined topic
                console.log(`Creating action client with topic: ${topic}`);
                node.action_client = new ActionClient(
                    Ros2Instance.instance().node,
                    'rmf_task_msgs/action/DynamicEvent',
                    topic
                );
                
                // Check if the action server is available
                if (!node.action_client.isActionServerAvailable()) {
                    node.status({ fill: "yellow", shape: "dot", text: "action server not available" });
                    return;
                }
                
                node.ready = true;
                node.status({ fill: "green", shape: "dot", text: `ready on topic: ${topic}` });
                
                // Create the goal
                const goal = {
                    event_type: 1, // GO_TO_PLACE
                    category: 'go_to_place',
                    description: JSON.stringify({ waypoint: waypoint }),
                    dynamic_event_seq: Math.floor(Date.now() / 1000) % 4294967295, // Convert to seconds and keep within uint32 range
                    stubborn_period: 0
                };
                
                // Perform the action
                console.log("Starting to perform action");
                node.future_action_result = performingAction(node, goal);
                
            } catch (error) {
                console.error("Error creating action client or performing action:", error);
                node.status({ fill: "red", shape: "dot", text: "error creating action client" });
                node.ready = false;
            }
        });
        
        // Called when there is a re-deploy or the program is closed
        node.on('close', function() {
            if (node.action_client) {
                node.action_client.destroy();
                node.action_client = null;
            }
            node.status({ fill: null, shape: null, text: "" });
        });
    }
    
    // Performing action - exact copy of edu-nodered pattern
    async function performingAction(node, goal_request) {
        console.log("Try to send goal_request:");
        console.log(goal_request);
        
        try {
            // Send goal with feedback callback
            const goal_handle_promise = node.action_client.sendGoal(goal_request, function (feedback) {
                // Send feedback to second output
                node.status({ fill: "green", shape: "dot", text: "action is processing" });
                node.send([null, { payload: feedback }]);
            });
            
            node.status({ fill: "green", shape: "dot", text: "goal request published" });
            const goal_handle = await goal_handle_promise;
            
            if (goal_handle.isAccepted() == false) {
                node.status({ fill: "red", shape: "dot", text: "goal request rejected" });
                const result = await goal_handle.getResult();
                node.send([{ payload: result }, null]);
                return;
            }
            
            console.log("Action goal was accepted");
            const result = await goal_handle.getResult();
            console.log("Received action result");
            
            if (goal_handle.isSucceeded() == false) {
                node.status({ fill: "red", shape: "dot", text: "goal failed" });
                node.send([{ payload: result }, null]);
                return;
            }
            
            node.status({ fill: "green", shape: "dot", text: "result received" });
            node.send([{ payload: result }, null]);
            
        } catch (error) {
            console.error("Sending goal request failed. Error:", error);
            node.status({ fill: "red", shape: "dot", text: "sending goal request failed" });
        }
    }
    
    RED.nodes.registerType("goto-place", GotoPlaceNode);
};
