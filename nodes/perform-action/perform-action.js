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
                
                // For nodes without config, validate global RMF context first
                if (!rmfBase.configNode) {
                    const contextValidation = rmfBase.validateGlobalRMFContext();
                    if (!contextValidation.valid) {
                        msg.payload = { 
                            status: 'failed', 
                            reason: contextValidation.error,
                            error_type: contextValidation.error_type,
                            help: contextValidation.help
                        };
                        node.send([null, msg, null]);
                        return;
                    }
                }
                
                // Extract and validate RMF parameters using base class
                const params = rmfBase.extractRMFParameters(msg);
                const validation = rmfBase.validateRMFParameters(params);
                
                if (!validation.valid) {
                    rmfBase.sendError(validation.error);
                    return;
                }

                // Helper function to get meaningful value (not empty, undefined, null, 'all', or 'auto')
                function getMeaningfulValue(...values) {
                    for (const value of values) {
                        if (value && value !== '' && value !== 'all' && value !== 'auto') {
                            return value;
                        }
                    }
                    return undefined;
                }

                // Extract perform-action specific parameters
                const actionCategory = getMeaningfulValue(msg.action_category, config.action_category);
                const actionDescription = getMeaningfulValue(msg.action_description, config.action_description);

                // Validate required action category
                if (!actionCategory) {
                    rmfBase.sendError('Missing action category', 'Action category is required for perform-action');
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
                    status: 'completed',
                    action: 'perform-action',
                    action_category: actionCategory,
                    action_description: actionDescription,
                    rmf_robot_name: params.robotName,
                    rmf_robot_fleet: params.robotFleet,
                    rmf_task_id: params.taskId,
                    rmf_dynamic_event_seq: params.dynamicEventSeq
                };

                // Send goal using base class
                await rmfBase.sendDynamicEventGoal('perform_action', eventData, successData);

            } catch (error) {
                console.error('[PERFORM-ACTION] Error processing request:', error);
                rmfBase.sendError('Error', error.message);
            }
        });
    }

    RED.nodes.registerType("perform-action", PerformActionNode, {
        outputs: 3  // Success, Failed, Status
    });
};
