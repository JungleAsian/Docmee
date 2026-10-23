"""Same-sandbox native probe accepting only the shipped synthetic replay turns."""
from pathlib import Path
import signal
import stat
import sys


RELEASE = Path("/opt/docmee-laya/releases/release-20261022-a")
DIAGNOSTIC = Path("/opt/docmee-laya/diagnostics/descriptions-20261023-a")
VARIANTS = {"baseline": "descriptions-baseline-unqualified-v1",
            "distinct": "descriptions-distinct-unqualified-v1"}


def configure_framing():
    global DIAGNOSTIC, VARIANTS
    DIAGNOSTIC = Path('/opt/docmee-laya/diagnostics/framing-20261023-a')
    VARIANTS = {'json': 'framing-json-unqualified-v1', 'text': 'framing-text-unqualified-v1'}


def experiment_requests(variant, *, framing=False):
    from conversations import description_corpus, framing_corpus
    corpus = framing_corpus if framing else description_corpus
    return [{"schemaVersion": 1, "requestId": "probe",
             **{key: case[key] for key in ("task", "language", "text", "candidates")}}
            for split in ("calibration", "heldout")
            for case in corpus(split, variant)["cases"]]


def agent_factory(base, variant, *, framing=False):
    from plaintext_variant import CurrentTurnAgent, LanguagePreservingAgent
    if framing:
        if variant == 'json':
            return base
        if variant == 'text':
            return lambda **kwargs: LanguagePreservingAgent(base(**kwargs))
        raise ValueError('invalid framing experiment')
    if variant not in ('baseline', 'distinct'):
        raise ValueError('invalid description experiment')
    return lambda **kwargs: CurrentTurnAgent(base(**kwargs))


def main():
    global DIAGNOSTIC
    timing = len(sys.argv) == 3 and sys.argv[2] == 'timing'
    framing = len(sys.argv) == 3 and sys.argv[2] == 'framing'
    if framing:
        configure_framing()
    if timing:
        DIAGNOSTIC = Path('/opt/docmee-laya/diagnostics/timing-20261023-b')
    if (sys.platform != "linux" or not sys.flags.isolated or not sys.flags.dont_write_bytecode or
            len(sys.argv) != (3 if timing or framing else 2) or sys.argv[1] not in VARIANTS or
            (timing and sys.argv[1] != 'baseline') or
            Path(__file__).absolute() != DIAGNOSTIC / "conversation_probe.py"):
        return 1
    evaluation_dir = DIAGNOSTIC / "laya-evaluation"
    sources = [DIAGNOSTIC / "conversation_probe.py",
               *[evaluation_dir / name for name in
                 ("conversations.py", "evaluate.py", "native_probe.py", "plaintext_variant.py")],
               DIAGNOSTIC / "laya-runtime/protocol.py",
               *[RELEASE / "runtime" / name for name in ("server.py", "protocol.py", "backend.py", "artifacts.py")]]
    if timing:
        sources.append(evaluation_dir / 'timing.py')
    paths = set(sources)
    for path in sources:
        paths.update(path.parents)
    for path in paths:
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or metadata.st_mode & 0o022:
            return 1
    sys.path.insert(0, str(RELEASE / "runtime"))
    sys.path.insert(0, str(evaluation_dir))
    from server import Handler, RuntimeServer, adopt_systemd_socket
    from backend import PinnedBackend, _agent
    from native_probe import SyntheticOnlyBackend
    requests = experiment_requests(sys.argv[1], framing=framing)
    listener = adopt_systemd_socket()
    try:
        signal.signal(signal.SIGALRM, signal.SIG_DFL)
        signal.setitimer(signal.ITIMER_REAL, 60)
        factory = agent_factory(_agent, sys.argv[1], framing=framing)
        native = PinnedBackend(str(RELEASE / "model"), agent_factory=factory)
        native.calibration_version = VARIANTS[sys.argv[1]]
        if timing:
            from timing import TimedBackend, timing_handler
            native = TimedBackend(native)
        backend = SyntheticOnlyBackend(native, requests)
        with RuntimeServer(("127.0.0.1", 8767), backend, listener=listener, inference_timeout=4) as server:
            if timing:
                server.RequestHandlerClass = timing_handler(Handler, native)
            signal.setitimer(signal.ITIMER_REAL, 0)
            server.serve_forever(poll_interval=0.1)
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        listener.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
