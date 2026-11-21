import json
import subprocess
import sys
from tempfile import TemporaryDirectory
from threading import Event
import unittest

from requests import Response

from engine.transport import Canceled, Controls, CooldownStop, RateState


class TransportTests(unittest.TestCase):
    def test_server_retry_after_blocks_other_jobs(self):
        state = RateState()
        messages = []
        first = Controls(state, Event(), lambda *args: messages.append(args))
        response = Response()
        response.status_code = 429
        response.headers["Retry-After"] = "1800"
        response.url = "https://www.instagram.com/example/"
        response._content_consumed = True
        with self.assertRaises(CooldownStop):
            first.check_response(response)
        self.assertEqual(messages[0][1]["seconds"], 1800)
        second = Controls(state, Event(), lambda *args: None)
        with self.assertRaises(CooldownStop):
            second.before_request()

    def test_a_canceled_wait_does_not_reset_the_backoff(self):
        state = RateState()
        messages = []
        stop = Event()
        first = Controls(state, stop, lambda *args: messages.append(args))
        response = Response()
        response.status_code = 429
        response.url = "https://www.instagram.com/example/"
        response._content_consumed = True
        with self.assertRaises(CooldownStop):
            first.check_response(response)
        stop.set()
        with self.assertRaises(CooldownStop):
            Controls(state, Event(), lambda *args: None).before_request()

    def test_throttle_already_received_is_reported_even_during_cancel(self):
        state = RateState()
        stop = Event()
        stop.set()
        messages = []
        controls = Controls(state, stop, lambda *args: messages.append(args))
        with self.assertRaises(Canceled):
            controls.impose_cooldown(900)
        self.assertEqual(messages[0][0], "cooldown")
        self.assertEqual(messages[0][1]["seconds"], 900)


class WorkerTests(unittest.TestCase):
    def test_invalid_target_returns_json_without_printing_raw_input(self):
        with TemporaryDirectory() as directory:
            command = {"id": "job", "command": "download", "request": {
                "targetType": "profile", "targets": ["malformed/private-secret"],
                "destination": directory, "options": {}, "useSession": False,
            }}
            worker = subprocess.run([sys.executable, "-m", "engine"], input=json.dumps(command) + "\n",
                                    capture_output=True, encoding="utf-8", timeout=10, check=True)
            self.assertTrue(worker.stdout, worker.stderr)
            event = json.loads(worker.stdout)
            self.assertEqual((event["id"], event["event"], event["status"]), ("job", "result", "failed"))
            self.assertNotIn("private-secret", worker.stdout)
