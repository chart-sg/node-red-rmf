"""Insert docstring here."""

import argparse
import asyncio
import json
import sys
import uuid

import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.qos import QoSDurabilityPolicy as Durability
from rclpy.qos import QoSHistoryPolicy as History
from rclpy.qos import QoSProfile
from rclpy.qos import QoSReliabilityPolicy as Reliability

from rmf_mm_msgs.srv import CheckEffector, CheckMmZone
from rmf_task_msgs.msg import ApiRequest, ApiResponse

###############################################################################


class TaskRequester(Node):
    """Insert docstring here."""

    def __init__(self, argv=sys.argv):
        """Insert docstring here."""
        super().__init__('task_requester')
        parser = argparse.ArgumentParser()
        parser.add_argument(
            '-F',
            '--fleet',
            required=True,
            default='',
            type=str,
            help='Fleet name',
        )
        parser.add_argument(
            '-R',
            '--robot',
            required=False,
            default='',
            type=str,
            help='Robot name',
        )
        parser.add_argument(
            '-p',
            '--places',
            default=[],
            type=str,
            nargs='+',
            help='Start waypoints',
        )
        parser.add_argument(
            '-a',
            '--action',
            required=True,
            default='',
            type=str,
            help='Action name',
        )
        parser.add_argument(
            '-ad',
            '--action_desc',
            required=False,
            default='{}',
            type=str,
            help='action description in json str',
        )

        parser.add_argument(
            '-o',
            '--object_name',
            required=False,
            type=str,
            help='Name of object to be worked on',
        )

        # Second action parameters
        parser.add_argument(
            '-a2',
            '--action2',
            required=False,
            default='',
            type=str,
            help='Second action name',
        )
        parser.add_argument(
            '-ad2',
            '--action_desc2',
            required=False,
            default='{}',
            type=str,
            help='Second action description in json str',
        )
        parser.add_argument(
            '-o2',
            '--object_name2',
            required=False,
            type=str,
            help='Name of second object to be worked on',
        )

        parser.add_argument(
            '-st',
            '--start_time',
            help='Start time from now in secs, default: 0',
            type=int,
            default=0,
        )
        parser.add_argument(
            '-pt',
            '--priority',
            help='Priority value for this request',
            type=int,
            default=0,
        )
        parser.add_argument(
            '--use_sim_time',
            action='store_true',
            help='Use sim time, default: false',
        )
        self.args = parser.parse_args(argv[1:])

        transient_qos = QoSProfile(
            history=History.KEEP_LAST,
            depth=1,
            reliability=Reliability.RELIABLE,
            durability=Durability.TRANSIENT_LOCAL,
        )

        self.task_pub = self.create_publisher(
            ApiRequest, 'task_api_requests', transient_qos
        )
        self.effector_query_service_client = self.create_client(
            CheckEffector, f'{self.args.fleet}_effector_query'
        )
        self.zone_service_client = self.create_client(
            CheckMmZone, 'mm_zone_query'
        )

        # enable ros sim time
        if self.args.use_sim_time:
            self.get_logger().info('Using Sim Time')
            param = Parameter('use_sim_time', Parameter.Type.BOOL, True)
            self.set_parameters([param])

        # Future object
        self.response = asyncio.Future()

        # Variables
        self.msg_request_id = ''
        self.object_zone_name = None
        self.object_zone_name2 = None
        self.zone_requests_pending = 0
        self.effector_checks_pending = 0

        if self.args.action == 'arm_action':
            self.send_dispatch_arm_task()
        else:
            # Count how many zone requests we need to make
            if self.args.object_name:
                self.zone_requests_pending += 1
            if self.args.action2 and self.args.object_name2:
                self.zone_requests_pending += 1

            # Count how many effector checks we need to make
            self.effector_checks_pending += 1
            if self.args.action2:
                self.effector_checks_pending += 1

            # Send zone requests
            if self.args.object_name:
                self.send_zone_request(self.args.object_name, is_second=False)
            if self.args.action2 and self.args.object_name2:
                self.send_zone_request(self.args.object_name2, is_second=True)

            # Send effector queries
            self.send_effector_query(self.args.action, is_second=False)
            if self.args.action2:
                self.send_effector_query(self.args.action2, is_second=True)

    def send_zone_request(self, object_name, is_second=False):
        while not self.zone_service_client.wait_for_service(timeout_sec=5.0):
            self.get_logger().info(
                'Waiting for mm_zone_query to become available...'
            )

        # Create a request object
        request = CheckMmZone.Request()
        request.object_name = object_name

        # Send the request asynchronously
        self.get_logger().info(
            f'Sending request to check zone for object [{object_name}]'
        )
        future = self.zone_service_client.call_async(request)
        future.add_done_callback(
            lambda f: self.zone_request_service_callback(f, is_second)
        )

    def zone_request_service_callback(self, future, is_second=False):
        """Insert docstring here."""
        result = future.result()
        if result is None:
            self.get_logger().error('Service call failed')
            self.response.cancel()
            return
        if not result.is_mm_zone or not result.zone_name:
            self.get_logger().warn(f'Result: {result.result}')
            self.response.cancel()
            return

        if is_second:
            self.object_zone_name2 = result.zone_name
            self.get_logger().info(f'Result (action2): {result.result}')
        else:
            self.object_zone_name = result.zone_name
            self.get_logger().info(f'Result: {result.result}')

        self.zone_requests_pending -= 1
        self.check_if_ready_to_dispatch()

    def send_effector_query(self, action_name, is_second=False):
        """Insert docstring here."""
        while not self.effector_query_service_client.wait_for_service(
            timeout_sec=5.0
        ):
            self.get_logger().info(
                f'Waiting for {self.args.fleet}_effector_query to become available...'
            )

        # Create service
        req = CheckEffector.Request()
        req.robot_name = self.args.robot
        req.action_name = action_name

        # Send the request asynchronously
        self.get_logger().info(
            f'Sending request to check effector for action [{action_name}]'
        )
        future = self.effector_query_service_client.call_async(req)
        future.add_done_callback(
            lambda f: self.effector_query_service_callback(f, is_second)
        )

    def effector_query_service_callback(self, future, is_second=False):
        """Insert docstring here."""
        result = future.result()
        if result is None:
            self.get_logger().error('Service call failed')
            self.response.cancel()
            return

        if not result.effector_ready:
            action_label = 'action2' if is_second else 'action'
            self.get_logger().warn(f'Effector not ready for {action_label}')
            self.response.cancel()
            return

        action_label = 'action2' if is_second else 'action'
        self.get_logger().info(
            f'Service call succeeded for {action_label}: {result}'
        )
        self.effector_checks_pending -= 1
        self.check_if_ready_to_dispatch()

    def check_if_ready_to_dispatch(self):
        """Check if all service calls are complete and ready to dispatch."""
        if (
            self.zone_requests_pending == 0
            and self.effector_checks_pending == 0
        ):
            self.get_logger().info('All checks complete, dispatching task')
            self.send_dispatch_arm_task()

    # ====================== Task Api Request ============================

    def api_response_callback(self, response_msg: ApiResponse):
        """
        Subscribe callback for ApiResponse msg.

        :param msg: ApiResponse msg
        """
        if response_msg.request_id == self.msg_request_id:
            self.response.set_result(json.loads(response_msg.json_msg))

    def create_dispatch_arm_task(self) -> ApiRequest:
        """
        Create respective task payload for arm_task and go_to_place.

        :param task: task name
        :return: Api Request msg
        """
        msg = ApiRequest()
        msg.request_id = 'dispatch_arm_task_' + str(uuid.uuid4())
        payload = {}

        if self.args.fleet and self.args.robot:
            self.get_logger().info("Using 'robot_task_request'")
            payload['type'] = 'robot_task_request'
            payload['robot'] = self.args.robot
            payload['fleet'] = self.args.fleet
        else:
            self.get_logger().info("Using 'dispatch_task_request'")
            payload['type'] = 'dispatch_task_request'
        request = {}

        # Set task request start time
        now = self.get_clock().now().to_msg()
        now.sec = now.sec + self.args.start_time
        start_time = now.sec * 1000 + round(now.nanosec / 10**6)

        # Add activities
        request = {}
        activities = []

        # Helper function to add activities for an action
        def add_action_activities(
            action, object_name, zone_name, action_desc, places
        ):
            action_desc_dict = json.loads(action_desc)

            if object_name:
                if zone_name is not None:
                    action_desc_dict['zone_name'] = zone_name
                    activities.append(
                        {
                            'category': 'zone',
                            'description': {
                                'zone': zone_name,
                                'places': places,
                            },
                        }
                    )
                    activities.append(
                        {
                            'category': 'perform_action',
                            'description': {
                                'unix_millis_action_duration_estimate': 60000,
                                'category': action,
                                'description': action_desc_dict,
                            },
                        }
                    )
            else:
                activities.append(
                    {
                        'category': 'perform_action',
                        'description': {
                            'unix_millis_action_duration_estimate': 60000,
                            'category': action,
                            'description': action_desc_dict,
                        },
                    }
                )

        # Add first action
        add_action_activities(
            self.args.action,
            self.args.object_name,
            self.object_zone_name,
            self.args.action_desc,
            self.args.places,
        )

        # Add second action if provided
        if self.args.action2:
            add_action_activities(
                self.args.action2,
                self.args.object_name2,
                self.object_zone_name2,
                self.args.action_desc2,
                self.args.places,
            )

        request = {
            'category': 'compose',
            'description': {
                'category': self.args.action,
                'phases': [
                    {
                        'activity': {
                            'category': 'sequence',
                            'description': {'activities': activities},
                        }
                    }
                ],
            },
            'unix_millis_earliest_start_time': start_time,
        }
        payload['request'] = request
        msg.json_msg = json.dumps(payload)

        print(
            f'DispatchArmTask msg payload: \n{json.dumps(payload, indent=2)}\n'
        )
        return msg

    def send_dispatch_arm_task(self):
        """Send arm task to mm fleet adapter."""
        msg = self.create_dispatch_arm_task()
        self.task_pub.publish(msg)
        self.msg_request_id = msg.request_id

        self.api_response_sub = self.create_subscription(
            ApiResponse, 'task_api_responses', self.api_response_callback, 10
        )


###############################################################################


def main(argv=sys.argv):
    """Insert docstring here."""
    rclpy.init(args=sys.argv)
    args_without_ros = rclpy.utilities.remove_ros_args(sys.argv)

    task_requester = TaskRequester(args_without_ros)

    rclpy.spin_until_future_complete(
        task_requester, task_requester.response, timeout_sec=5
    )

    try:
        if task_requester.response.done():
            print(f'Got response:\n{task_requester.response.result()}')
        else:
            print('Did not get a response')
    except asyncio.CancelledError:
        print('Task cancelled')

    rclpy.shutdown()


if __name__ == '__main__':
    main(sys.argv)
