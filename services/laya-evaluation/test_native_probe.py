"""Safety boundary tests; scripted backend, not native model qualification."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("native_probe", Path(__file__).with_name("native_probe.py"))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class Backend:
    ready = True
    model_version = "pinned-model"
    calibration_version = "unqualified"

    def __init__(self):
        self.calls = []

    def decide(self, request):
        self.calls.append(copy.deepcopy(request))
        return {"choiceId": "book"}


class SyntheticBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.backend = Backend()
        self.request = {"schemaVersion": 1, "requestId": "test-id", "task": "administrative_intent",
                        "language": "en", "text": "Synthetic booking request",
                        "candidates": [{"id": "book", "label": "Book an appointment"}]}
        self.guarded = probe.SyntheticOnlyBackend(self.backend, [self.request])

    def test_exact_reviewed_input_reaches_backend_and_exposes_pins(self):
        request = copy.deepcopy(self.request)
        request["requestId"] = "another-id"
        self.assertEqual(self.guarded.decide(request), {"choiceId": "book"})
        self.assertEqual(self.backend.calls, [request])
        self.assertTrue(self.guarded.ready)
        self.assertEqual(self.guarded.model_version, "pinned-model")
        self.assertEqual(self.guarded.calibration_version, "unqualified")

    def test_nonreviewed_text_candidate_task_or_extra_field_never_reaches_model(self):
        for field, value in [("text", "Unreviewed text"), ("language", "es"),
                             ("task", "workflow_branch"), ("schemaVersion", 2),
                             ("candidates", [{"id": "book", "label": "Modified"}]),
                             ("expected", "book")]:
            with self.subTest(field=field):
                request = copy.deepcopy(self.request)
                request[field] = value
                with self.assertRaisesRegex(ValueError, "synthetic input required"):
                    self.guarded.decide(request)
        self.assertEqual(self.backend.calls, [])

    def test_allowed_input_is_snapshotted_not_a_mutable_reference(self):
        self.request["text"] = "Later mutation"
        with self.assertRaises(ValueError):
            self.guarded.decide(self.request)
        self.assertEqual(self.backend.calls, [])

    def test_reviewed_corpus_selects_only_calibration_without_expected_answers(self):
        data = json.loads(Path(__file__).with_name("synthetic-v1.json").read_text(encoding="utf-8"))
        requests = probe.calibration_requests(data)
        self.assertEqual(len(requests), 15)
        self.assertTrue(all(set(request) == set(self.request) for request in requests))
        self.assertEqual({request["text"] for request in requests},
                         {case["text"] for case in data["cases"] if case["split"] == "calibration"})

    def test_heldout_or_arbitrary_corpus_is_rejected_by_fixed_digest(self):
        data = json.loads(Path(__file__).with_name("synthetic-v1.json").read_text(encoding="utf-8"))
        data["cases"][0]["text"] = "Altered corpus"
        with self.assertRaisesRegex(ValueError, "reviewed corpus required"):
            probe.calibration_requests(data)


if __name__ == "__main__":
    unittest.main()
