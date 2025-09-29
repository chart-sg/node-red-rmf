#!/usr/bin/env node
/**
 * RMF-specific environment check for node-red-rmf package
 * Assumes basic ROS2 environment is already validated by node-red-ros2-manager
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function checkRmfPackages() {
    console.log('🔍 Checking RMF packages availability...');
    
    try {
        const packages = execSync('ros2 pkg list', { encoding: 'utf8' });
        const rmfPackages = packages.split('\n').filter(pkg => pkg.startsWith('rmf_'));
        
        if (rmfPackages.length === 0) {
            console.error('❌ No RMF packages found in ROS2 environment');
            console.error('   Please source your RMF workspace:');
            console.error('   source ~/rmf2A_ws/install/setup.bash');
            return false;
        }
        
        console.log(`✅ Found ${rmfPackages.length} RMF packages`);
        
        // Check for essential RMF packages used by this Node-RED package
        const requiredPackages = [
            'rmf_building_map_msgs',
            'rmf_task_msgs',
            'rmf_fleet_msgs'
        ];
        
        const missingPackages = requiredPackages.filter(pkg => !rmfPackages.includes(pkg));
        if (missingPackages.length > 0) {
            console.error(`❌ Missing required RMF packages: ${missingPackages.join(', ')}`);
            console.error('   Please ensure your RMF workspace includes these packages');
            return false;
        }
        
        console.log('✅ All required RMF packages are available');
        return true;
        
    } catch (error) {
        console.error('❌ Failed to check RMF packages');
        console.error('   Ensure ROS2 environment is sourced and ros2 command is available');
        return false;
    }
}

function checkRmfMessageGeneration() {
    console.log('\n🔍 Checking RMF message generation in rclnodejs...');
    
    const nodeRedPath = path.join(process.env.HOME, '.node-red', 'node_modules', 'rclnodejs', 'generated');
    
    if (!fs.existsSync(nodeRedPath)) {
        console.log('⚠️  rclnodejs generated directory not found');
        console.log('   Message types will be generated on first Node-RED startup');
        return true; // Not an error, just needs generation
    }
    
    try {
        const generatedDirs = fs.readdirSync(nodeRedPath);
        const rmfDirs = generatedDirs.filter(dir => dir.startsWith('rmf_'));
        
        if (rmfDirs.length === 0) {
            console.log('⚠️  RMF message types not found in rclnodejs generated directory');
            console.log('   This usually happens when rclnodejs was generated without RMF environment sourced');
            console.log('   To fix this:');
            console.log('   1. Source your RMF workspace: source ~/rmf2A_ws/install/setup.bash');
            console.log('   2. Regenerate messages: cd ~/.node-red/node_modules/rclnodejs && rm -rf generated/ && npm run generate-messages');
            console.log('   3. Restart Node-RED');
            return false;
        }
        
        console.log(`✅ Found ${rmfDirs.length} RMF message type directories in rclnodejs`);
        
        // Check for specific message types this package uses
        const requiredMsgDirs = ['rmf_building_map_msgs', 'rmf_task_msgs'];
        const missingMsgDirs = requiredMsgDirs.filter(dir => !rmfDirs.includes(dir));
        
        if (missingMsgDirs.length > 0) {
            console.log(`⚠️  Missing RMF message directories: ${missingMsgDirs.join(', ')}`);
            console.log('   Consider regenerating rclnodejs messages with full RMF environment');
            return false;
        }
        
        console.log('✅ Required RMF message types are available in rclnodejs');
        return true;
        
    } catch (error) {
        console.log('⚠️  Could not read rclnodejs generated directory');
        console.log(`   Error: ${error.message}`);
        return false;
    }
}

function main() {
    console.log('🤖 RMF Node-RED Environment Check\n');
    
    const packagesOk = checkRmfPackages();
    const messagesOk = checkRmfMessageGeneration();
    
    console.log('\n' + '='.repeat(50));
    
    if (packagesOk && messagesOk) {
        console.log('🎉 RMF environment is ready for Node-RED!');
        console.log('   You can now use RMF nodes in your Node-RED flows');
        process.exit(0);
    } else if (packagesOk) {
        console.log('⚠️  RMF packages available but message generation needs attention');
        console.log('   RMF nodes may not work until message types are properly generated');
        process.exit(1);
    } else {
        console.log('❌ RMF environment setup required');
        console.log('\nQuick setup:');
        console.log('1. Source RMF workspace: source ~/rmf2A_ws/install/setup.bash');
        console.log('2. Restart Node-RED to regenerate message types');
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { checkRmfPackages, checkRmfMessageGeneration };
