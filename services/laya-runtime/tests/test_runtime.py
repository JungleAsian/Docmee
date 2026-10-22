"""Behavioral contract tests using only synthetic data and real loopback sockets."""
import contextlib
import http.client
import importlib.util
import io
import json
from pathlib import Path
import socket
import sys
import threading
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def request_data():
    return {"schemaVersion": 1, "requestId": "12345678-1234-4234-8234-123456789abc",
            "task": "administrative_intent", "language": "en", "text": "synthetic question",
            "candidates": [{"id": "a", "label": "synthetic option"}]}


class Backend:
    ready = True
    model_version = "test-model-v1"
    calibration_version = "test-calibration-v1"

    def decide(self, request):
        return {"schemaVersion": 1, "requestId": request["requestId"],
                "modelVersion": self.model_version, "calibrationVersion": self.calibration_version,
                "choiceId": "a", "rawScore": 0.75, "abstain": False}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(importlib.util.find_spec("server"), "runtime server is not implemented")
        from server import RuntimeServer
        self.server_type = RuntimeServer
        self.servers = []

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown()
            server.server_close()
            thread.join(1)
            self.assertFalse(thread.is_alive())

    def start(self, backend=None, **kwargs):
        server = self.server_type(("127.0.0.1", 0), backend=backend,
                                  read_timeout=0.25, inference_timeout=0.15, **kwargs)
        thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01})
        thread.start()
        self.servers.append((server, thread))
        return server.server_address

    def call(self, address, method="POST", path="/v1/decision", data=None, headers=None):
        connection = http.client.HTTPConnection(*address, timeout=2)
        body = json.dumps(request_data() if data is None else data).encode() if method == "POST" else None
        connection.request(method, path, body=body, headers=headers or {"Content-Type": "application/json"})
        response = connection.getresponse()
        result = response.status, response.read(), dict(response.getheaders())
        connection.close()
        return result

    def raw(self, address, payload):
        with socket.create_connection(address, timeout=2) as sock:
            sock.sendall(payload)
            chunks = []
            while True:
                try:
                    chunk = sock.recv(65536)
                except (ConnectionResetError, ConnectionAbortedError):
                    break
                if not chunk:
                    break
                chunks.append(chunk)
        return b"".join(chunks)

    def post_raw(self, address, body, headers=b"", content_type=b"application/json"):
        return self.raw(address, b"POST /v1/decision HTTP/1.1\r\nHost: localhost\r\nContent-Type: "
                        + content_type + b"\r\nContent-Length: " + str(len(body)).encode()
                        + b"\r\n" + headers + b"\r\n" + body)

    def test_default_liveness_is_not_readiness(self):
        address = self.start()
        self.assertEqual(self.call(address, "GET", "/health")[0], 200)
        self.assertEqual(self.call(address, "GET", "/ready")[0], 503)
        self.assertEqual(self.call(address)[0], 503)

    def test_ready_backend_wire_contract_and_close(self):
        address = self.start(Backend())
        self.assertEqual(self.call(address, "GET", "/ready")[0], 200)
        status, body, headers = self.call(address)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"schemaVersion": 1,
            "requestId": "12345678-1234-4234-8234-123456789abc", "modelVersion": "test-model-v1",
            "calibrationVersion": "test-calibration-v1", "choiceId": "a", "rawScore": 0.75, "abstain": False})
        self.assertEqual(headers["Connection"], "close")

    def test_readiness_requires_both_pins(self):
        for field in ("model_version", "calibration_version"):
            backend = Backend()
            setattr(backend, field, " ")
            self.assertEqual(self.call(self.start(backend), "GET", "/ready")[0], 503)

    def test_invalid_request_shapes_are_rejected(self):
        address = self.start(Backend())
        variants = [[], None, 1, "value"]
        for key, value in [("schemaVersion", True), ("schemaVersion", 2), ("requestId", "bad"),
                           ("requestId", "12345678-1234-4234-8234-123456789ABC"),
                           ("task", "action"), ("language", "fr"), ("text", " "),
                           ("text", "x" * 1601), ("candidates", []),
                           ("candidates", [{"id": "a", "label": "b", "extra": 1}]),
                           ("candidates", [{"id": "a", "label": "b"}] * 2),
                           ("candidates", [{"id": "x" * 129, "label": "b"}]),
                           ("candidates", [{"id": "a", "label": "b" * 1201}]),
                           ("candidates", [{"id": str(n), "label": "b"} for n in range(8)])]:
            data = request_data()
            data[key] = value
            variants.append(data)
        variants.append({**request_data(), "clinicId": "forbidden"})
        for data in variants:
            with self.subTest(data_type=type(data), field=next(iter(data), None) if isinstance(data, dict) else None):
                raw = self.post_raw(address, json.dumps(data).encode())
                self.assertIn(b" 400 ", raw.split(b"\r\n")[0])

    def test_utf16_and_aggregate_limits(self):
        address = self.start(Backend())
        for text, status in [("\U0001f600" * 800, 200), ("\U0001f600" * 801, 400)]:
            data = request_data()
            data["text"] = text
            self.assertEqual(self.call(address, data=data)[0], status)
        for count, status in [(4, 200), (5, 400)]:
            data = request_data()
            data["text"] = "x" * 1000
            data["candidates"] = [{"id": chr(97 + n), "label": "x" * 1100} for n in range(count)]
            self.assertEqual(self.call(address, data=data)[0], status)

    def test_duplicate_json_invalid_utf8_and_nonfinite_rejected(self):
        address = self.start(Backend())
        valid = json.dumps(request_data()).encode()
        for body in [b'{"schemaVersion":1,' + valid[1:], b'{"x":NaN}', b'{"x":Infinity}',
                     b'\xff', b'{', b'{"candidates":[{"id":"a","id":"b"}]}']:
            self.assertIn(b" 400 ", self.post_raw(address, body).split(b"\r\n")[0])

    def test_only_exact_methods_paths_without_query(self):
        address = self.start(Backend())
        for method, path in [("GET", "/v1/decision"), ("POST", "/health"), ("PUT", "/v1/decision"),
                             ("HEAD", "/health"), ("GET", "/health?"), ("GET", "/health?x=1"),
                             ("GET", "/missing"), ("OPTIONS", "/ready")]:
            with self.subTest(method=method, path=path):
                self.assertNotEqual(self.call(address, method, path)[0], 200)

    def test_request_framing_and_media_type(self):
        address = self.start(Backend())
        body = json.dumps(request_data()).encode()
        for header in [b"Content-Length: 1\r\n", b"Transfer-Encoding: chunked\r\n",
                       b"Content-Encoding: identity\r\n", b"Expect: 100-continue\r\n"]:
            self.assertIn(b" 400 ", self.post_raw(address, body, header).split(b"\r\n")[0])
        for media in [b"text/json", b"application/json; charset=latin1", b"application/json; x=y"]:
            self.assertIn(b" 415 ", self.post_raw(address, body, content_type=media).split(b"\r\n")[0])
        self.assertIn(b" 200 ", self.post_raw(address, body, content_type=b"application/json; charset=UTF-8"))
        for length in [b"", b"-1", b"1,1", b"32769"]:
            line = b"Content-Length: " + length + b"\r\n" if length else b""
            raw = self.raw(address, b"POST /v1/decision HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\n" + line + b"\r\n")
            self.assertNotIn(b" 200 ", raw)

    def test_header_count_and_byte_limits(self):
        address = self.start(Backend())
        for headers in [b"".join(f"X-{n}: x\r\n".encode() for n in range(40)),
                        b"X-A: " + b"x" * 9000 + b"\r\n",
                        b"".join(f"X-{n}: ".encode() + b"x" * 1000 + b"\r\n" for n in range(9))]:
            self.assertIn(b" 431 ", self.post_raw(address, b"{}", headers).split(b"\r\n")[0])

    def test_read_timeout_and_short_body(self):
        address = self.start()
        started = time.monotonic()
        response = self.raw(address, b"POST /v1/decision HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 20\r\n\r\n{")
        self.assertIn(b" 408 ", response)
        self.assertLess(time.monotonic() - started, 1)

    def test_pipelining_never_runs_second_request(self):
        address = self.start()
        response = self.raw(address, b"GET /health HTTP/1.1\r\nHost: x\r\n\r\nGET /ready HTTP/1.1\r\nHost: x\r\n\r\n")
        self.assertEqual(response.count(b"HTTP/1.1"), 1)
        self.assertIn(b"Connection: close", response)

    def test_busy_hang_retains_slot_and_health_stays_responsive(self):
        entered, release = threading.Event(), threading.Event()
        class Hanging(Backend):
            def decide(self, request):
                entered.set()
                release.wait(3)
                return super().decide(request)
        address = self.start(Hanging())
        first = threading.Thread(target=lambda: self.call(address))
        first.start()
        try:
            self.assertTrue(entered.wait(1))
            started = time.monotonic()
            self.assertEqual(self.call(address)[0], 503)
            self.assertLess(time.monotonic() - started, 0.12)
            self.assertEqual(self.call(address, "GET", "/health")[0], 200)
            first.join(1)
            self.assertFalse(first.is_alive())
            self.assertEqual(self.call(address)[0], 503)
        finally:
            release.set()
            first.join(1)
        deadline = time.monotonic() + 1
        while self.call(address)[0] == 503 and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(self.call(address)[0], 200)

    def test_backend_errors_redacted_without_stdout_stderr(self):
        class Broken(Backend):
            def decide(self, request):
                raise ValueError("synthetic-private-marker " + request["text"])
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            address = self.start(Broken())
            status, body, _ = self.call(address)
            invalid = self.post_raw(address, b'{"text":"synthetic-private-marker"}')
        self.assertEqual(status, 503)
        for output in [body, invalid, stdout.getvalue().encode(), stderr.getvalue().encode()]:
            self.assertNotIn(b"synthetic-private-marker", output)
            self.assertNotIn(b"synthetic question", output)
            self.assertNotIn(b"12345678", output)
        self.assertEqual(stdout.getvalue() + stderr.getvalue(), "")

    def test_backend_base_exception_cannot_escape_to_thread_logging(self):
        class Broken(Backend):
            def decide(self, request):
                raise KeyboardInterrupt("synthetic-private-marker")
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr):
            status, body, _ = self.call(self.start(Broken()))
        self.assertEqual(status, 503)
        self.assertNotIn(b"synthetic-private-marker", body)
        self.assertEqual(stderr.getvalue(), "")

    def test_invalid_backend_results_fail_closed(self):
        address_backend = Backend()
        address = self.start(address_backend)
        for field, value in [("schemaVersion", True), ("requestId", "wrong"),
                             ("modelVersion", "wrong"), ("calibrationVersion", "wrong"),
                             ("choiceId", "unknown"), ("choiceId", None), ("rawScore", float("nan")),
                             ("rawScore", float("inf")), ("rawScore", True), ("rawScore", -0.1),
                             ("rawScore", 1.1), ("abstain", 1), ("extra", "x" * 9000)]:
            def decide(request, field=field, value=value):
                result = Backend().decide(request)
                result[field] = value
                return result
            address_backend.decide = decide
            with self.subTest(field=field, value_type=type(value)):
                self.assertEqual(self.call(address)[0], 503)

    def test_oversized_valid_response_is_rejected(self):
        backend = Backend()
        backend.model_version = "\U0001f600" * 3000
        self.assertEqual(self.call(self.start(backend))[0], 503)

    def test_abstaining_null_choice_allowed(self):
        backend = Backend()
        def decide(request):
            return {**Backend().decide(request), "choiceId": None, "abstain": True}
        backend.decide = decide
        self.assertEqual(self.call(self.start(backend))[0], 200)

    def test_bind_rejection(self):
        for host in ["0.0.0.0", "localhost", "::1", "127.0.0.2"]:
            with self.assertRaises(ValueError):
                self.server_type((host, 0))

    def test_shutdown_releases_listening_socket(self):
        address = self.start()
        server, thread = self.servers.pop()
        server.shutdown()
        server.server_close()
        thread.join(1)
        with self.assertRaises(OSError):
            socket.create_connection(address, timeout=0.25)

    def test_worker_capacity_rejects_without_unbounded_queue(self):
        address = self.start(max_workers=2)
        sockets = [socket.create_connection(address, timeout=1) for _ in range(2)]
        try:
            for sock in sockets:
                sock.sendall(b"GET /health HTTP/1.1\r\n")
            deadline = time.monotonic() + 0.15
            server = self.servers[-1][0]
            while len(server._connections) < 2 and time.monotonic() < deadline:
                time.sleep(0.001)
            started = time.monotonic()
            response = self.raw(address, b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            self.assertIn(b" 503 ", response)
            self.assertLess(time.monotonic() - started, 0.15)
        finally:
            for sock in sockets:
                sock.close()

    def test_backend_pin_changes_fail_readiness_and_inference(self):
        backend = Backend()
        address = self.start(backend)
        backend.model_version = "changed-model"
        self.assertEqual(self.call(address, "GET", "/ready")[0], 503)
        self.assertEqual(self.call(address)[0], 503)

    def test_all_tasks_and_languages_preserve_contract(self):
        address = self.start(Backend())
        for task in ["administrative_intent", "workflow_branch", "kb_relevance"]:
            for language in ["en", "es", "mixed", "unknown"]:
                data = {**request_data(), "task": task, "language": language}
                self.assertEqual(self.call(address, data=data)[0], 200)

    def test_malformed_header_lines_and_get_bodies_rejected(self):
        address = self.start()
        for suffix in [b" Folded: x\r\n\r\n", b"X : x\r\n\r\n", b"X: x\x00\r\n\r\n",
                       b"Content-Length: 1\r\n\r\nx", b"Content-Length: 0\r\nContent-Length: 0\r\n\r\n"]:
            self.assertIn(b" 400 ", self.raw(address, b"GET /health HTTP/1.1\r\nHost: x\r\n" + suffix))

    def test_request_line_limit_is_inclusive(self):
        address = self.start()
        response = self.raw(address, b"GET /" + b"x" * 2033 + b" HTTP/1.1\r\nHost: x\r\n\r\n")
        self.assertIn(b" 400 ", response)


if __name__ == "__main__":
    unittest.main()
