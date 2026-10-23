"""Diagnostic input-representation ablation; never a production entrypoint.

Plaintext removes the JSON representation AND omits language metadata.
Current-turn additionally discards history, framing and its routing directive;
neither is production-ready. Keep options, order, question instructions and
native answers unchanged. The pinned
backend still validates inputs, artifacts, truncation and returned probabilities.
No threshold, abstention heuristic, model or production timeout is changed.
"""
import json


CALIBRATION_VERSION = "plaintext-unqualified-v1"
CURRENT_TURN_VERSION = "current-turn-unqualified-v1"
TRANSCRIPT_PREFIX = ("Scripted transcript. Route the current customer turn (last Customer line), "
                     "not an earlier request.\n")


class PlaintextAgent:
    def __init__(self, native):
        self._native = native

    def input_text(self, text):
        return text

    def input_state(self, value):
        return self.input_text(value['patient_text'])

    def system_one(self, state, questions):
        try:
            value = json.loads(state)
            if (type(value) is not dict or set(value) != {"patient_text", "language"} or
                    type(value["patient_text"]) is not str or not value["patient_text"] or
                    value["language"] not in ("en", "es", "mixed", "unknown") or
                    type(questions) is not dict or set(questions) != {"decision"}):
                raise ValueError()
            decision = questions["decision"]
            if (type(decision) is not dict or set(decision) != {"type", "instructions", "criteria"} or
                    decision["type"] != "choice" or type(decision["instructions"]) is not str or
                    type(decision["criteria"]) is not dict or not 1 <= len(decision["criteria"]) <= 7 or
                    list(decision["criteria"]) != [f"option_{i}" for i in range(len(decision["criteria"]))]):
                raise ValueError()
            criteria = {}
            for option, encoded in decision["criteria"].items():
                description = json.loads(encoded)
                if (type(description) is not dict or set(description) != {"description"} or
                        type(description["description"]) is not str or not description["description"]):
                    raise ValueError()
                criteria[option] = description["description"]
        except (ValueError, TypeError, KeyError):
            raise ValueError("invalid experiment input") from None
        return self._native.system_one(self.input_state(value), {"decision": {
            "type": decision["type"], "instructions": decision["instructions"], "criteria": criteria}})


class LanguagePreservingAgent(PlaintextAgent):
    """Matched serialization ablation: retain language and the complete text."""

    def input_state(self, value):
        return 'Patient text:\n' + value['patient_text'] + '\nLanguage: ' + value['language']


class CurrentTurnAgent(PlaintextAgent):
    """Ablation for allowlisted single-line scripted turns, not a chat parser."""

    def input_text(self, text):
        if not text.startswith(TRANSCRIPT_PREFIX + "Customer: "):
            raise ValueError("invalid experiment input")
        _, separator, current = text.rpartition("\nCustomer: ")
        if not separator or not current.strip() or "\n" in current or "\r" in current:
            raise ValueError("invalid experiment input")
        return current
