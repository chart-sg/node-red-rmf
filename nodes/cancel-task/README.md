# Cancel Task Node

A Node-RED node for canceling active RMF dynamic event tasks.

## Overview

The `cancel-task` node provides a simple interface to cancel currently active dynamic event tasks for specified robots in the RMF system. It automatically retrieves the necessary dynamic event information from the robot's context and sends a cancel command to the RMF action server.

## Features

- **Simple Interface**: Just specify robot name and fleet
- **Automatic Context Retrieval**: Automatically gets `dynamic_event_seq` and `dynamic_event_id` from robot context
- **Comprehensive Validation**: Validates robot existence and active tasks
- **Detailed Error Handling**: Provides clear error messages for various failure scenarios
- **Real-time Status Updates**: Updates node status to reflect operation progress

## Configuration

### Required Fields
- **Robot Name**: The name of the robot whose task should be canceled
- **Robot Fleet**: The fleet the robot belongs to

Both fields can be configured in the node or passed via message properties (`msg.robot_name` and `msg.robot_fleet`).

## Prerequisites

1. **RMF Config Node**: Must be deployed and connected
2. **Active Dynamic Event**: Robot must have an active dynamic event task
3. **Valid Context**: Robot context must contain valid `dynamic_event_seq` and `dynamic_event_id`

## Usage

### Basic Setup
1. Drag the `cancel-task` node from the RMF category into your flow
2. Configure the RMF Config reference
3. Select robot name and fleet from dropdowns (or use message properties)
4. Deploy the flow

### Via Message Properties
```javascript
msg.robot_name = "tinyRobot1";
msg.robot_fleet = "tinyRobot";
```

## Output

The node outputs a message with `msg.payload` containing:

### Success Response
```javascript
{
  "status": "success",
  "action": "cancel",
  "robot_name": "tinyRobot1",
  "robot_fleet": "tinyRobot",
  "dynamic_event_seq": 20,
  "dynamic_event_id": "1",
  "result": { /* action client result */ },
  "timestamp": "2025-07-22T10:00:00.000Z"
}
```

### Error Response
```javascript
{
  "status": "error",
  "reason": "Robot tinyRobot1 has no dynamic_event_id for cancel operation",
  "robot_name": "tinyRobot1",
  "robot_fleet": "tinyRobot"
}
```

### Warning Response (No Active Task)
```javascript
{
  "status": "warning",
  "reason": "Robot tinyRobot1 has no active dynamic event (no dynamic_event_seq)",
  "robot_name": "tinyRobot1",
  "robot_fleet": "tinyRobot"
}
```

## Status Indicators

- **Green**: Cancel operation completed successfully
- **Yellow**: Waiting for RMF connection or no active task to cancel
- **Red**: Error occurred during cancel operation
- **Blue**: Processing cancel request

## Error Scenarios

1. **Robot Not Found**: Robot doesn't exist in RMF data
2. **No Active Task**: Robot has no active dynamic event
3. **Missing Event ID**: Robot context lacks `dynamic_event_id`
4. **Action Server Error**: RMF action server rejects the cancel request
5. **Network Error**: Communication failure with RMF system

## Integration Example

```javascript
// Example flow: Cancel task when emergency button is pressed
[
  {
    "id": "emergency-input",
    "type": "inject",
    "name": "Emergency Stop",
    "payload": {
      "robot_name": "tinyRobot1",
      "robot_fleet": "tinyRobot"
    }
  },
  {
    "id": "cancel-node", 
    "type": "cancel-task",
    "config": "rmf-config-ref"
  },
  {
    "id": "result-handler",
    "type": "function",
    "func": "if (msg.payload.status === 'success') { node.log('Task canceled successfully'); } else { node.error('Cancel failed: ' + msg.payload.reason); }"
  }
]
```

## Troubleshooting

### Common Issues

1. **"Robot not found in context"**
   - Ensure robot name and fleet are correct
   - Check that RMF system is connected and robot is online

2. **"No active dynamic event"**
   - Robot has no running task to cancel
   - Check robot status in RMF dashboard

3. **"Missing dynamic_event_id"**
   - Robot context is incomplete
   - May need to wait for feedback from active task
   - Check rmfContextManager logs for context updates

4. **"Action server not available"**
   - RMF action server is not running
   - Check RMF system status and network connectivity

### Debug Tips

- Enable debug logging in Node-RED to see detailed operation logs
- Check RMF dashboard to verify robot status
- Use the goto-place node first to ensure robot context is properly populated
- Monitor robot context updates through rmfContextManager logs

## Related Nodes

- **goto-place**: For sending robots to locations
- **rmf-config**: Required configuration node
- **rmf-dashboard**: For monitoring robot status

## Technical Details

The cancel-task node:
1. Validates input parameters and robot existence
2. Retrieves robot context using `rmfContextManager.getRobotContext()`
3. Validates presence of `dynamic_event_seq` and `dynamic_event_id`
4. Calls `rmfContextManager.sendDynamicEventControl('cancel', robotContext)`
5. Returns operation result with detailed status information

The cancel operation sends an RMF dynamic event goal with:
- `event_type`: 2 (cancel)
- `dynamic_event_seq`: From robot context
- `id`: The `dynamic_event_id` to cancel
