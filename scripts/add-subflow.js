const fs = require('fs');
const path = require('path');

function formatSubflowJson(rawData) {
    // Check if it's already in the correct format
    if (rawData.type === 'subflow' && rawData.flow) {
        console.log('✅ JSON already in correct format');
        return rawData;
    }
    
    // Handle raw export format (array of nodes)
    if (Array.isArray(rawData)) {
        console.log('🔄 Converting raw export format...');
        
        // Find the subflow definition anywhere in the array
        const subflowDefinition = rawData.find(node => node.type === 'subflow');
        
        // Validate we have a subflow definition
        if (!subflowDefinition) {
            throw new Error('Could not find subflow definition in exported JSON');
        }
        
        // Get all the flow nodes (everything except the subflow definition)
        const flowNodes = rawData.filter(node => node.type !== 'subflow');
        
        // Create the properly formatted subflow
        const formattedSubflow = {
            ...subflowDefinition,
            flow: flowNodes
        };
        
        console.log('✅ Converted raw export to proper format');
        return formattedSubflow;
    }
    
    // Handle single subflow definition without flow property
    if (rawData.type === 'subflow' && !rawData.flow) {
        console.log('⚠️  Single subflow without flow property - adding empty flow');
        return {
            ...rawData,
            flow: []
        };
    }
    
    throw new Error('Unknown JSON format - expected array or subflow object');
}

function addSubflow(name, subflowJsonPath) {
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
        const formattedSubflow = formatSubflowJson(rawData);
        
        // Generate a unique ID for this subflow to avoid conflicts
        const originalId = formattedSubflow.id;
        const uniqueId = kebabName + '-' + Math.random().toString(36).substr(2, 10);
        
        // Update the subflow with unique ID, name, and category
        formattedSubflow.id = uniqueId;
        formattedSubflow.name = name;
        formattedSubflow.category = "CHART RMF";
        
        // Update all references to the old ID with the new unique ID
        if (formattedSubflow.out) {
            formattedSubflow.out = formattedSubflow.out.map(output => ({
                ...output,
                wires: output.wires ? output.wires.map(wire => ({
                    ...wire,
                    id: wire.id === originalId ? uniqueId : wire.id
                })) : output.wires
            }));
        }
        
        // Update flow nodes to reference the new subflow ID
        if (formattedSubflow.flow) {
            formattedSubflow.flow = formattedSubflow.flow.map(node => ({
                ...node,
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
        
        console.log(`✅ Added subflow: ${name} as ${kebabName}`);
        console.log(`📁 Files created:`);
        console.log(`   - nodes/${kebabName}.js`);
        console.log(`   - nodes/${kebabName}.json`);
        console.log(`📝 Updated package.json`);
        console.log(`🎯 Subflow ID: ${formattedSubflow.id}`);
        console.log(`📋 Flow nodes: ${formattedSubflow.flow.length}`);
        
    } catch (error) {
        console.error('❌ Error adding subflow:', error.message);
        process.exit(1);
    }
}

// Command line usage
if (require.main === module) {
    const [,, name, jsonPath] = process.argv;
    if (!name || !jsonPath) {
        console.error('Usage: node scripts/add-subflow.js "Node Name" path/to/subflow.json');
        console.error('');
        console.error('The script can handle:');
        console.error('  - Raw Node-RED export (array format)');
        console.error('  - Pre-formatted subflow (single object with flow property)');
        process.exit(1);
    }
    
    if (!fs.existsSync(jsonPath)) {
        console.error(`❌ File not found: ${jsonPath}`);
        process.exit(1);
    }
    
    addSubflow(name, jsonPath);
}

module.exports = { addSubflow, formatSubflowJson }; 