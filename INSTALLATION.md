# Chart Node-RED RMF Package Installation Guide

## 🚀 Quick Start for RMF Users

### Prerequisites
- Ubuntu 22.04/24.04 with ROS2 (Humble/Jazzy)
- RMF workspace built and sourced
- Node.js 14+ and npm
- Node-RED installed

### Step-by-Step Installation

#### 1️⃣ **Setup RMF Environment**
```bash
# Source ROS2 first
source /opt/ros/<distro>/setup.bash  # e.g. <distro> is jazzy or humble

# Source your RMF workspace
source <your-rmf-ws>/install/setup.bash  # e.g. <your-rmf-ws> is ~/rmf_ws
```

#### 2️⃣ **Install Dependencies in Order**
```bash
# Navigate to Node-RED directory
cd ~/.node-red

# Install rclnodejs with RMF environment sourced
npm install rclnodejs

# Install rmf package (automatically includes manager)
npm install @chart/node-red-rmf
```

## 📦 Manual .tgz Installation

If installing from .tgz files:

```bash
# 1. Source RMF environment
source /opt/ros/<distro>/setup.bash  # e.g. <distro> is jazzy or humble
source <your-rmf-ws>/install/setup.bash  # e.g. <your-rmf-ws> is ~/rmf_ws

# 2. Install dependencies first
cd ~/.node-red
npm install rclnodejs

# 3. Install packages in order
npm install ./chart-node-red-rmf-1.0.0.tgz
```

## ❌ Common Issues

### "Missing node modules" error
- **Cause**: Dependencies not installed or RMF environment not sourced
- **Fix**: Follow step-by-step installation above

### "rclnodejs not found" error  
- **Cause**: rclnodejs installed without RMF environment
- **Fix**: 
  ```bash
  npm uninstall rclnodejs
  source <your-rmf-ws>/install/setup.bash  # e.g. <your-rmf-ws> is ~/rmf_ws
  npm install rclnodejs
  ```

### RMF message types not available
- **Cause**: RMF workspace not sourced during rclnodejs installation
- **Fix**: Reinstall rclnodejs with RMF environment sourced

### Nodes not appearing in palette
- **Cause**: Installation order incorrect
- **Fix**: Install ros2-manager before rmf package

## 🔧 Verification

After installation, verify your setup:

```bash
# Check RMF environment
echo $ROS_DISTRO
ros2 pkg list | grep rmf
npm run check-rmf

# Start Node-RED (with RMF sourced)
source ~/rmf_ws/install/setup.bash
node-red
```

Visit `http://localhost:1880` and look for RMF nodes in the palette.

## 🤖 RMF-Specific Features

This package provides:
- **rmf-config**: RMF fleet management configuration
- **start-task**: Submit tasks to RMF fleet
- **goto-place**: Send robots to specific locations
- **cancel-task**: Cancel running tasks
- **end-task**: Mark tasks as completed

## 📚 Next Steps

- Run `npm run check-rmf` to verify your RMF environment
- Check out [examples](./exportjson/) for sample flows
- Read the [README](./README.md) for detailed usage
- See [Chart RMF Documentation](https://chart-sg.github.io/node-red-rmf/) for advanced topics
