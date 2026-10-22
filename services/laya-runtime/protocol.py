"""Strict, passage-free validation errors for the private LAYA wire contract."""
import json
import math
from uuid import UUID

REQUEST_KEYS = {"schemaVersion", "requestId", "task", "language", "text", "candidates"}
RESPONSE_KEYS = {"schemaVersion", "requestId", "modelVersion", "calibrationVersion", "choiceId", "rawScore", "abstain"}
TASKS = {"administrative_intent", "workflow_branch", "kb_relevance"}
LANGUAGES = {"en", "es", "mixed", "unknown"}


class Invalid(ValueError):
    """Carries no input, model text or identifiers."""


def units(value):
    return len(value.encode("utf-16-le", errors="surrogatepass")) // 2


def bounded(value, limit):
    # ECMAScript trim includes BOM, but not Python-only control separators.
    whitespace = "\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
    return isinstance(value, str) and bool(value.strip(whitespace)) and units(value) <= limit


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Invalid()
        result[key] = value
    return result


def _constant(_value):
    raise Invalid()


def parse_request(body):
    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_constant)
        validate_request(value)
        return value
    except (ValueError, UnicodeError, TypeError, RecursionError, OverflowError):
        raise Invalid() from None


def validate_request(value):
    if type(value) is not dict or value.keys() != REQUEST_KEYS:
        raise Invalid()
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise Invalid()
    request_id = value["requestId"]
    if not isinstance(request_id, str) or str(UUID(request_id)) != request_id:
        raise Invalid()
    if not isinstance(value["task"], str) or value["task"] not in TASKS:
        raise Invalid()
    if not isinstance(value["language"], str) or value["language"] not in LANGUAGES:
        raise Invalid()
    if not bounded(value["text"], 1600):
        raise Invalid()
    candidates = value["candidates"]
    if type(candidates) is not list or not 1 <= len(candidates) <= 7:
        raise Invalid()
    ids = set()
    total = units(value["text"])
    for candidate in candidates:
        if type(candidate) is not dict or candidate.keys() != {"id", "label"}:
            raise Invalid()
        if not bounded(candidate["id"], 128) or not bounded(candidate["label"], 1200):
            raise Invalid()
        if candidate["id"] in ids:
            raise Invalid()
        ids.add(candidate["id"])
        total += units(candidate["id"]) + units(candidate["label"])
    if total > 6000:
        raise Invalid()


def encode_response(value, request_id, candidate_ids, pins):
    if type(value) is not dict or value.keys() != RESPONSE_KEYS:
        raise Invalid()
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1:
        raise Invalid()
    if value["requestId"] != request_id or (value["modelVersion"], value["calibrationVersion"]) != pins:
        raise Invalid()
    score = value["rawScore"]
    if type(score) not in (int, float) or not math.isfinite(score) or not 0 <= score <= 1:
        raise Invalid()
    if type(value["abstain"]) is not bool:
        raise Invalid()
    choice = value["choiceId"]
    if choice is None:
        if not value["abstain"]:
            raise Invalid()
    elif not isinstance(choice, str) or choice not in candidate_ids:
        raise Invalid()
    # ensure_ascii also safely encodes lone UTF-16 surrogates accepted by JS.
    body = json.dumps(value, ensure_ascii=True, allow_nan=False, separators=(",", ":")).encode("ascii")
    if len(body) > 8192:
        raise Invalid()
    return body
