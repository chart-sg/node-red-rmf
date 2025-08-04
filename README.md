# CHART Node-RED RMF Nodes

A collection of Node-RED subflow modules for RMF (Robot Middleware Framework) integration, built on the Chart SharedManager architecture for reliable multi-plugin ROS2 operations.

## Overview

This package provides reusable Node-RED subflows designed for RMF applications. Each subflow is packaged as a proper Node-RED module that can be easily installed and used in Node-RED flows.

### ✨ Key Features

- **🌉 SharedManager Integration**: Built-in `@chart/node-red-ros2-manager` for reliable ROS2 operations
- **🚀 RMF-Specific Nodes**: Fleet management, task dispatch, and coordination nodes
- **🤝 Multi-Plugin Compatible**: Works alongside `@chart/node-red-ros2` and other Chart ROS2 plugins
- **⚡ Production Ready**: No spinning conflicts, proper resource management

## Installation

```bash
# Install RMF nodes (ros2-manager included automatically)
npm install @chart/node-red-rmf

# Or install both ROS2 + RMF for complete integration
npm install @chart/node-red-ros2 @chart/node-red-rmf
```

*The `@chart/node-red-ros2-manager` is automatically installed as a dependency for reliable ROS2 operations.*

## 🏗️ Architecture

This package uses the **Chart SharedManager** architecture for conflict-free ROS2 integration:

```
┌─────────────────────────────────────────────────────────────┐
│                @chart/node-red-ros2-manager                 │
│              (Shared ROS2 Context Manager)                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
          ┌───────────┴──────────┐
          │                      │
┌─────────▼──────────┐  ┌────────▼─────────┐
│ @chart/node-red-   │  │ @chart/node-red- │
│ ros2               │  │ rmf              │
│ (Educational)      │  │ (Production)     │
└────────────────────┘  └──────────────────┘
```

### Benefits:
- ✅ **No ActionClient spinning conflicts** - SafeActionClient pattern
- ✅ **Multi-plugin compatibility** - shared ROS2 context across all Chart plugins
- ✅ **Production reliability** - proper resource management and error recovery
- ✅ **RMF-specific optimizations** - fleet coordination and task management

## Available Nodes

### Test Node
- **Category**: RMF
- **Function**: A simple test node that demonstrates the subflow structure
- **Configuration**: Message text (default: "hello-word")

## 🎯 Compatibility & Usage

- **SharedManager Required**: This package requires the ros2-manager for all ROS2 operations
- **Multi-Plugin**: Works seamlessly with `@chart/node-red-ros2` and other Chart ROS2 plugins
- **Node-RED**: Hot deployment support, proper cleanup during redeployments
- **Production Focus**: Designed for reliable fleet management and task coordination

### Integration Example

```javascript
// All RMF nodes automatically use SharedManager
const manager = require('@chart/node-red-ros2-manager');
// Manager is initialized automatically by the nodes
// No manual setup required for users
```

## Development

### Project Structure
```
node-red-chart-rmf/
├── package.json           # NPM package configuration
├── index.js              # Main entry point with dynamic loader
├── README.md             # This file
├── nodes/                # Individual subflow modules
│   ├── test-node.js      # Test node wrapper
│   ├── test-node.json    # Test node subflow definition
│   └── [future-nodes]    # Additional subflows
└── scripts/              # Automation tools
    ├── add-subflow.js    # Script to add new subflows
    └── validate-subflows.js # Script to validate all subflows
```

### Adding New Subflows

You can add new subflows using the automated script:

```bash
# Add a new subflow from Node-RED export
npm run add-subflow "My New RMF Node" exportjson/subflow.json

# For nested subflows use add-nested-subflow instead
npm run add-nested-subflow "My New RMF Node" exportjson/nested-subflow.json
```

The script handles both:
- **Raw Node-RED exports** (array format with subflow instance)
- **Pre-formatted subflows** (single object with flow property)

### Manual Steps (if needed)

1. **Export from Node-RED**:
   - Create your subflow in Node-RED
   - Add an instance to the workspace
   - Export the selected nodes as JSON
   - Save inside /exportjson folder

2. **Add to project**:
   - Use the add-subflow script (recommended)
   - Or manually follow the steps in the script

3. **Validate**:
   ```bash
   npm run validate
   ```

### Validation

The validation script checks:
- ✅ All JSON files are valid subflows
- ✅ Each subflow has required properties (id, name, flow)
- ✅ No duplicate IDs
- ✅ Corresponding JS wrapper files exist
- ✅ All nodes are registered in package.json
- ✅ No orphaned files

### Testing Locally

```bash
# Install in your local Node-RED
npm install . --prefix ~/.node-red

# Restart Node-RED to see the new nodes
```

## Scripts

- `npm run validate` - Validate all subflows
- `npm run add-subflow "Name" file.json` - Add a new subflow
- `npm test` - Run tests (placeholder)

## Dependencies

- **@chart/node-red-ros2-manager** - Shared ROS2 context management (automatically installed)
- **rclnodejs** - ROS2 Node.js bindings (automatically installed)
- Node-RED >= 1.3.0 (for subflow module support)
- Node.js >= 12.0.0

## 🔗 Related Packages

- [`@chart/node-red-ros2-manager`](https://github.com/chart-sg/node-red-ros2-manager) - Core ROS2 context manager
- [`@chart/node-red-ros2`](https://github.com/chart-sg/node-red-ros2) - General ROS2 nodes for Node-RED

## License

ISC

## Contributing

1. Fork the repository
2. Create your feature branch
3. Add your subflow using the provided scripts
4. Validate your changes: `npm run validate`
5. Submit a pull request

## Notes

- Each subflow must have a unique ID
- Subflows are packaged following the [Node-RED subflow module pattern](https://nodered.org/docs/creating-nodes/subflow-modules)
- The dynamic loader automatically discovers and loads all subflows in the `nodes/` directory
- All subflows appear in the "RMF" category in Node-RED's palette 