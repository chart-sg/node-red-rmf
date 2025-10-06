const RMFNodeBase = require('../lib/rmf-node-base');

module.exports = function(RED) {
    function TeleopNode(config) {
        RED.nodes.createNode(this, config);
        const node = this;
        
        // Initialize with shared RMF base functionality
        const rmfBase = new RMFNodeBase(RED, config, 'teleop');
        if (!rmfBase.initialize(node)) {
            return; // Failed to initialize
        }

        // Teleop-specific input handler
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

                // Extract teleop-specific parameters
                const teleopDescription = msg.teleop_description || config.teleop_description || "";
                const teleopDuration = msg.teleop_duration || config.teleop_duration;

                // Prepare teleop description object
                let teleopDescObj = { description: teleopDescription };
                if (teleopDuration && teleopDuration > 0) {
                    teleopDescObj.duration = teleopDuration;
                }

                // Prepare event data for teleop
                const eventData = { category: 'teleop', description: teleopDescObj };

                // Prepare success data
                const successData = {
                    status: 'completed',
                    action: 'teleop',
                    teleop_description: teleopDescription,
                    teleop_duration: teleopDuration,
                    rmf_robot_name: params.robotName,
                    rmf_robot_fleet: params.robotFleet,
                    rmf_task_id: params.taskId,
                    rmf_dynamic_event_seq: params.dynamicEventSeq
                };

                // Send goal using base class
                await rmfBase.sendDynamicEventGoal('perform_action', eventData, successData);

            } catch (error) {
                console.error('[TELEOP] Error processing request:', error);
                rmfBase.sendError(error.message);
            }
        });
    }

    RED.nodes.registerType("teleop", TeleopNode);
};
