# RMF Task System Architecture Documentation

## Overview

This document describes the RMF Task V2 system and Dynamic Events implementation in Node-RED, focusing on task composition and dynamic event management using REST API, SocketIO communication with RMF Web, and ROS2 action clients.

## RMF Task V2 Background

RMF Task V2 is the task management system from Open-RMF, developed in 2022. More information can be found at: https://osrf.github.io/ros2multirobotbook/task_new.html

### Communication Methods
- **ROS Method**: Via `/task_api_requests` topic
- **REST API Method**: Direct HTTP calls to RMF Web (our chosen approach for task creation)

## Dynamic Events Background

Dynamic Events is a newer extension to RMF Task V2, developed in 2025, that allows real-time modification and control of task execution through dynamic event sequences.

### Communication Methods
- **Task Creation**: Via RMF Web API or ROS2 topic (same as Task V2)
- **Event Control**: Via ROS2 action client goals (required for sending events)

## Task Structure

### Hierarchy
```
Task > Phase > Event
```

Example: A compose task can contain multiple phases, each with sequences of events like:
- Phase 1: goto-place event + teleop event
- Phase 2: perform_action event + goto-place event

### Task Types
1. **Clean** - Cleaning tasks
2. **Delivery** - Delivery tasks  
3. **Patrol** - Patrol tasks
4. **Compose** - Custom composition of phases and events (primary focus)

## Task V2 vs Dynamic Events

### Task V2 (2022)
- **Purpose**: Static task definition and execution
- **Flexibility**: Predefined task structure, limited runtime modification
- **Communication**: RMF Web API or ROS2 topic for task submission
- **Use Case**: Well-defined workflows with fixed sequences

### Dynamic Events (2025)
- **Purpose**: Real-time task modification and control during execution
- **Flexibility**: Dynamic event sequencing, runtime task modification
- **Communication**: 
  - Task creation: RMF Web API or ROS2 topic
  - Event control: ROS2 action client goals (required)
- **Use Case**: Interactive workflows, human-in-the-loop operations, adaptive task execution

## Example Task Structure

### Compose Task without Dynamic Events
```json
{
  "type": "robot_task_request",
  "robot": "tinyRobot1",
  "fleet": "tinyRobot",
  "request": {
    "category": "compose",
    "description": {
      "category": "teleop",
      "phases": [
        {"activity": {
          "category": "sequence",
          "description": {
            "activities": [
              {"category": "go_to_place",
               "description": "coe"
              },
              {"category": "perform_action",
                "description": {"category": "teleop", "description": "coe"}
              }
            ]
          }
        }}
      ]
    }
  }
}
```

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

#### Created Nodes
- **goto-place**: Combination of goto-place and zone events
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

### Multi-Fleet Location Support
- Support for shared locations accessible by multiple fleets
- Fleet compatibility validation for location and zone selection
- Dynamic location filtering based on fleet accessibility

### Dynamic Form Loading
- Robot and fleet data loaded from RMF system
- Location data populated from nav graphs and zones  
- Real-time validation of form inputs
- Consistent UI/UX across all nodes using RMFFormUtils

### Context-Based Event Management
- Dynamic event sequences retrieved directly from RMF context
- Robust metadata preservation across node chains
- Self-contained nodes that don't rely on message passing for critical data

### Validation
- JSON schema validation using schemas from rmf_fleet_adapter
- Runtime validation of robot/fleet/location combinations
- Multi-fleet location compatibility checking
- Input sanitization and error handling

### Status Management
- Real-time status updates via SocketIO
- Visual feedback in Node-RED interface
- Error handling and recovery mechanisms
- Proper completion callbacks for flow continuation

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

1. ✅ Create `perform-action` node for generic action execution
2. ✅ Create `teleop` node as specialized perform-action  
3. ✅ Implement multi-fleet location compatibility
4. ✅ Fix flow integration between goto-place → perform-action → end-task
5. Extend validation using JSON schemas
6. Add more action event types as needed
7. Consider implementing sequence events for complex workflows
8. Optimize memory usage and performance for long-running tasks

## References

- [RMF Task V2 Documentation](https://osrf.github.io/ros2multirobotbook/task_new.html)
- [rmf_fleet_adapter schemas](https://github.com/open-rmf/rmf_ros2/tree/main/rmf_fleet_adapter/schemas)
- [RMF Web API Documentation](https://rmf.readthedocs.io/en/latest/)
