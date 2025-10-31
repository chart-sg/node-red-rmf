# RMF Node-RED Library Documentation

This directory contains the core library modules for the RMF (Robot Middleware Framework) Node-RED integration. The library is organized into modular components that handle different aspects of RMF integration.

## 📋 Files Status

| File | Status | Purpose | Dependencies |
|------|--------|---------|-------------|
| **Core Architecture** |
| `rmfCore.js` | ✅ Active | Central state management, event emitter, and shared context | None |
| `rmfContextManager.js` | ✅ Active | Main entry point, module orchestration, and API facade | All other modules |
| `rmfLifecycleManager.js` | ✅ Active | Component initialization and lifecycle orchestration | Core modules |
| **Connection & Communication** |
| `rmfConnection.js` | ✅ Active | ROS2 initialization, WebSocket connections, SharedManager integration | `@chart-sg/node-red-ros2-manager` |
| `ros2-bridge-interface.js` | ✅ Active | Interface layer to ROS2 SharedManager with fallback support | `@chart-sg/node-red-ros2-manager` |
| **Action & Service Clients** |
| `rmf-safe-action-client.js` | ✅ Active | SharedManager-based action client wrapper (eliminates spinning conflicts) | `@chart-sg/node-red-ros2-manager` |
| `rmf-safe-service-client.js` | ✅ Active | Safe service client wrapper with SharedManager integration | `@chart-sg/node-red-ros2-manager` |
| **Task & Robot Management** |
| `rmfTaskManager.js` | ✅ Active | RMF task operations, dynamic events, and robot coordination | `rmfCore.js`, action clients |
| `rmfRobotManager.js` | ✅ Active | Robot state tracking, fleet management, and robot discovery | `rmfCore.js` |
| **Data Processing** |
| `rmfDataProcessor.js` | ✅ Active | Data validation, processing utilities, and subscription management | `rmfCore.js`, `rmfConnection.js` |
| `rmfMessageTransformers.js` | ✅ Active | ROS2 message transformation to internal context format | None |
| `rmfSubscriptions.js` | ✅ Active | RMF topic subscription management (fleet, door, lift states) | `rclnodejs` |
| **Compatibility & Detection** |
| `rmfRos2Compatibility.js` | ⚠️ Utility | ROS2 compatibility checking and environment detection | `rclnodejs` |

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           rmfContextManager.js                     │
│                        (Main Entry Point)                          │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        rmfLifecycleManager.js                      │
│                     (Component Orchestration)                      │
└─────────────────────────────┬───────────────────────────────────────┘
                              │
         ┌────────────────────┼────────────────────┐
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   rmfCore.js    │  │rmfConnection.js │  │rmfTaskManager.js│
│  (State/Events) │  │(ROS2/WebSocket) │  │ (Task Ops)      │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
         └────────────────────┼────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
    │rmfDataProcessor │ │rmfRobotMgr  │ │Action/Service   │
    │   (Data Ops)    │ │(Robot State)│ │   Clients       │
    └─────────────────┘ └─────────────┘ └─────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │ Message         │
                    │ Transformers    │
                    └─────────────────┘
```

## 🔧 Core Components

### **rmfCore.js** - Central State Management
- **Purpose**: Provides shared state, event emitter, and global context
- **Key Features**:
  - Global ROS state tracking
  - Event-driven architecture with `rmfEvents`
  - Centralized context storage (robots, locations, doors, lifts)
  - State synchronization utilities

### **rmfContextManager.js** - Main API Facade  
- **Purpose**: Primary entry point and module orchestration
- **Key Features**:
  - Unified API for all RMF operations
  - Module delegation and lifecycle management
  - Backward compatibility layer
  - Function export organization

### **rmfConnection.js** - ROS2 & WebSocket Integration
- **Purpose**: Handles ROS2 initialization and WebSocket connections
- **Key Features**:
  - SharedManager-based ROS2 initialization
  - WebSocket connection management  
  - Subscription management and throttling
  - Service client operations

## 🚀 Action Client Architecture (Updated)

### **rmf-safe-action-client.js** - SharedManager-Based Action Client
- **Purpose**: Safe action client wrapper using centralized SharedManager
- **Key Features**:
  - Uses `@chart-sg/node-red-ros2-manager` for lifecycle management
  - Eliminates spinning conflicts and nullptr errors
  - Maintains API compatibility with legacy code
  - Proper resource cleanup and coordination

### **Migration from Legacy**
The action client architecture was recently updated:
- **Before**: Direct ActionClient usage causing spinning conflicts
- **After**: SharedManager-mediated ActionClients preventing spinning interference
- **Benefits**: Eliminates spinning failures, safer resource management, production reliability

## 📊 Data Management

### **rmfDataProcessor.js** - Data Operations
- **Purpose**: Data validation, processing, and subscription management
- **Key Features**:
  - Data validation with configurable rules
  - Processing cache for performance
  - Advanced subscription management
  - Error handling and recovery

### **rmfMessageTransformers.js** - Message Transformation
- **Purpose**: Transform ROS2 message formats to internal context structures
- **Key Features**:
  - Building map and navigation graph transformation
  - Fleet, door, and lift state transformation
  - Consistent internal data format conversion
  - Preservation of dynamic event data during transformations

### **rmfRobotManager.js** - Robot State Management
- **Purpose**: Robot discovery, state tracking, and fleet management
- **Key Features**:
  - Robot state history tracking
  - Fleet organization and statistics
  - Robot discovery events
  - Dynamic robot management

### **Note on rmfSubscriptions.js**
- **Status**: ✅ **ACTIVE CORE COMPONENT** (not legacy)
- **Purpose**: Manages all RMF topic subscriptions (fleet, door, lift states)
- **Usage**: Essential for RMF data processing and event handling

## 🔄 Usage Patterns

### Basic Initialization
```javascript
const rmfContextManager = require('./lib/rmfContextManager');
await rmfContextManager.initROS2({ domainId: 69 });
```

### Task Management  
```javascript
const taskResult = await rmfContextManager.sendDynamicEventGoal(goalData);
```

### Robot Management
```javascript
const robots = rmfContextManager.getAllRobots();
const robot = rmfContextManager.getRobotsByFleet('fleet_name');
```

## 🧹 Recent Changes

### ✅ Completed Refactoring
- **Action Client Migration**: Moved to SharedManager-based implementation
- **Spinning Conflict Resolution**: Eliminated ActionClient spinning interference
- **Code Cleanup**: Removed redundant components and bridge references
- **Import Organization**: Updated imports to avoid conflicts
- **Legacy Marking**: Clearly marked deprecated components

### 🎯 Benefits Achieved
- **Reliability**: Eliminated spinning conflicts and nullptr errors
- **Production Stability**: "2/2 nodes spinning successfully" under heavy action traffic
- **Maintainability**: Cleaner separation of concerns  
- **Performance**: Reduced resource conflicts and improved action reliability
- **Architecture**: Clear SharedManager-based design

## 📝 Development Guidelines

### When to Use Each Component
- **Core Operations**: Use `rmfContextManager.js` as the main entry point
- **Direct State Access**: Use `rmfCore.js` for event handling and state
- **Custom ROS2 Operations**: Use bridge interface through `rmfConnection.js`
- **Task Operations**: Use `rmfTaskManager.js` functions via context manager
- **Robot Data**: Use `rmfRobotManager.js` functions via context manager

### Architecture Principles
1. **Centralized State**: All state goes through `rmfCore.js`
2. **Event-Driven**: Use `rmfEvents` for component communication  
3. **SharedManager Integration**: Use SharedManager for ROS2 operations
4. **Clean Separation**: Each module has a clear, focused responsibility

---

*Last Updated: August 6, 2025*  
*Architecture Version: SharedManager-Based (v3.0)*
