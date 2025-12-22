# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.8] - 2025-12-22

### Fixed
- **Robot Mode Change Detection System** - Resolved critical timing and performance issues
  - Fixed callback registration timing to occur before goal sending (was registering after task completion)
  - Resolved BigInt serialization errors that prevented robot mode processing 
  - Added intelligent throttling to prevent excessive fleet state processing
  - Ensured goto-place nodes properly re-output status when robot mode changes occur

### Performance
- Optimized robot mode change detection to only process when actual changes occur
- Reduced debug logging verbosity for cleaner system operation  
- Added change detection to prevent unnecessary robot manager processing
- Improved fleet state processing efficiency with smart filtering

### Technical
- Enhanced BigInt handling in robot context serialization with convertBigIntToNumber()
- Added proper callback lifecycle management for goto-place nodes
- Implemented throttled processing in rmfMessageTransformers with hasSignificantChanges detection
- Fixed robot manager instance tracking and callback registration timing
- Added getLastKnownMode() method for efficient change detection

## [1.0.7] - 2025-12-16

### Fixed
- **Robot Mode Change Event System** - Fixed missing robot mode change detection for automatic status updates
  - Added callback-based robot mode change detection in rmfRobotManager
  - Integrated mode change notifications into robot data processing pipeline (both bulk and individual updates)
  - Enabled goto-place and other event nodes to automatically re-output status when robot modes change
  - Fixed nodes not updating status output when target robot transitions between modes (e.g., idle ↔ blocked ↔ moving)

### Technical Details
- Implemented `onRobotModeChanged`/`offRobotModeChanged` callback registration system in rmfRobotManager
- Added `checkRobotModeChanges` logic with mode transition detection and callback notification
- Enhanced `processRobotData` in rmfContextManager to trigger robot update processing
- Added `processRobotUpdates` integration into both bulk robot updates and individual robot context updates
- Proper cleanup and memory management for mode change callbacks on node removal

## [1.0.7] - 2025-12-16

### Fixed
- **Robot Mode Change Event System** - Fixed missing robot mode change detection for automatic status updates
  - Added callback-based robot mode change detection in rmfRobotManager
  - Integrated mode change notifications into robot data processing pipeline (both bulk and individual updates)
  - Enabled goto-place and other event nodes to automatically re-output status when robot modes change
  - Fixed nodes not updating status output when target robot transitions between modes (e.g., idle ↔ blocked ↔ moving)

### Technical Details
- Implemented `onRobotModeChanged`/`offRobotModeChanged` callback registration system in rmfRobotManager
- Added `checkRobotModeChanges` logic with mode transition detection and callback notification
- Enhanced `processRobotData` in rmfContextManager to trigger robot update processing
- Added `processRobotUpdates` integration into both bulk robot updates and individual robot context updates
- Proper cleanup and memory management for mode change callbacks on node removal

## [1.0.6] - 2024-12-11

### Added
- **Arm Manipulation Task Support** in start-taskV2 node
  - New "Arm Manipulation" task type with dual-action capability (pick + place sequences)
  - Real-time ROS service integration for effector readiness validation via `{fleet}_effector_query`
  - Automatic zone lookup via `mm_zone_query` service with intelligent fallback mapping
  - Progressive form validation with dependent field enabling for optimal UX
  - Support for RMF MM fleet adapters and operations



## [1.0.5] - 2025-12-10

### Added
- **start-taskV2 node**: Multi-task-type support with comprehensive form validation
  - Enhanced from single compose tasks to support patrol, zone, couple, and decouple tasks
  - Implemented progressive field enabling with real-time validation feedback
  - Added zone-based waypoint filtering and proper RMF schema compliance
  - Comprehensive form validation with visual feedback and warning messages
  - Removed standalone couple/decouple nodes in favor of unified task interface

### Enhanced
- **start-taskV2 node**: Complete architectural redesign for multi-task workflow support
- Form validation system with disabled field states and progressive enabling
- Zone vertex filtering for improved waypoint selection accuracy

## [1.0.4] - 2025-12-08

### Added
- **end-events node**: Start-Events Node Selection dropdown feature
  - Allows logical pairing of end-events with specific start-events nodes
  - Enables task completion without requiring hard-wired flow connections
  - Automatically retrieves robot and task metadata from selected start-events node
  - Useful when RMF metadata might be lost between nodes in complex flows

### Fixed
- Fixed robot mode change detection to prevent re-output from completed nodes
- Added node completion tracking to avoid status re-emission after task completion
- Robot mode changes now properly ignored for nodes that have finished execution

### Enhanced
- **start-events node**: Now stores task metadata in node context for end-events access
- **end-events node**: Enhanced metadata resolution with priority system (message → start-events → config)

## [1.0.3] - 2025-11-28

### Added
- User defined, RMF defined, and Auto defined selection modes for start-events robot and fleet fields
- Fleet auto-detection using robot data extraction

### Changed
- Renamed selection modes for clarity (RMF defined vs Auto defined)
- Fleet selection preserves robot selection modes during changes

### Enhanced
- Robot mode change detection that re-outputs task status with updated rmf_robot_mode values
- Real-time robot mode monitoring that re-sends existing task status when modes change

### Fixed
- Fleet auto-detection now works correctly with available robot data
- Consistent descriptive text for all "Auto defined" options in start-events node UI

## [1.0.2] - 2025-11-27

### Added
- Third "status" output to teleop and perform-action nodes
- Robot mode detection (rmf_robot_mode) in status outputs with redundant placement

### Changed
- Enhanced robot mode detection using rmfContextManager API
- Updated RMFNodeBase class with getRobotMode() and sendStatus() methods

### Fixed
- Removed global context fallback for more reliable robot mode detection

## [1.0.1] - 2025-11-03

### Added
- Terminal installation requirement documentation
- Palette Manager limitation warnings
- rclnodejs troubleshooting guide for interface generation errors
- Clear installation instructions for RMF workspace environments

### Changed
- Enhanced README with comprehensive installation guidance
- Updated documentation to prevent common installation issues

## [1.0.0] - 2025-11-03

### Added
- Initial release of RMF nodes for Node-RED
- SharedManager architecture for conflict-free multi-plugin usage
- Complete RMF task management workflow nodes
- Integration with @chart-sg/node-red-ros2-manager
- Support for RMF fleet management and task coordination