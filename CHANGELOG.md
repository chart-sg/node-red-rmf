# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.3] - 2025-11-28

### Added
- User defined, RMF defined, and Auto defined selection modes for start-events robot and fleet fields
- Fleet auto-detection using robot data extraction

### Changed
- Renamed selection modes for clarity (RMF defined vs Auto defined)
- Fleet selection preserves robot selection modes during changes

### Fixed
- Fleet auto-detection now works correctly with available robot data

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