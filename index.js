const fs = require("fs");
const path = require("path");

module.exports = function(RED) {
    const nodesDir = path.join(__dirname, "nodes");
    
    // Check if nodes directory exists
    if (!fs.existsSync(nodesDir)) {
        console.warn("No nodes directory found. No subflows will be loaded.");
        return;
    }
    
    try {
        let loadedNodes = 0;
        
        // Get all entries in nodes directory
        const entries = fs.readdirSync(nodesDir);
        
        for (const entry of entries) {
            const entryPath = path.join(nodesDir, entry);
            const stat = fs.statSync(entryPath);
            
            if (stat.isFile() && entry.endsWith('.js')) {
                // Load .js files directly in nodes directory
                try {
                    const nodeModule = require(entryPath);
                    if (typeof nodeModule === 'function') {
                        nodeModule(RED);
                        const nodeName = path.basename(entry, '.js');
                        console.log(`✅ Loaded node: ${nodeName}`);
                        loadedNodes++;
                    } else {
                        console.warn(`⚠️  ${entry} does not export a function`);
                    }
                } catch (error) {
                    console.error(`❌ Error loading node from ${entry}:`, error.message);
                }
            } else if (stat.isDirectory() && !['lib', 'schemas', 'icons'].includes(entry)) {
                // Look for node.js file in subdirectory
                const nodeFile = path.join(entryPath, `${entry}.js`);
                if (fs.existsSync(nodeFile)) {
                    try {
                        const nodeModule = require(nodeFile);
                        if (typeof nodeModule === 'function') {
                            nodeModule(RED);
                            console.log(`✅ Loaded node: ${entry}`);
                            loadedNodes++;
                        } else {
                            console.warn(`⚠️  ${entry}/${entry}.js does not export a function`);
                        }
                    } catch (error) {
                        console.error(`❌ Error loading node from ${entry}/${entry}.js:`, error.message);
                    }
                }
            }
        }
        
        console.log(`📦 Loaded ${loadedNodes} node modules`);
        
    } catch (error) {
        console.error("Error loading subflow modules:", error.message);
    }
}