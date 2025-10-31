# CHART Node-RED RMF Nodes

A collection of Node-RED custom nodes for RMF (Robot Middleware Framework) integration, built on the Chart SharedManager architecture for reliable multi-plugin ROS2 operations.

## Overview

This package provides reusable Node-RED custom nodes designed for RMF applications. Each node is packaged as a proper Node-RED module that can be easily installed and used in Node-RED flows.

### Key Features

- **SharedManager Integration**: Built-in `@chart-sg/node-red-ros2-manager` for reliable ROS2 operations
- **RMF-Specific Nodes**: Fleet management, task dispatch, and coordination nodes
- **Multi-Plugin Compatible**: Works alongside `@chart-sg/node-red-ros2` and other Chart ROS2 plugins
- **Production Ready**: No spinning conflicts, proper resource management

## Quick Installation

```bash
# 1. Source ROS2/RMF environment
source /opt/ros/jazzy/setup.bash        # (or your ROS2 distro)
source ~/rmf_ws/install/setup.bash      # (your RMF workspace)

# 2. Install in Node-RED directory (with .tgz files)
cd ~/.node-red
npm install rclnodejs
npm install ./chart-sg-node-red-ros2-manager-1.0.0.tgz
npm install ./chart-sg-node-red-rmf-1.0.0.tgz
```

**Complete Installation Guide** - Multiple methods, troubleshooting, development setup: [INSTALLATION.md](./INSTALLATION.md)

## Prerequisites & Environment Setup

This package requires a properly configured ROS2 and RMF environment:

### Required Environment
- **ROS2 Jazzy** (or compatible version)
- **RMF Workspace** with required message packages
- **rclnodejs** with RMF message type generation

### Environment Check
After installation, verify your environment is ready:

```bash
# Check RMF environment setup
npm run check-rmf
```

This will verify:
- ROS2 environment is sourced
- RMF packages are available (`rmf_building_map_msgs`, `rmf_task_msgs`, etc.)
- rclnodejs has generated RMF message types

### Quick Setup Guide
If the environment check fails:

```bash
# 1. Source your ROS2 environment
source /opt/ros/jazzy/setup.bash

# 2. Source your RMF workspace  
source ~/rmf2A_ws/install/setup.bash

# 3. Restart Node-RED to regenerate message types
# (rclnodejs will automatically generate RMF message types on startup)

# 4. Verify environment
npm run check-rmf
```

### Troubleshooting
- **Missing RMF message types**: Ensure RMF workspace is sourced before starting Node-RED
- **rclnodejs generation issues**: Delete `~/.node-red/node_modules/rclnodejs/generated/` and restart Node-RED
- **Package not found errors**: Verify RMF packages with `ros2 pkg list | grep rmf`

## Architecture

This package uses the **Chart SharedManager** architecture for conflict-free ROS2 integration:

```
┌─────────────────────────────────────────────────────────────┐
│                @chart-sg/node-red-ros2-manager              │
│              (Shared ROS2 Context Manager)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴──────────┐
          │                      │
┌─────────▼──────────┐  ┌────────▼─────────┐
│ @chart-sg/node-    │  │ @chart-sg/node-  │
│ red-ros2           │  │ red-rmf          │
│ (Educational)      │  │ (Production)     │
└────────────────────┘  └──────────────────┘
```

### Benefits:
- **No ActionClient spinning conflicts** - SafeActionClient pattern
- **Multi-plugin compatibility** - shared ROS2 context across all Chart plugins
- **Production reliability** - proper resource management and error recovery
- **RMF-specific optimizations** - fleet coordination and task management

## Available Nodes

### Test Node
- **Category**: RMF
- **Function**: A simple test node that demonstrates the custom node structure
- **Configuration**: Message text (default: "hello-word")

### RMF Config
- **Category**: Config
- **Function**: Configuration node for RMF settings and connections
- **Configuration**: API endpoints, authentication, fleet settings

### Start Task V2
- **Category**: RMF
- **Function**: Initiates RMF tasks with version 2 API
- **Configuration**: Task type, parameters, priority

### Start Events
- **Category**: RMF
- **Function**: Publishes RMF start events to the system
- **Configuration**: Event type, timing, metadata

### Goto Place
- **Category**: RMF
- **Function**: Commands robots to navigate to specific locations
- **Configuration**: Destination, fleet, robot selection

### Perform Action
- **Category**: RMF
- **Function**: Executes specific actions on robots
- **Configuration**: Action type, parameters, duration

### Teleop
- **Category**: RMF
- **Function**: Enables teleoperation control of robots
- **Configuration**: Control interface, safety limits

### Cancel Task V2
- **Category**: RMF
- **Function**: Cancels active RMF tasks
- **Configuration**: Task ID, cancellation reason

### Cancel Events
- **Category**: RMF
- **Function**: Cancels scheduled RMF events
- **Configuration**: Event ID, cancellation type

### End Events
- **Category**: RMF
- **Function**: Handles RMF task completion events
- **Configuration**: Event processing, notifications

## Compatibility & Usage

- **SharedManager Required**: This package requires the ros2-manager for all ROS2 operations
- **Multi-Plugin**: Works seamlessly with `@chart-sg/node-red-ros2` and other Chart ROS2 plugins
- **Node-RED**: Hot deployment support, proper cleanup during redeployments
- **Production Focus**: Designed for reliable fleet management and task coordination

### Integration Example

```javascript
// All RMF nodes automatically use SharedManager
const manager = require('@chart-sg/node-red-ros2-manager');
// Manager is initialized automatically by the nodes
// No manual setup required for users
```

## Development

### Project Structure
```
node-red-chart-rmf/
├── package.json           # NPM package configuration
├── index.js              # Main entry point
├── README.md             # This file
├── nodes/                # Individual custom nodes
│   ├── test-node.js      # Test node implementation
│   ├── rmf-config/       # RMF configuration node
│   ├── start-taskV2/     # Task initiation node
│   ├── start-events/     # Event publishing node
│   ├── goto-place/       # Navigation command node
│   ├── perform-action/   # Action execution node
│   ├── teleop/           # Teleoperation node
│   ├── cancel-taskV2/    # Task cancellation node
│   ├── cancel-events/    # Event cancellation node
│   └── end-events/       # Event completion node
└── scripts/              # Automation tools
    └── check-rmf-environment.js # RMF environment validation
```
```

### Environment Validation

The RMF environment validation script checks:
- RMF packages are available in ROS2 environment
- Required RMF message types are generated in rclnodejs
- Proper ROS2/RMF workspace sourcing

```bash
# Check RMF environment setup
npm run check-rmf
```

### Testing Locally

```bash
# Install in your local Node-RED
npm install . --prefix ~/.node-red

# Restart Node-RED to see the new nodes
```

## Scripts

- `npm run check-rmf` - Validate RMF environment setup
- `npm test` - Run tests (placeholder)

## Dependencies

- **@chart-sg/node-red-ros2-manager** - Shared ROS2 context management (automatically installed)
- **axios** - HTTP client for RMF API communication
- **socket.io-client** - WebSocket communication with RMF systems
- Node-RED >= 1.3.0
- Node.js >= 14.0.0

## 🔗 Related Packages

- [`@chart-sg/node-red-ros2-manager`](https://github.com/chart-sg/node-red-ros2-manager) - Core ROS2 context manager
- [`@chart-sg/node-red-ros2`](https://github.com/chart-sg/node-red-ros2) - General ROS2 nodes for Node-RED

## License

ISC

## Contributing

1. Fork the repository
2. Create your feature branch
3. Add your custom nodes following the existing patterns
4. Validate RMF environment: `npm run check-rmf`
5. Submit a pull request

## Notes

- Each node has a unique implementation for specific RMF functionality
- Nodes are registered in package.json following Node-RED custom node patterns
- All nodes appear in the "RMF" category in Node-RED's palette
- SharedManager architecture ensures reliable multi-plugin operation 