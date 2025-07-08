# CHART Node-RED RMF Nodes

A collection of Node-RED subflow modules for RMF (Robot Middleware Framework) integration.

## Overview

This package provides reusable Node-RED subflows designed for RMF applications. Each subflow is packaged as a proper Node-RED module that can be easily installed and used in Node-RED flows.

## Installation

### From npm (when published)
```bash
npm install @chart/node-red-rmf
```

### Local Development
```bash
cd ~/.node-red
npm install /path/to/node-red-chart-rmf
```

## Available Nodes

### Test Node
- **Category**: RMF
- **Function**: A simple test node that demonstrates the subflow structure
- **Configuration**: Message text (default: "hello-word")

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

- Node-RED >= 1.3.0 (for subflow module support)
- Node.js >= 12.0.0

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