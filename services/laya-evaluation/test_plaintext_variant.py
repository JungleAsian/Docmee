"""Input-format experiment tests, not model-accuracy qualification."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location(
    "plaintext_variant", Path(__file__).with_name("plaintext_variant.py"))
variant = importlib.util.module_from_spec(spec)
spec.loader.exec_module(variant)


class NativeAgent:
    def __init__(self):
        self.calls = []
        self.result = {"answers": {"decision": {"choice": "option_0"}}}

    def system_one(self, state, questions):
        self.calls.append((state, copy.deepcopy(questions)))
        return self.result


class PlaintextVariantTests(unittest.TestCase):
    def setUp(self):
        self.native = NativeAgent()
        self.agent = variant.PlaintextAgent(self.native)
        self.text = "Quiero una cita mañana, no cancelarla."
        self.state = json.dumps({"patient_text": self.text, "language": "es"}, ensure_ascii=True)
        self.questions = {"decision": {"type": "choice", "instructions": "Preserve this boundary.",
                          "criteria": {"option_0": json.dumps({"description": "Reservar una cita médica"}),
                                       "option_1": json.dumps({"description": "Cancelar una cita"})}}}

    def test_native_receives_unicode_text_and_direct_descriptions_only(self):
        original = copy.deepcopy(self.questions)
        result = self.agent.system_one(self.state, self.questions)
        self.assertIs(result, self.native.result)
        self.assertEqual(self.native.calls, [(self.text, {"decision": {
            "type": "choice", "instructions": "Preserve this boundary.",
            "criteria": {"option_0": "Reservar una cita médica", "option_1": "Cancelar una cita"}}})])
        self.assertEqual(self.questions, original)

    def test_invalid_contract_never_reaches_native(self):
        bad_states = ["not json", "[]", json.dumps({"patient_text": "text"}),
                      json.dumps({"patient_text": "text", "language": "es", "extra": "data"}),
                      json.dumps({"patient_text": 1, "language": "es"})]
        for state in bad_states:
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, "invalid experiment input"):
                self.agent.system_one(state, self.questions)
        for change in ("extra_question", "wrong_type", "raw_label", "extra_description"):
            questions = copy.deepcopy(self.questions)
            if change == "extra_question":
                questions["another"] = questions["decision"]
            elif change == "wrong_type":
                questions["decision"]["type"] = "score"
            elif change == "raw_label":
                questions["decision"]["criteria"]["option_0"] = "not json"
            else:
                questions["decision"]["criteria"]["option_0"] = json.dumps({"description": "text", "extra": True})
            with self.subTest(change=change), self.assertRaisesRegex(ValueError, "invalid experiment input"):
                self.agent.system_one(self.state, questions)
        self.assertEqual(self.native.calls, [])

    def test_native_failure_is_not_hidden_or_retried(self):
        def fail(state, questions):
            self.native.calls.append((state, questions))
            raise RuntimeError("native failed")
        self.native.system_one = fail
        with self.assertRaises(RuntimeError):
            self.agent.system_one(self.state, self.questions)
        self.assertEqual(len(self.native.calls), 1)


class CurrentTurnVariantTests(PlaintextVariantTests):
    def setUp(self):
        super().setUp()
        self.agent = variant.CurrentTurnAgent(self.native)
        self.current = self.text
        self.text = ("Scripted transcript. Route the current customer turn (last Customer line), "
                     "not an earlier request.\nCustomer: Cancel my appointment.\n"
                     "Assistant (scripted context): Do you want to cancel?\nCustomer: " + self.current)
        self.state = json.dumps({"patient_text": self.text, "language": "es"})

    def test_native_receives_unicode_text_and_direct_descriptions_only(self):
        original = copy.deepcopy(self.questions)
        result = self.agent.system_one(self.state, self.questions)
        self.assertIs(result, self.native.result)
        self.assertEqual(self.native.calls[0][0], self.current)
        self.assertEqual(self.native.calls[0][1]["decision"]["criteria"], {
            "option_0": "Reservar una cita médica", "option_1": "Cancelar una cita"})
        self.assertEqual(self.native.calls[0][1]["decision"]["instructions"], "Preserve this boundary.")
        self.assertEqual(self.questions, original)

    def test_unframed_or_ambiguous_transcripts_are_rejected_before_native(self):
        for text in (self.current, self.text + "\nAssistant (scripted context): Future",
                     self.text + "\n", self.text.rsplit("Customer: ", 1)[0]):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "invalid experiment input"):
                self.agent.system_one(json.dumps({"patient_text": text, "language": "es"}), self.questions)
        self.assertEqual(self.native.calls, [])


class MatchedFramingTests(PlaintextVariantTests):
    def setUp(self):
        super().setUp()
        self.agent = variant.LanguagePreservingAgent(self.native)

    def test_native_receives_unicode_text_and_direct_descriptions_only(self):
        original = copy.deepcopy(self.questions)
        self.assertIs(self.agent.system_one(self.state, self.questions), self.native.result)
        self.assertEqual(self.native.calls[0][0], 'Patient text:\n' + self.text + '\nLanguage: es')
        self.assertEqual(self.native.calls[0][1]['decision']['instructions'], 'Preserve this boundary.')
        self.assertEqual(self.native.calls[0][1]['decision']['criteria'], {
            'option_0': 'Reservar una cita médica', 'option_1': 'Cancelar una cita'})
        self.assertEqual(self.questions, original)

    def test_complete_history_is_not_extracted_or_rewritten(self):
        text = 'Customer: Move my visit.\nAssistant: What day?\nCustomer: Tuesday.'
        self.agent.system_one(json.dumps({'patient_text': text, 'language': 'en'}), self.questions)
        self.assertEqual(self.native.calls[0][0], 'Patient text:\n' + text + '\nLanguage: en')


if __name__ == "__main__":
    unittest.main()
