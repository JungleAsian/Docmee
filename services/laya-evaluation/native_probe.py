"""Temporary same-sandbox calibration probe, never a production entrypoint."""
import hashlib
import json
from pathlib import Path
import signal
import stat
import sys


RELEASE = Path("/opt/docmee-laya/releases/release-20261022-a")
DIAGNOSTIC = Path("/opt/docmee-laya/diagnostics/calibration-20261022-a")
CORPUS_SHA256 = "037b292c9d9e432ddaed364ee948e99889fc01cc4722f91a1377341870090afc"


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False,
                      separators=(",", ":")).encode("ascii")


def calibration_requests(data):
    # Fixed, reviewed synthetic corpus only; expected answers never reach backend.
    if hashlib.sha256(canonical(data)).hexdigest() != CORPUS_SHA256:
        raise ValueError("reviewed corpus required")
    return [{"schemaVersion": 1, "requestId": "probe",
             **{key: case[key] for key in ("task", "language", "text", "candidates")}}
            for case in data["cases"] if case["split"] == "calibration"]


class SyntheticOnlyBackend:
    def __init__(self, backend, requests):
        self._backend = backend
        self._allowed = frozenset(self._key(request) for request in requests)
        self.model_version = backend.model_version
        self.calibration_version = backend.calibration_version

    @property
    def ready(self):
        return self._backend.ready

    @staticmethod
    def _key(request):
        return canonical({key: value for key, value in request.items() if key != "requestId"})

    def decide(self, request):
        if self._key(request) not in self._allowed:
            raise ValueError("synthetic input required")
        return self._backend.decide(request)


def main():
    if (sys.platform != "linux" or not sys.flags.isolated or
            not sys.flags.dont_write_bytecode or sys.argv[1:] or
            Path(__file__).absolute() != DIAGNOSTIC / "native_probe.py"):
        return 1
    sources = [RELEASE / "runtime" / name for name in
               ("server.py", "protocol.py", "backend.py", "artifacts.py")]
    paths = {DIAGNOSTIC / "native_probe.py", DIAGNOSTIC / "synthetic-v1.json", *sources}
    for path in tuple(paths):
        paths.update(path.parents)
    try:
        for path in paths:
            metadata = path.lstat()
            if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
                return 1
        body = (DIAGNOSTIC / "synthetic-v1.json").read_bytes()
        if len(body) > 256 * 1024:
            return 1
        requests = calibration_requests(json.loads(body))
    except (OSError, ValueError, TypeError, KeyError):
        return 1
    sys.path.insert(0, str(RELEASE / "runtime"))
    from server import RuntimeServer, adopt_systemd_socket
    from backend import PinnedBackend
    listener = adopt_systemd_socket()
    try:
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.setitimer(signal.ITIMER_REAL, 60)
        backend = SyntheticOnlyBackend(PinnedBackend(str(RELEASE / "model")), requests)
        # Observation window ONLY. Original immutable entry keeps its 750 ms limit.
        with RuntimeServer(("127.0.0.1", 8767), backend, listener=listener,
                           inference_timeout=4) as server:
            signal.setitimer(signal.ITIMER_REAL, 0)
            server.serve_forever(poll_interval=0.1)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        listener.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
