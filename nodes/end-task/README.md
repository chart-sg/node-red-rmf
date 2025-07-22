# End Task Node

The End Task node sends an "end" event to mark a robot's dynamic event as completed in the RMF (Robot Management Framework) system.

## Purpose

The end-task node is used to signal that a dynamic event is "done" when the robot is already in standby and waiting for new events. **Important**: End events are ONLY accepted by RMF when the robot is in "standby" state (not "underway").

## Critical RMF Behavior

⚠️ **IMPORTANT**: End events only work when the robot is in **"standby"** state:
- **If robot is "underway"**: RMF will **reject** the end goal
- **If robot is "standby"**: RMF will accept the end goal and mark the dynamic event as completed
- **Use case**: Mark a dynamic event as "done" when the robot has finished tasks and is waiting for new events
- **To stop active robots**: Use the "cancel-task" node instead, which works regardless of robot state

## Configuration

### Required Settings
- **RMF Config**: Reference to an RMF Config node for connection details
- **Robot Name**: Name of the target robot (can be overridden via message)
- **Robot Fleet**: Fleet name the robot belongs to (can be overridden via message)

### Input Message Properties
- `msg.robot_name` (optional): Override configured robot name
- `msg.robot_fleet` (optional): Override configured robot fleet

## Behavior

### Prerequisites
1. RMF socket connection must be active
2. Target robot must exist in the RMF system
3. Robot must have an active dynamic event (`dynamic_event_seq` present)
4. **Robot must be in "standby" state** (not "underway") for RMF to accept the end goal

### Operation Flow
1. **Validation**: Checks robot existence and active dynamic event
2. **Context Retrieval**: Gets current robot context and dynamic event information  
3. **End Event**: Sends RMF end event (event_type: 3) with current dynamic_event_seq
4. **Response**: Returns success/failure status with detailed information

### Output Payload
```javascript
{
  status: "success|error|warning|exception",
  action: "end",
  robot_name: "robot_name",
  robot_fleet: "robot_fleet", 
  dynamic_event_seq: 123,
  result: { /* RMF action client result */ },
  timestamp: "2025-07-22T12:00:00.000Z",
  reason: "error message if applicable"
}
```

## Status Indicators

| Color | Meaning |
|-------|---------|
| 🟢 Green | End event sent successfully |
| 🟡 Yellow | Warning (no active task, waiting for connection) |
| 🔵 Blue | Processing end request |
| 🔴 Red | Error or exception occurred |

## Differences from Cancel Task

| Aspect | Cancel Task | End Task |
|--------|-------------|----------|
| **Method** | Immediate abort | Mark event as completed |
| **Event Type** | 2 (cancel) | 3 (end) |
| **Requirements** | Needs `dynamic_event_id` | Only needs `dynamic_event_seq` |
| **Robot State** | Works in any state | **Only works in "standby"** |
| **RMF Behavior** | Stops robot immediately | **Rejects if robot "underway"** |
| **Use Case** | Stop active tasks | Mark completed events as "done" |

## Usage Examples

### Basic Usage
```javascript
// Send end event to configured robot
msg = {};
return msg;
```

### Override Robot
```javascript
// End task for specific robot
msg = {
    robot_name: "tinyRobot1",
    robot_fleet: "tinyRobot"
};
return msg;
```

### Conditional End
```javascript
// End task only if robot is in standby
if (msg.payload.shouldEnd && msg.robot_state === "standby") {
    msg.robot_name = "tinyRobot1";
    msg.robot_fleet = "tinyRobot";
    return msg;
}
return null;
```

## Error Handling

### Common Errors
- **Robot not found**: Specified robot doesn't exist in RMF
- **No active task**: Robot has no dynamic_event_seq (no active dynamic event)
- **Robot not in standby**: Robot is "underway" and RMF rejects the end goal
- **RMF disconnected**: Socket connection to RMF is not available
- **Validation failed**: Robot name/fleet missing or invalid

### Error Response
```javascript
{
  status: "error",
  reason: "Robot tinyRobot1 from fleet tinyRobot not found in context",
  robot_name: "tinyRobot1", 
  robot_fleet: "tinyRobot"
}
```

## Integration

### With Goto Place
```
[goto-place] → [delay] → [end-task]
```
Wait for robot to reach standby state after goto-place, then end the task.

### Manual Control
```
[inject] → [end-task]
```
Use inject nodes as manual stop buttons.

### Conditional Logic
```
[function] → [end-task]
```
Use function nodes to implement conditional ending logic.

## Best Practices

1. **Check Robot State**: Ensure robot is in "standby" before sending end event
2. **Check Active Task**: Ensure robot has an active dynamic event before ending
3. **Error Handling**: Handle "Robot not in standby" and "No active task" warnings
4. **Proper Use Case**: Use end-task only to mark completed events as "done"
5. **Active Task Control**: Use cancel-task to stop active/underway robots
6. **Status Monitoring**: Monitor node status colors for operational feedback

## Troubleshooting

### Node Shows "No active task"
- Check if robot actually has a running dynamic event
- Verify robot name/fleet are correct
- Ensure robot context is properly updated

### "Robot not found" Error  
- Verify robot exists in RMF system
- Check robot name and fleet spelling
- Confirm RMF connection is active

### End Event Not Working
- **Check robot state**: Ensure robot is in "standby" not "underway"
- Check RMF logs for action server availability and goal rejection reasons
- Verify dynamic_event_seq is valid
- Ensure robot is responsive to RMF commands
