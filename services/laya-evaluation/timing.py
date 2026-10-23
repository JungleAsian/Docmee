"""Numeric-only synthetic timing; cumulative stages overlap and must not be summed."""
import cProfile
import copy
import json
import threading
import time

AGENT = {'system_one', 'predict_batch', '_infer', '_forward', '_forward_in_chunks'}
TOKENIZER = {'__call__', '_call_one', '_batch_encode_plus', '_encode_plus'}


def stage_metrics(stats):
    result = {}
    for (filename, _, name), (_, calls, own, cumulative, _) in stats.items():
        filename = filename.replace('\\', '/')
        stage = None
        if filename.endswith('/laya/agent.py') and name in AGENT:
            stage = 'agent.' + name
        elif filename.endswith('/laya/common.py') and name in {'collate_items', 'forward'}:
            stage = 'common.' + name
        elif '/transformers/tokenization_utils' in filename and name in TOKENIZER:
            stage = 'tokenizer.' + name
        if stage:
            row = result.setdefault(stage, {'calls': 0, 'selfMs': 0, 'cumulativeMs': 0})
            row['calls'] += calls
            row['selfMs'] += own * 1000
            row['cumulativeMs'] += cumulative * 1000
    return result


class TimedBackend:
    def __init__(self, backend):
        self._backend, self._sequence = backend, 0
        self._records, self._lock = [], threading.Lock()
        self.model_version = backend.model_version
        self.calibration_version = backend.calibration_version

    @property
    def ready(self):
        return self._backend.ready

    def snapshot(self):
        with self._lock:
            return copy.deepcopy(sorted(self._records, key=lambda row: row['sequence']))

    def decide(self, request):
        with self._lock:
            if self._sequence >= 36:
                raise ValueError('synthetic_profile_limit')
            self._sequence += 1
            sequence = self._sequence
        profiler, completed = cProfile.Profile(), False
        wall, cpu = time.perf_counter(), time.process_time()
        profiler.enable()
        try:
            result = self._backend.decide(request)
            completed = True
            return result
        finally:
            profiler.disable()
            wall_ms, cpu_ms = (time.perf_counter() - wall) * 1000, (time.process_time() - cpu) * 1000
            profiler.create_stats()
            record = {'sequence': sequence, 'completed': completed, 'wallMs': wall_ms,
                      'cpuMs': cpu_ms, 'stages': stage_metrics(profiler.stats)}
            with self._lock:
                self._records.append(record)


def timing_handler(base_handler, backend):
    """Diagnostic-only extension AFTER the unmodified production HTTP parser."""
    class TimingHandler(base_handler):
        def _dispatch(self):
            status, body = super()._dispatch()
            if status == 200 and body == b'{"status":"alive"}':
                body = json.dumps({'status': 'alive', 'timing': backend.snapshot()},
                                  allow_nan=False, separators=(',', ':')).encode('ascii')
            return status, body
    return TimingHandler
