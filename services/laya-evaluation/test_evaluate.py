"""Synthetic evaluation contract tests; no model or production access."""
import copy
import http.server
import json
from pathlib import Path
import threading
import time
import unittest

from evaluate import evaluate, load_corpus, validate_corpus


def corpus():
    return {"schemaVersion": 1, "version": "synthetic-test-v1", "synthetic": True,
            "cases": [{"id": "test-en", "split": "heldout", "task": "workflow_branch",
                       "language": "en", "category": "booking", "text": "Book a visit",
                       "candidates": [{"id": "booking", "label": "Book a visit"}],
                       "expected": "booking"},
                      {"id": "test-es", "split": "heldout", "task": "workflow_branch",
                       "language": "es", "category": "booking", "text": "Reservar una cita",
                       "candidates": [{"id": "booking", "label": "Reservar una cita"}],
                       "expected": "booking"}]}


class EvaluationTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.respond = lambda request: (200, {
            "schemaVersion": 1, "requestId": request["requestId"], "modelVersion": "model-test",
            "calibrationVersion": "calibration-test", "choiceId": "booking",
            "rawScore": 0.9, "abstain": False})
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.calls.append((self.path, request))
                status, body = owner.respond(request)
                data = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                try:
                    self.wfile.write(data)
                except OSError:
                    pass

            def log_message(self, *_args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={"poll_interval": 0.01})
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(1)

    def run_eval(self, data=None, **kwargs):
        return evaluate(corpus() if data is None else data, split="heldout",
                        pins=("model-test", "calibration-test"),
                        port=self.server.server_port, timeout=0.1, **kwargs)

    def test_wire_contract_and_report_use_all_attempted_cases(self):
        report = self.run_eval()
        self.assertTrue(report["complete"])
        self.assertFalse(report["activationApproved"])
        self.assertEqual(report["summary"]["correct"], 2)
        self.assertEqual(report["summary"]["accuracy"], 1.0)
        self.assertEqual(set(report["byTaskLanguage"]), {"workflow_branch/en", "workflow_branch/es"})
        self.assertEqual(len(self.calls), 2)
        self.assertEqual([case["httpStatus"] for case in report["cases"]], [200, 200])
        self.assertEqual(self.calls[0][0], "/v1/decision")
        self.assertEqual(set(self.calls[0][1]),
                         {"schemaVersion", "requestId", "task", "language", "text", "candidates"})
        serialized = json.dumps(report)
        self.assertNotIn("Book a visit", serialized)
        self.assertNotIn("Reservar una cita", serialized)

    def test_wrong_choice_is_in_denominator(self):
        data = corpus()
        data["cases"][0]["candidates"].append({"id": "hours", "label": "Opening hours"})
        self.respond = lambda request: (200, {"schemaVersion": 1, "requestId": request["requestId"],
            "modelVersion": "model-test", "calibrationVersion": "calibration-test",
            "choiceId": "hours" if request["language"] == "en" else "booking",
            "rawScore": 0.9, "abstain": False})
        self.assertEqual(self.run_eval(data)["summary"]["accuracy"], 0.5)

    def test_unavailable_stops_without_retry_or_perfect_accuracy(self):
        self.respond = lambda _request: (503, {"error": "private diagnostic body"})
        report = self.run_eval()
        self.assertFalse(report["complete"])
        self.assertIsNone(report["summary"]["accuracy"])
        self.assertEqual(report["summary"]["notRun"], 1)
        self.assertEqual(report["cases"][0]["outcome"], "http_unavailable")
        self.assertEqual(report["cases"][0]["httpStatus"], 503)
        self.assertNotIn("httpStatus", report["cases"][1])
        self.assertNotIn("private diagnostic body", json.dumps(report))
        self.assertEqual(len(self.calls), 1)

    def test_redirect_is_not_followed(self):
        self.respond = lambda _request: (302, b"do not follow")
        result = self.run_eval()["cases"][0]
        self.assertEqual(result["outcome"], "http_unavailable")
        self.assertEqual(result["httpStatus"], 302)
        self.assertEqual(len(self.calls), 1)

    def test_wrong_pins_invalid_choice_and_request_id_fail_closed(self):
        original = self.respond
        for key, value in [("modelVersion", "other"), ("calibrationVersion", "other"),
                           ("choiceId", "not-eligible"), ("requestId", "wrong")]:
            with self.subTest(key=key):
                def changed(request):
                    status, body = original(request)
                    body[key] = value
                    return status, body
                self.respond = changed
                report = self.run_eval()
                self.assertFalse(report["complete"])
                self.assertEqual(report["cases"][0]["outcome"], "invalid_response")

    def test_oversized_duplicate_and_nonfinite_json_fail_closed(self):
        for body in [b"x" * 8193, b'{"schemaVersion":1,"schemaVersion":1}', b'{"rawScore":NaN}']:
            self.respond = lambda _request: (200, body)
            result = self.run_eval()["cases"][0]
            self.assertEqual(result["outcome"], "invalid_response")
            self.assertEqual(result["httpStatus"], 200)

    def test_deadline_is_bounded_and_no_retry(self):
        def slow(request):
            time.sleep(0.2)
            return 503, {"error": "unavailable"}
        self.respond = slow
        report = self.run_eval()
        self.assertEqual(report["cases"][0]["outcome"], "transport_failure")
        self.assertNotIn("httpStatus", report["cases"][0])
        self.assertLess(report["cases"][0]["elapsedMs"], 500)
        self.assertEqual(len(self.calls), 1)

    def test_abstention_is_not_success_on_a_decidable_case(self):
        original = self.respond
        def abstain(request):
            status, body = original(request)
            body.update(choiceId=None, abstain=True)
            return status, body
        self.respond = abstain
        report = self.run_eval()
        self.assertTrue(report["complete"])
        self.assertEqual(report["summary"]["accuracy"], 0)
        self.assertEqual(report["summary"]["abstained"], 2)

    def test_expected_abstention_is_scored_separately(self):
        data = corpus()
        data["cases"][0]["expected"] = None
        self.assertEqual(self.run_eval(data)["summary"]["correct"], 1)

    def test_invalid_corpus_never_sends_requests(self):
        for mutate in [lambda data: data.update(synthetic=False),
                       lambda data: data["cases"][0].update(patientId="forbidden"),
                       lambda data: data["cases"][0].update(expected="missing"),
                       lambda data: data["cases"][1].update(id="test-en"),
                       lambda data: data["cases"][0].update(text="x" * 1601)]:
            data = corpus()
            mutate(data)
            with self.assertRaises(ValueError):
                self.run_eval(data)
        self.assertEqual(self.calls, [])

    def test_calibration_and_heldout_cannot_share_normalized_text(self):
        data = corpus()
        twin = copy.deepcopy(data["cases"][0])
        twin.update(id="leaked", split="calibration", text="  BOOK   a visit  ")
        data["cases"].append(twin)
        with self.assertRaises(ValueError):
            validate_corpus(data)

    def test_unknown_split_and_invalid_limits_never_send(self):
        for options in [{"split": "both"}, {"timeout": float("nan")}, {"port": True}]:
            args = {"split": "heldout", "pins": ("m", "c"), "port": self.server.server_port}
            args.update(options)
            with self.assertRaises(ValueError):
                evaluate(corpus(), **args)
        self.assertEqual(self.calls, [])

    def test_bundled_corpus_is_synthetic_disjoint_and_bilingual(self):
        data = load_corpus(Path(__file__).with_name("synthetic-v1.json"))
        for split in ["calibration", "heldout"]:
            selected = [case for case in data["cases"] if case["split"] == split]
            self.assertEqual({case["language"] for case in selected}, {"en", "es", "mixed"})
            self.assertEqual({case["task"] for case in selected},
                             {"administrative_intent", "workflow_branch", "kb_relevance"})


if __name__ == "__main__":
    unittest.main()
