const RMFNodeBase = require('../lib/rmf-node-base');

module.exports = function(RED) {
    function PerformActionNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize with shared RMF base functionality
        const rmfBase = new RMFNodeBase(RED, config, 'perform-action');
        if (!rmfBase.initialize(node)) {
            return; // Failed to initialize
        }

        // Perform-action specific input handler
        node.on('input', async function(msg) {
            try {
                // Store current message for callbacks
                rmfBase.currentMsg = msg;
                
                // Extract and validate RMF parameters using base class
                const params = rmfBase.extractRMFParameters(msg);
                const validation = rmfBase.validateRMFParameters(params);
                
                if (!validation.valid) {
                    rmfBase.sendError(validation.error);
                    return;
                }

                // Extract perform-action specific parameters
                const actionCategory = msg.action_category || config.action_category;
                const actionDescription = msg.action_description || config.action_description;

                // Validate required action category
                if (!actionCategory) {
                    rmfBase.sendError('Action category is required');
                    return;
                }

                // Prepare action description object
                let actionDescObj = actionDescription || {};
                if (typeof actionDescObj === 'string') {
                    try {
                        actionDescObj = JSON.parse(actionDescObj);
                    } catch (e) {
                        actionDescObj = { description: actionDescObj };
                    }
                }

                // Prepare event data for perform-action
                const eventData = { category: actionCategory, description: actionDescObj };

                // Prepare success data
                const successData = {
                    action_category: actionCategory,
                    action_description: actionDescription,
                    robot_name: params.robotName,
                    robot_fleet: params.robotFleet,
                    task_id: params.taskId,
                    dynamic_event_seq: params.dynamicEventSeq
                };

                // Send goal using base class
                await rmfBase.sendDynamicEventGoal('perform_action', eventData, successData);

            } catch (error) {
                console.error('[PERFORM-ACTION] Error processing request:', error);
                rmfBase.sendError(error.message);
            }
        });
    }

    RED.nodes.registerType("perform-action", PerformActionNode);
};
