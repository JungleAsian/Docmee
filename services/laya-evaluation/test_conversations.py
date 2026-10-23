"""Contract tests for scripted routing replay, not a workflow end-to-end test."""
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("conversations", Path(__file__).with_name("conversations.py"))
conversation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(conversation)


class ConversationTests(unittest.TestCase):
    def test_framing_variants_use_identical_complete_inputs_and_fixed_labels(self):
        for split in ('calibration', 'heldout'):
            left = conversation.framing_corpus(split, 'json')
            right = conversation.framing_corpus(split, 'text')
            self.assertEqual(left, right)
            self.assertEqual(len(left['cases']), 36 if split == 'calibration' else 15)
            for case in left['cases']:
                self.assertEqual(case['candidates'], [{'id': key, 'label': label}
                                                     for key, label in conversation.OPTIONS])
            self.assertTrue(any('Assistant (scripted context):' in case['text'] for case in left['cases']))
        for split, variant in (('invalid', 'json'), ('heldout', 'invalid')):
            with self.assertRaises(ValueError):
                conversation.framing_corpus(split, variant)

    def test_framing_holdout_is_fresh_balanced_and_not_derived_from_seen_answers(self):
        fresh = conversation.framing_corpus('heldout', 'json')
        prior = (conversation.corpus()['cases'] + conversation.heldout_corpus()['cases'] +
                 conversation.description_corpus('heldout', 'baseline')['cases'])
        last_turn = lambda case: case['text'].rsplit('Customer: ', 1)[-1]
        self.assertFalse({last_turn(case) for case in fresh['cases']} & {last_turn(case) for case in prior})
        for language in ('en', 'es', 'mixed'):
            rows = [case for case in fresh['cases'] if case['language'] == language]
            self.assertEqual(len(rows), 5)
            self.assertEqual({case['expected'] for case in rows}, {key for key, _ in conversation.OPTIONS})
        self.assertEqual(fresh, conversation.framing_corpus('heldout', 'json'))

    def test_framing_runner_never_sends_answers_or_claims_activation(self):
        def exchange(request, **kwargs):
            self.assertEqual(set(request), {'schemaVersion', 'requestId', 'task', 'language', 'text', 'candidates'})
            return 'decision', {'choiceId': 'booking', 'rawScore': .7, 'abstain': False}, 200
        with patch.object(conversation.evaluation, '_exchange', side_effect=exchange):
            report = conversation.run_framing(pins=('model', 'calibration'), variant='text', split='heldout')
        self.assertEqual(report['framingVariant'], 'text')
        self.assertEqual(report['evaluationPurpose'], 'fresh_heldout')
        self.assertEqual(report['summary']['attempted'], 15)
        self.assertFalse(report['activationApproved'])
        self.assertFalse(report['executesDocmeeWorkflow'])
        self.assertNotIn('Customer:', json.dumps(report))

    def test_description_comparison_changes_only_candidate_descriptions(self):
        for split in ("calibration", "heldout"):
            baseline = conversation.description_corpus(split, "baseline")
            distinct = conversation.description_corpus(split, "distinct")
            self.assertEqual(len(baseline["cases"]), 24 if split == "calibration" else 12)
            for left, right in zip(baseline["cases"], distinct["cases"]):
                self.assertEqual({k: v for k, v in left.items() if k != "candidates"},
                                 {k: v for k, v in right.items() if k != "candidates"})
                self.assertEqual([c["id"] for c in left["candidates"]],
                                 [c["id"] for c in right["candidates"]])
                self.assertTrue(all(a["label"] != b["label"] for a, b in
                                    zip(left["candidates"], right["candidates"])))

    def test_description_holdout_is_fresh_and_balanced_across_routes(self):
        fresh = conversation.description_corpus("heldout", "baseline")
        prior = conversation.corpus()["cases"] + conversation.heldout_corpus()["cases"]
        last_turn = lambda text: text.rsplit("Customer: ", 1)[-1]
        self.assertFalse({last_turn(c["text"]) for c in fresh["cases"]} &
                         {last_turn(c["text"]) for c in prior})
        self.assertEqual({c["language"] for c in fresh["cases"]}, {"en", "es", "mixed"})
        self.assertEqual({c["expected"] for c in fresh["cases"]},
                         {key for key, _ in conversation.OPTIONS})
        for key, _ in conversation.OPTIONS:
            self.assertGreaterEqual(sum(c["expected"] == key for c in fresh["cases"]), 2)
        self.assertEqual(fresh, conversation.description_corpus("heldout", "baseline"))

    def test_description_runner_reports_regression_boundary_and_no_expected_on_wire(self):
        def exchange(request, **kwargs):
            self.assertEqual(set(request), {"schemaVersion", "requestId", "task", "language", "text", "candidates"})
            return "decision", {"choiceId": "booking", "rawScore": .7, "abstain": False}, 200
        with patch.object(conversation.evaluation, "_exchange", side_effect=exchange):
            report = conversation.run_descriptions(pins=("model", "calibration"), variant="distinct")
        self.assertEqual(report["evaluationPurpose"], "observed_regression")
        self.assertEqual(report["descriptionVariant"], "distinct")
        self.assertEqual(report["summary"]["attempted"], 24)
        self.assertFalse(report["activationApproved"])
        self.assertNotIn("Customer:", json.dumps(report))
        for split, variant in (("invalid", "baseline"), ("heldout", "invalid")):
            with self.assertRaises(ValueError):
                conversation.description_corpus(split, variant)

    def test_unseen_split_is_separate_and_can_be_replayed_without_labels_on_wire(self):
        heldout = conversation.heldout_corpus()
        calibration = conversation.corpus()
        self.assertEqual(len(heldout["cases"]), 12)
        self.assertEqual({case["split"] for case in heldout["cases"]}, {"heldout"})
        self.assertFalse({case["text"] for case in heldout["cases"]} &
                         {case["text"] for case in calibration["cases"]})
        self.assertEqual({case["language"] for case in heldout["cases"]}, {"en", "es", "mixed"})
        def exchange(request, **kwargs):
            self.assertNotIn("expected", request)
            return "decision", {"choiceId": "booking", "rawScore": .7, "abstain": False}, 200
        with patch.object(conversation.evaluation, "_exchange", side_effect=exchange):
            report = conversation.run(pins=("model", "calibration"), timeout=5, split="heldout")
        self.assertEqual(report["split"], "heldout")
        self.assertEqual(report["summary"]["attempted"], 12)
        self.assertNotIn("Customer:", json.dumps(report))

    def test_fixed_corpus_has_three_languages_and_unique_bounded_turns(self):
        data = conversation.corpus()
        self.assertEqual(len(data["cases"]), 12)
        self.assertEqual({case["language"] for case in data["cases"]}, {"en", "es", "mixed"})
        self.assertEqual(len({case["id"] for case in data["cases"]}), 12)
        conversation.evaluation.validate_corpus(data)

    def test_history_only_contains_past_scripted_turns_not_future_answers(self):
        cases = conversation.corpus()["cases"]
        self.assertNotIn("Customer: Actually", cases[0]["text"])
        self.assertIn("Customer: I need a first appointment", cases[1]["text"])
        self.assertIn("Customer: Actually", cases[1]["text"])
        self.assertIn("current customer turn", cases[1]["text"])
        self.assertNotIn("expected", cases[1]["text"])
        cases[0]["candidates"][0]["label"] = "Mutation"
        self.assertNotEqual(conversation.corpus()["cases"][0]["candidates"][0]["label"], "Mutation")

    def test_report_is_redacted_and_explicit_about_test_boundaries(self):
        def exchange(request, **kwargs):
            self.assertNotIn("expected", request)
            return "decision", {"choiceId": "booking", "rawScore": .7, "abstain": False}, 200
        with patch.object(conversation.evaluation, "_exchange", side_effect=exchange):
            report = conversation.run(pins=("model", "calibration"), timeout=5)
        self.assertEqual(report["simulationMode"], "scripted_transcript_route_replay")
        self.assertFalse(report["executesDocmeeWorkflow"])
        self.assertFalse(report["sendsExternalMessages"])
        self.assertFalse(report["activationApproved"])
        self.assertEqual(len(report["byConversation"]), 4)
        self.assertEqual(report["summary"]["attempted"], 12)
        encoded = json.dumps(report)
        self.assertNotIn("Customer:", encoded)
        self.assertNotIn("first appointment", encoded)

    def test_transport_failure_stops_without_retrying(self):
        with patch.object(conversation.evaluation, "_exchange", return_value=("transport_failure", None, None)) as call:
            report = conversation.run(pins=("model", "calibration"), timeout=5)
        self.assertEqual(call.call_count, 1)
        self.assertFalse(report["complete"])
        self.assertIsNone(report["summary"]["accuracy"])
        self.assertEqual(report["summary"]["notRun"], 11)


if __name__ == "__main__":
    unittest.main()
