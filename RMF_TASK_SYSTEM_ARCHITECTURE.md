# RMF Task System Architecture Documentation

## Overview

This document describes the RMF Task V2 system implementation in Node-RED, focusing on dynamic event management and task composition using REST API and SocketIO communication with RMF Web.

## RMF Task V2 Background

RMF Task V2 is the latest task management system from Open-RMF. More information can be found at: https://osrf.github.io/ros2multirobotbook/task_new.html

### Communication Methods
- **ROS Method**: Via `/task_api_requests` topic (not used in this implementation)
- **REST API Method**: Direct HTTP calls to RMF Web (our chosen approach)
- **SocketIO**: Real-time communication for status updates

## Task Structure

### Hierarchy
```
Task > Event
```

Example: A compose task can contain multiple events like:
- goto-place event + teleop event

### Task Types
1. **Clean** - Cleaning tasks
2. **Delivery** - Delivery tasks  
3. **Patrol** - Patrol tasks
4. **Compose** - Custom composition of events (primary focus)

**Note**: The concept of "phases" is intentionally ignored in this implementation for simplicity.

## Event Categories

### Action Events
Events that perform physical actions:
- `goto-place` - Navigate to a specific location
- `zone` - Navigate to a zone (similar to goto-place but for zones)
- `perform_action` - Generic action execution
- `clean` - Cleaning operations
- `pickup` - Pickup operations
- `dropoff` - Dropoff operations
- `payload-transfer` - Payload transfer operations

### Control Events
Events that control workflow:
- `sequence` - Static sequencing of events
- `dynamic_event` - Dynamic sequencing of events (our focus)

## Node-RED Implementation

### Dynamic Event Control Nodes
Manages the lifecycle of Dynamic Events attached to RMF tasks for single robots.

#### Event Types (event_type property)
- `1` - New request
- `2` - Cancel
- `3` - End

#### Nodes
- **start-task**: Creates RMF Compose Task with one Dynamic Event for specified robot/fleet
- **cancel-task**: Cancels running Dynamic Event (underway status)
- **end-task**: Ends Dynamic Event in standby, completes event and proceeds to next

### Dynamic Event Task Nodes
Act as 'tasks' or 'actions' within the dynamic event system.

#### Existing Nodes
- **goto-place**: Combination of goto-place and zone events

#### Nodes to be Created
- **perform-action**: Open-ended event with user-specified category and description
- **teleop**: Specialized perform-action with category set to 'teleop'

## JSON Payload Structure

### Dynamic Event Example (Teleop)
```json
{
  "event_type": 1,
  "category": "perform_action", 
  "description": "{\"category\": \"teleop\", \"description\":\"\"}",
  "dynamic_event_seq": 3
}
```

### Task Description Schema
Based on `task_description__compose.json`:
```json
{
  "category": "compose",
  "detail": "Custom task description",
  "phases": [
    {
      "activity": {
        "category": "dynamic_event",
        "description": {...}
      }
    }
  ]
}
```

### Event Description Schema
Based on `event_description__go_to_place.json` pattern:
```json
{
  "category": "perform_action",
  "description": {
    "category": "teleop",
    "description": "User-defined action"
  }
}
```

## Implementation Features

### Dynamic Form Loading
- Robot and fleet data loaded from RMF system
- Location data populated from nav graphs and zones
- Real-time validation of form inputs
- Consistent UI/UX across all nodes using RMFFormUtils

### Validation
- JSON schema validation using schemas from rmf_fleet_adapter
- Runtime validation of robot/fleet/location combinations
- Input sanitization and error handling

### Status Management
- Real-time status updates via SocketIO
- Visual feedback in Node-RED interface
- Error handling and recovery mechanisms

## File Structure

```
nodes/
├── schemas/           # JSON schemas from rmf_fleet_adapter
├── lib/              # Shared utilities and managers
├── start-task/       # Dynamic Event Control
├── end-task/         # Dynamic Event Control  
├── cancel-task/      # Dynamic Event Control
├── goto-place/       # Dynamic Event Task
├── perform-action/   # Dynamic Event Task (to be created)
└── teleop/          # Dynamic Event Task (to be created)
```

## Next Steps

1. Create `perform-action` node for generic action execution
2. Create `teleop` node as specialized perform-action
3. Extend validation using JSON schemas
4. Add more action event types as needed
5. Consider implementing sequence events for complex workflows

## References

- [RMF Task V2 Documentation](https://osrf.github.io/ros2multirobotbook/task_new.html)
- [rmf_fleet_adapter schemas](https://github.com/open-rmf/rmf_ros2/tree/main/rmf_fleet_adapter/schemas)
- [RMF Web API Documentation](https://rmf.readthedocs.io/en/latest/)
