const fs = require('fs');
const path = require('path');

function formatNestedSubflowJson(rawData) {
    // Check if it's already in the correct format
    if (rawData.type === 'subflow' && rawData.flow) {
        console.log('✅ JSON already in correct format');
        return { formattedSubflow: rawData, connectionMap: null };
    }
    
    // Handle raw export format (array of nodes)
    if (Array.isArray(rawData)) {
        console.log('🔄 Converting nested subflow export format...');
        
        // Find all subflow definitions
        const subflowDefinitions = rawData.filter(node => node.type === 'subflow');
        
        if (subflowDefinitions.length === 0) {
            throw new Error('Could not find any subflow definition in exported JSON');
        }
        
        console.log(`📊 Found ${subflowDefinitions.length} subflow definition(s)`);
        
        // Find regular nodes (not subflow definitions)
        const regularNodes = rawData.filter(node => node.type !== 'subflow');
        
        // Identify the main subflow - it's the one that has nodes referencing other subflows
        let mainSubflow = null;
        
        if (subflowDefinitions.length === 1) {
            // Only one subflow, it must be the main one
            mainSubflow = subflowDefinitions[0];
        } else {
            // Multiple subflows - find the one that contains subflow instances
            mainSubflow = subflowDefinitions.find(subflow => {
                // Check if any regular nodes belong to this subflow AND reference other subflows
                const belongingNodes = regularNodes.filter(node => node.z === subflow.id);
                const hasSubflowInstances = belongingNodes.some(node => node.type && node.type.startsWith('subflow:'));
                return hasSubflowInstances;
            });
            
            // If no subflow contains instances, take the last one (typical export pattern)
            if (!mainSubflow) {
                mainSubflow = subflowDefinitions[subflowDefinitions.length - 1];
                console.log('⚠️  No subflow instances found, taking last subflow as main');
            }
        }
        
        console.log(`🎯 Main subflow identified: "${mainSubflow.name}" (${mainSubflow.id})`);
        
        // Get nested subflow definitions (all except the main one)
        const nestedSubflows = subflowDefinitions.filter(sf => sf.id !== mainSubflow.id);
        
        // Get nodes that belong to the main subflow
        const mainSubflowNodes = regularNodes.filter(node => node.z === mainSubflow.id);
        
        // Get any orphaned nodes (nodes without a parent subflow)
        const orphanedNodes = regularNodes.filter(node => !node.z || !subflowDefinitions.find(sf => sf.id === node.z));
        
        // Flatten nested subflows by replacing subflow instances with their actual nodes
        const flattenedNodes = [];
        
        // Process each main subflow node
        for (const node of mainSubflowNodes) {
            if (node.type && node.type.startsWith('subflow:')) {
                // This is a subflow instance - replace it with the nested subflow's nodes
                const nestedSubflowId = node.type.replace('subflow:', '');
                const nestedSubflow = nestedSubflows.find(sf => sf.id === nestedSubflowId);
                
                if (nestedSubflow) {
                    console.log(`🔄 Flattening subflow instance: ${node.id} -> ${nestedSubflow.name}`);
                    
                    // Find nodes that belong to this nested subflow
                    const nestedNodes = rawData.filter(n => n.z === nestedSubflowId && n.type !== 'subflow');
                    
                    // Create flattened versions of nested nodes with updated IDs and positions
                    for (let i = 0; i < nestedNodes.length; i++) {
                        const nestedNode = nestedNodes[i];
                        const flattenedNode = {
                            ...nestedNode,
                            id: `${node.id}-nested-${i}`, // New unique ID
                            z: mainSubflow.id, // Belongs to main subflow now
                            x: (node.x || 0) + (nestedNode.x || 0) - 140, // Adjust position relative to instance
                            y: (node.y || 0) + (nestedNode.y || 0) - 60
                        };
                        flattenedNodes.push(flattenedNode);
                    }
                    
                    // Store connection info for later processing
                    if (nestedNodes.length > 0) {
                        // We'll handle connections later after all nodes are processed
                        const firstFlattenedId = `${node.id}-nested-0`;
                        flattenedNodes.connectionMap = flattenedNodes.connectionMap || [];
                        flattenedNodes.connectionMap.push({
                            originalId: node.id,
                            replacementId: firstFlattenedId
                        });
                    }
                } else {
                    console.log(`⚠️  Nested subflow ${nestedSubflowId} not found, keeping instance`);
                    flattenedNodes.push(node);
                }
            } else {
                // Regular node, keep as-is
                flattenedNodes.push(node);
            }
        }
        
        // Add orphaned nodes
        flattenedNodes.push(...orphanedNodes);
        
        // Fix connections after all nodes are processed
        if (flattenedNodes.connectionMap) {
            console.log(`🔗 Updating ${flattenedNodes.connectionMap.length} connection(s)`);
            flattenedNodes.forEach(node => {
                if (node.wires) {
                    node.wires = node.wires.map(wireArray =>
                        wireArray ? wireArray.map(wire => {
                            const mapping = flattenedNodes.connectionMap.find(m => m.originalId === wire);
                            return mapping ? mapping.replacementId : wire;
                        }) : wireArray
                    );
                }
            });
        }
        
        // Store connection map for later use and clean up
        const connectionMap = flattenedNodes.connectionMap;
        if (flattenedNodes.connectionMap) {
            delete flattenedNodes.connectionMap;
        }
        
        console.log(`📊 Nested subflows: ${nestedSubflows.length} (flattened)`);
        console.log(`📊 Main subflow nodes: ${mainSubflowNodes.length}`);
        console.log(`📊 Flattened nodes: ${flattenedNodes.length}`);
        console.log(`📊 Orphaned nodes: ${orphanedNodes.length}`);
        
        // Create the properly formatted subflow
        const formattedSubflow = {
            ...mainSubflow,
            flow: flattenedNodes
        };
        
        console.log('✅ Converted nested subflow export to proper format');
        return { formattedSubflow, connectionMap };
    }
    
    // Handle single subflow definition without flow property
    if (rawData.type === 'subflow' && !rawData.flow) {
        console.log('⚠️  Single subflow without flow property - adding empty flow');
        return {
            formattedSubflow: {
                ...rawData,
                flow: []
            },
            connectionMap: null
        };
    }
    
    throw new Error('Unknown JSON format - expected array or subflow object');
}

function addNestedSubflow(name, subflowJsonPath) {
    const kebabName = name.toLowerCase().replace(/\s+/g, '-');
    const nodesDir = path.join(__dirname, '..', 'nodes');
    
    // Ensure nodes directory exists
    if (!fs.existsSync(nodesDir)) {
        fs.mkdirSync(nodesDir, { recursive: true });
    }
    
    try {
        // Read and parse the raw JSON
        const rawJsonContent = fs.readFileSync(subflowJsonPath, 'utf8');
        const rawData = JSON.parse(rawJsonContent);
        
        // Format the subflow JSON
        const result = formatNestedSubflowJson(rawData);
        const formattedSubflow = result.formattedSubflow || result; // Handle both new and old format
        const connectionMap = result.connectionMap;
        
        // Generate a unique ID for this subflow to avoid conflicts
        const originalId = formattedSubflow.id;
        const uniqueId = kebabName + '-' + Math.random().toString(36).substr(2, 10);
        
        // Update the subflow with unique ID, name, and category
        formattedSubflow.id = uniqueId;
        formattedSubflow.name = name;
        formattedSubflow.category = "CHART RMF";
        
        // Update all references to the old main subflow ID with the new unique ID
        if (formattedSubflow.out) {
            formattedSubflow.out = formattedSubflow.out.map(output => ({
                ...output,
                wires: output.wires ? output.wires.map(wire => {
                    let wireId = wire.id === originalId ? uniqueId : wire.id;
                    // Also check if this wire references a flattened subflow instance
                    if (connectionMap && connectionMap.length > 0) {
                        const mapping = connectionMap.find(m => m.originalId === wireId);
                        if (mapping) wireId = mapping.replacementId;
                    }
                    return { ...wire, id: wireId };
                }) : output.wires
            }));
        }
        
        // Update input wires as well
        if (formattedSubflow.in) {
            formattedSubflow.in = formattedSubflow.in.map(input => ({
                ...input,
                wires: input.wires ? input.wires.map(wire => {
                    let wireId = wire.id === originalId ? uniqueId : wire.id;
                    // Also check if this wire references a flattened subflow instance
                    if (connectionMap && connectionMap.length > 0) {
                        const mapping = connectionMap.find(m => m.originalId === wireId);
                        if (mapping) wireId = mapping.replacementId;
                    }
                    return { ...wire, id: wireId };
                }) : input.wires
            }));
        }
        
        // Update flow nodes to reference the new main subflow ID
        if (formattedSubflow.flow) {
            formattedSubflow.flow = formattedSubflow.flow.map(node => ({
                ...node,
                // Update the 'z' property only for nodes that belonged to the main subflow
                z: node.z === originalId ? uniqueId : node.z
            }));
        }
        
        // Validate the formatted subflow
        if (!formattedSubflow.id || !formattedSubflow.name) {
            throw new Error('Subflow missing required id or name properties');
        }
        
        // Write the formatted JSON
        const jsonDestination = path.join(nodesDir, `${kebabName}.json`);
        fs.writeFileSync(jsonDestination, JSON.stringify(formattedSubflow, null, 2));
        
        // Create JS wrapper
        const jsContent = `const fs = require("fs");
const path = require("path");

module.exports = function(RED) {
    const subflowFile = path.join(__dirname, "${kebabName}.json");
    const subflowContents = fs.readFileSync(subflowFile);
    const subflowJSON = JSON.parse(subflowContents);
    RED.nodes.registerSubflow(subflowJSON);
}`;
        
        const jsDestination = path.join(nodesDir, `${kebabName}.js`);
        fs.writeFileSync(jsDestination, jsContent);
        
        // Update package.json
        const packageJsonPath = path.join(__dirname, '..', 'package.json');
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
        
        if (!packageJson['node-red']) {
            packageJson['node-red'] = { nodes: {} };
        }
        if (!packageJson['node-red'].nodes) {
            packageJson['node-red'].nodes = {};
        }
        
        packageJson['node-red'].nodes[kebabName] = `nodes/${kebabName}.js`;
        
        fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
        
        console.log(`✅ Added nested subflow: ${name} as ${kebabName}`);
        console.log(`📁 Files created:`);
        console.log(`   - nodes/${kebabName}.js`);
        console.log(`   - nodes/${kebabName}.json`);
        console.log(`📝 Updated package.json`);
        console.log(`🎯 Main subflow ID: ${formattedSubflow.id}`);
        console.log(`📋 Total flow nodes: ${formattedSubflow.flow.length}`);
        
    } catch (error) {
        console.error('❌ Error adding nested subflow:', error.message);
        process.exit(1);
    }
}

// Command line usage
if (require.main === module) {
    const [,, name, jsonPath] = process.argv;
    if (!name || !jsonPath) {
        console.error('Usage: node scripts/add-nested-subflow.js "Node Name" path/to/nested-subflow.json');
        console.error('');
        console.error('This script handles subflows that contain other subflows:');
        console.error('  - Identifies the main subflow vs nested subflow definitions');
        console.error('  - Preserves nested subflow definitions within the main subflow');
        console.error('  - Handles subflow instances (subflow:xxxxx nodes)');
        process.exit(1);
    }
    
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ File not found: ${jsonPath}`);
        process.exit(1);
    }
    
    addNestedSubflow(name, jsonPath);
}

module.exports = { addNestedSubflow, formatNestedSubflowJson }; 