"""Loopback-only synthetic qualification aid; never enables clinic routing."""
import argparse
import hashlib
import http.client
import importlib.util
import json
import math
from pathlib import Path
import re
import socket
import threading
import time
from uuid import uuid4


# Reuse the reviewed wire validator without importing the model or runtime server.
_spec = importlib.util.spec_from_file_location(
    "docmee_laya_protocol", Path(__file__).resolve().parents[1] / "laya-runtime" / "protocol.py")
protocol = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(protocol)
_CASE_KEYS = {"id", "split", "task", "language", "category", "text", "candidates", "expected"}
_TOKEN = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\Z")
_SPLITS = {"calibration", "heldout"}


def _strict_json(body):
    return json.loads(body.decode("utf-8"), object_pairs_hook=protocol._pairs,
                      parse_constant=protocol._constant)


def _token(value):
    return isinstance(value, str) and _TOKEN.fullmatch(value) is not None


def _request(case, request_id):
    return {"schemaVersion": 1, "requestId": request_id,
            **{key: case[key] for key in ("task", "language", "text", "candidates")}}


def validate_corpus(data):
    """Validate a reviewed synthetic corpus; this is not a patient-data detector."""
    try:
        if type(data) is not dict or data.keys() != {"schemaVersion", "version", "synthetic", "cases"}:
            raise ValueError()
        if type(data["schemaVersion"]) is not int or data["schemaVersion"] != 1:
            raise ValueError()
        if data["synthetic"] is not True or not _token(data["version"]):
            raise ValueError()
        if type(data["cases"]) is not list or not 1 <= len(data["cases"]) <= 100:
            raise ValueError()
        ids, texts = set(), set()
        for case in data["cases"]:
            if type(case) is not dict or case.keys() != _CASE_KEYS:
                raise ValueError()
            if not _token(case["id"]) or not _token(case["category"]) or case["id"] in ids:
                raise ValueError()
            if not isinstance(case["split"], str) or case["split"] not in _SPLITS:
                raise ValueError()
            protocol.validate_request(_request(case, "00000000-0000-4000-8000-000000000001"))
            expected = case["expected"]
            if expected is not None and (not isinstance(expected, str) or
                                        expected not in {item["id"] for item in case["candidates"]}):
                raise ValueError()
            normalized = " ".join(case["text"].casefold().split())
            if normalized in texts:
                raise ValueError()
            ids.add(case["id"])
            texts.add(normalized)
        return data
    except (ValueError, KeyError, TypeError, UnicodeError, RecursionError, OverflowError):
        raise ValueError("Invalid synthetic evaluation corpus") from None


def load_corpus(path):
    """Bound file size, reject duplicate JSON keys and nonfinite numbers."""
    try:
        with Path(path).open("rb") as stream:
            body = stream.read(256 * 1024 + 1)
        if len(body) > 256 * 1024:
            raise ValueError()
        return validate_corpus(_strict_json(body))
    except (ValueError, UnicodeError, TypeError, RecursionError, OverflowError):
        raise ValueError("Invalid synthetic evaluation corpus") from None


def _exchange(request, *, port, timeout, pins):
    """Return outcome, validated decision, and observed HTTP status; never error bodies."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=timeout)
    expired = threading.Event()
    http_status = None

    def deadline():
        expired.set()
        current_socket = connection.sock
        if current_socket is not None:
            try:
                current_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    timer = threading.Timer(timeout, deadline)
    timer.daemon = True
    started = time.perf_counter()
    timer.start()
    try:
        payload = json.dumps(request, ensure_ascii=True, allow_nan=False).encode("ascii")
        connection.request("POST", "/v1/decision", payload,
                           {"Content-Type": "application/json", "Connection": "close"})
        response = connection.getresponse()
        http_status = response.status
        # http.client does not follow redirects or consult proxy environment settings.
        if response.status != 200:
            return "http_unavailable", None, http_status
        body = response.read(8193)
        if expired.is_set() or time.perf_counter() - started >= timeout:
            return "transport_failure", None, http_status
        if len(body) > 8192 or response.getheader("Content-Type", "").split(";")[0].strip().lower() != "application/json":
            return "invalid_response", None, http_status
        try:
            value = _strict_json(body)
            protocol.encode_response(value, request["requestId"],
                                     {item["id"] for item in request["candidates"]}, pins)
        except (ValueError, UnicodeError, TypeError, RecursionError, OverflowError):
            return "invalid_response", None, http_status
        return "decision", value, http_status
    except (OSError, http.client.HTTPException):
        return "transport_failure", None, http_status
    finally:
        timer.cancel()
        connection.close()


def _metrics(cases):
    decisions = [case for case in cases if case["outcome"] == "decision"]
    complete = len(decisions) == len(cases)
    return {"planned": len(cases), "attempted": sum(case["outcome"] != "not_run" for case in cases),
            "validResponses": len(decisions), "correct": sum(case["correct"] for case in decisions),
            "abstained": sum(case["abstain"] for case in decisions),
            "notRun": sum(case["outcome"] == "not_run" for case in cases),
            "accuracy": sum(case["correct"] for case in decisions) / len(cases) if complete and cases else None,
            "maxElapsedMs": max((case["elapsedMs"] for case in cases if "elapsedMs" in case), default=None)}


def evaluate(data, *, split, pins, port=8767, timeout=1.5):
    """Fail fast on unavailable/invalid transport; never retry retained native work."""
    validate_corpus(data)
    if not isinstance(split, str) or split not in _SPLITS:
        raise ValueError("Select calibration or heldout separately")
    if type(port) is not int or not 1 <= port <= 65535:
        raise ValueError("Invalid loopback port")
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 5:
        raise ValueError("Invalid client deadline")
    if type(pins) is not tuple or len(pins) != 2 or not all(_token(pin) for pin in pins):
        raise ValueError("Explicit model and calibration pins required")
    selected = [case for case in data["cases"] if case["split"] == split]
    if not selected:
        raise ValueError("Selected split is empty")
    results, stopped = [], False
    for case in selected:
        result = {key: case[key] for key in ("id", "task", "language", "category")}
        result["outcome"] = "not_run"
        if not stopped:
            request = _request(case, str(uuid4()))
            started = time.perf_counter()
            outcome, value, http_status = _exchange(request, port=port, timeout=timeout, pins=pins)
            result.update(outcome=outcome, elapsedMs=round((time.perf_counter() - started) * 1000, 2))
            if http_status is not None:
                result["httpStatus"] = http_status
            if value is None:
                stopped = True
            else:
                correct = (value["abstain"] if case["expected"] is None else
                           not value["abstain"] and value["choiceId"] == case["expected"])
                result.update(choiceId=value["choiceId"], rawScore=value["rawScore"],
                              abstain=value["abstain"], correct=correct)
        results.append(result)
    groups = sorted({case["task"] + "/" + case["language"] for case in results})
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=True,
                                      allow_nan=False, separators=(",", ":")).encode("ascii")).hexdigest()
    return {"schemaVersion": 1, "corpusVersion": data["version"], "corpusSha256": digest,
            "split": split, "modelVersion": pins[0], "calibrationVersion": pins[1],
            "clientDeadlineMs": timeout * 1000, "complete": not stopped,
            "activationApproved": False, "summary": _metrics(results),
            "byTaskLanguage": {group: _metrics([case for case in results if
                               case["task"] + "/" + case["language"] == group]) for group in groups},
            "cases": results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, default=Path(__file__).with_name("synthetic-v1.json"))
    parser.add_argument("--split", choices=sorted(_SPLITS), required=True)
    parser.add_argument("--model-version", required=True)
    parser.add_argument("--calibration-version", required=True)
    args = parser.parse_args()
    try:
        report = evaluate(load_corpus(args.corpus), split=args.split,
                          pins=(args.model_version, args.calibration_version))
    except (OSError, ValueError):
        parser.exit(2, "Evaluation configuration is invalid; no activation was performed.\n")
    print(json.dumps(report, ensure_ascii=True, allow_nan=False, indent=2))
    # A fully executed but inaccurate run is not a passing evaluation.
    return 0 if report["complete"] and report["summary"]["accuracy"] == 1 else 1


if __name__ == "__main__":
    raise SystemExit(main())
