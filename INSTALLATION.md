# Chart Node-RED RMF Package Installation Guide

## Quick Start for RMF Users

### Prerequisites
- Ubuntu 22.04/24.04 with ROS2 (<distro>)
- RMF workspace (<your-rmf-ws>)
- Node.js 14+ and npm
- Node-RED installed

## Verification

After installation, verify your setup:

```bash
# Check RMF environment
echo $ROS_DISTRO
ros2 pkg list | grep rmf
npm run check-rmf

# Check installation
npm list @chart/node-red-rmf

# Check if symlinked (shows -> path)
ls -la ~/.node-red/node_modules/@chart/

# Start Node-RED (with RMF sourced)
source <your-rmf-ws>/install/setup.bash
node-red
```

Visit `http://localhost:1880` and look for RMF nodes in the palette.

## Uninstallation
```bash
cd ~/.node-red

# For .tgz or npm installations
npm uninstall @chart/node-red-rmf @chart/node-red-ros2-manager

# For symlink installations
npm unlink @chart/node-red-rmf @chart/node-red-ros2-manager
cd <source-directory-rmf> && npm unlink
cd <source-directory-manager> && npm unlink
```Humble/Jazzy)
- RMF workspace built and sourced
- Node.js 14+ and npm
- Node-RED installed

### Step-by-Step Installation

#### 1. **Setup RMF Environment**
```bash
# Source ROS2 first
source /opt/ros/<distro>/setup.bash  # e.g. <distro> is jazzy or humble

# Source your RMF workspace
source <your-rmf-ws>/install/setup.bash  # e.g. <your-rmf-ws> is ~/rmf_ws
```

#### 2. **Install Dependencies in Order**

**Option A: From .tgz files (Recommended for end users)**
```bash
# Download .tgz files from GitHub Releases or get them from developer

# Navigate to Node-RED directory
cd ~/.node-red

# Install rclnodejs with RMF environment sourced
npm install rclnodejs

# Install packages in dependency order
npm install ./chart-node-red-ros2-manager-1.0.0.tgz
npm install ./chart-node-red-rmf-1.0.0.tgz
```

**Option B: Build from source (Advanced users)**
```bash
# Clone the repositories
git clone <repository-url-manager>
git clone <repository-url-rmf>

# Build packages yourself
cd node-red-ros2-manager && npm pack
cd ../node-red-rmf && npm pack

# Install the generated .tgz files
cd ~/.node-red
npm install rclnodejs
npm install ../node-red-ros2-manager/chart-node-red-ros2-manager-1.0.0.tgz
npm install ../node-red-rmf/chart-node-red-rmf-1.0.0.tgz
```

**Option C: Symlink from source (Development/Testing)**
```bash
# Clone or download the source code
git clone <repository-url-manager>
git clone <repository-url-rmf>

# Install rclnodejs first
cd ~/.node-red
npm install rclnodejs

# Create global npm links for ALL packages
cd <path-to>/node-red-ros2-manager && npm link
cd <path-to>/node-red-rmf && npm link

# IMPORTANT: Link ALL packages simultaneously to avoid dependency conflicts
cd ~/.node-red
npm link @chart/node-red-ros2-manager @chart/node-red-rmf
```

**Critical Note**: Always link all Chart packages at once. Linking them one by one will cause npm to remove existing symlinks due to dependency conflicts.

**Option D: From npm registry (When published)**
```bash
# Navigate to Node-RED directory
cd ~/.node-red

# Install rclnodejs with RMF environment sourced
npm install rclnodejs

# Install rmf package (automatically includes manager)
npm install @chart/node-red-rmf
```

## 🔗 Symlink Development Benefits
- **Live Updates**: Changes to source code are immediately reflected
- **Easy Debugging**: Direct access to source code for troubleshooting
- **Version Control**: Always using latest development version
- **No Rebuilding**: No need to repack .tgz files after changes

## Manual .tgz Installation

If you have .tgz files (from releases or built yourself):

```bash
# 1. Source RMF environment
source /opt/ros/<distro>/setup.bash  # e.g. <distro> is jazzy or humble
source <your-rmf-ws>/install/setup.bash  # e.g. <your-rmf-ws> is ~/rmf_ws

# 2. Install dependencies first
cd ~/.node-red
npm install rclnodejs

# 3. Install packages in dependency order
npm install ./chart-node-red-ros2-manager-1.0.0.tgz
npm install ./chart-node-red-rmf-1.0.0.tgz
```


## Verification

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

## RMF-Specific Features

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
