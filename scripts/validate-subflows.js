const fs = require('fs');
const path = require('path');

function validateSubflows() {
    const nodesDir = path.join(__dirname, '..', 'nodes');
    const packageJsonPath = path.join(__dirname, '..', 'package.json');
    
    if (!fs.existsSync(nodesDir)) {
        console.log('❌ No nodes directory found');
        process.exit(1);
    }
    
    if (!fs.existsSync(packageJsonPath)) {
        console.log('❌ No package.json found');
        process.exit(1);
    }
    
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath));
    const registeredNodes = packageJson['node-red']?.nodes || {};
    
    const jsonFiles = fs.readdirSync(nodesDir).filter(f => f.endsWith('.json'));
    const jsFiles = fs.readdirSync(nodesDir).filter(f => f.endsWith('.js'));
    
    console.log('🔍 Validating subflows...\n');
    
    let allValid = true;
    const foundIds = new Set();
    
    // Validate each JSON file
    jsonFiles.forEach(jsonFile => {
        const baseName = path.basename(jsonFile, '.json');
        const jsFile = `${baseName}.js`;
        
        try {
            const content = JSON.parse(fs.readFileSync(path.join(nodesDir, jsonFile)));
            
            // Check if it's a valid subflow
            if (content.type !== 'subflow') {
                console.error(`❌ ${jsonFile}: Not a valid subflow (missing type: subflow)`);
                allValid = false;
                return;
            }
            
            // Check for required properties
            if (!content.id) {
                console.error(`❌ ${jsonFile}: Missing required 'id' property`);
                allValid = false;
                return;
            }
            
            if (!content.name) {
                console.error(`❌ ${jsonFile}: Missing required 'name' property`);
                allValid = false;
                return;
            }
            
            // Check for duplicate IDs
            if (foundIds.has(content.id)) {
                console.error(`❌ ${jsonFile}: Duplicate ID ${content.id}`);
                allValid = false;
                return;
            }
            foundIds.add(content.id);
            
            // Check if flow property exists
            if (!content.flow) {
                console.error(`❌ ${jsonFile}: Missing 'flow' property (required for subflow modules)`);
                allValid = false;
                return;
            }
            
            if (!Array.isArray(content.flow)) {
                console.error(`❌ ${jsonFile}: 'flow' property must be an array`);
                allValid = false;
                return;
            }
            
            // Check if corresponding JS file exists
            if (!jsFiles.includes(jsFile)) {
                console.error(`❌ ${jsonFile}: Missing corresponding ${jsFile}`);
                allValid = false;
                return;
            }
            
            // Check if registered in package.json
            if (!registeredNodes[baseName]) {
                console.error(`❌ ${jsonFile}: Not registered in package.json`);
                allValid = false;
                return;
            }
            
            // Validate the JS file path in package.json
            const expectedPath = `nodes/${baseName}.js`;
            if (registeredNodes[baseName] !== expectedPath) {
                console.error(`❌ ${jsonFile}: package.json path mismatch. Expected: ${expectedPath}, Got: ${registeredNodes[baseName]}`);
                allValid = false;
                return;
            }
            
            console.log(`✅ ${jsonFile}: Valid subflow "${content.name}" (ID: ${content.id}, ${content.flow.length} nodes)`);
            
        } catch (error) {
            console.error(`❌ ${jsonFile}: Invalid JSON - ${error.message}`);
            allValid = false;
        }
    });
    
    // Check for orphaned JS files
    jsFiles.forEach(jsFile => {
        const baseName = path.basename(jsFile, '.js');
        const jsonFile = `${baseName}.json`;
        
        if (!jsonFiles.includes(jsonFile)) {
            console.error(`❌ ${jsFile}: Orphaned JS file - missing corresponding ${jsonFile}`);
            allValid = false;
        }
    });
    
    // Check for registered nodes without files
    Object.keys(registeredNodes).forEach(nodeName => {
        const expectedJsFile = `${nodeName}.js`;
        const expectedJsonFile = `${nodeName}.json`;
        
        if (!jsFiles.includes(expectedJsFile)) {
            console.error(`❌ package.json: Registered node '${nodeName}' missing JS file`);
            allValid = false;
        }
        
        if (!jsonFiles.includes(expectedJsonFile)) {
            console.error(`❌ package.json: Registered node '${nodeName}' missing JSON file`);
            allValid = false;
        }
    });
    
    console.log('\n📊 Validation Summary:');
    console.log(`   JSON files: ${jsonFiles.length}`);
    console.log(`   JS files: ${jsFiles.length}`);
    console.log(`   Registered nodes: ${Object.keys(registeredNodes).length}`);
    console.log(`   Unique IDs: ${foundIds.size}`);
    
    if (allValid) {
        console.log('\n🎉 All subflows are valid!');
        process.exit(0);
    } else {
        console.log('\n❌ Some subflows have issues. Please fix them.');
        process.exit(1);
    }
}

if (require.main === module) {
    validateSubflows();
}

module.exports = { validateSubflows }; 