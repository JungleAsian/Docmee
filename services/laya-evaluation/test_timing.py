"""Synthetic profiling stays numeric, bounded, and outside patient routing."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import http.client
import sys
import threading
import unittest
from unittest.mock import patch


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TimingTests(unittest.TestCase):
    def test_profiler_exists(self):
        self.assertTrue(Path(__file__).with_name('timing.py').exists(), 'numeric timing profiler missing')

    def test_profile_preserves_result_and_never_emits_input_or_error_text(self):
        timing = load('timing')
        class Backend:
            model_version, calibration_version, ready = 'model', 'calibration', True
            def decide(self, request):
                if request['fail']:
                    raise ValueError('PRIVATE ERROR')
                return {'answer': 'PRIVATE RESULT'}
        backend = timing.TimedBackend(Backend())
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            self.assertEqual(backend.decide({'fail': False, 'text': 'PRIVATE INPUT'}), {'answer': 'PRIVATE RESULT'})
            with self.assertRaises(ValueError):
                backend.decide({'fail': True, 'text': 'PRIVATE INPUT'})
        self.assertEqual(output.getvalue(), '')
        records = backend.snapshot()
        self.assertNotIn('PRIVATE', json.dumps(records))
        self.assertEqual([r['sequence'] for r in records], [1, 2])
        self.assertEqual([r['completed'] for r in records], [True, False])
        self.assertTrue(all(r['wallMs'] >= 0 and r['cpuMs'] >= 0 for r in records))
        self.assertTrue(backend.ready)
        self.assertEqual(backend.model_version, 'model')

    def test_snapshot_is_copied_and_requests_are_bounded_before_native_work(self):
        timing = load('timing')
        class Backend:
            model_version, calibration_version, ready = 'model', 'calibration', True
            calls = 0
            def decide(self, request):
                self.calls += 1
                return {}
        native = Backend()
        backend = timing.TimedBackend(native)
        for _ in range(36):
            backend.decide({})
        snapshot = backend.snapshot()
        snapshot[0]['stages']['PRIVATE'] = {}
        self.assertNotIn('PRIVATE', json.dumps(backend.snapshot()))
        with self.assertRaises(ValueError):
            backend.decide({})
        self.assertEqual(native.calls, 36)
        self.assertEqual(len(backend.snapshot()), 36)

    def test_diagnostic_health_reuses_real_parser_and_preserves_other_routes(self):
        timing = load('timing')
        runtime = Path(__file__).parents[1] / 'laya-runtime'
        with patch.object(sys, 'path', [str(runtime), *sys.path]):
            server_module = load_runtime_server(runtime)
        class Backend:
            model_version, calibration_version, ready = 'model', 'calibration', True
            def decide(self, request):
                return {}
        backend = timing.TimedBackend(Backend())
        with server_module.RuntimeServer(('127.0.0.1', 0), backend) as server:
            server.RequestHandlerClass = timing.timing_handler(server_module.Handler, backend)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            try:
                for method, path, expected in [('GET', '/health', 200), ('GET', '/ready', 200),
                                               ('GET', '/health?private=1', 404),
                                               ('POST', '/health', 405), ('GET', '/timing', 404)]:
                    connection = http.client.HTTPConnection(*server.server_address, timeout=2)
                    try:
                        connection.request(method, path)
                        response = connection.getresponse()
                        body = json.loads(response.read())
                        self.assertEqual(response.status, expected)
                        if path == '/health' and method == 'GET':
                            self.assertEqual(body, {'status': 'alive', 'timing': []})
                        elif path == '/ready':
                            self.assertEqual(body, {'status': 'ready'})
                        else:
                            self.assertNotIn('timing', body)
                    finally:
                        connection.close()
            finally:
                server.shutdown()
                worker.join(timeout=2)

    def test_collector_uses_bounded_health_not_journal(self):
        operator = load('run_server_conversations')
        records = [{'sequence': i, 'completed': True, 'wallMs': 1, 'cpuMs': 1, 'stages': {}}
                   for i in range(1, 37)]
        with patch.object(operator, 'request', return_value=(200, {'status': 'alive', 'timing': records})) as request:
            self.assertEqual(operator.timing_records(), records)
            request.assert_called_once_with(8767, '/health', maximum=65536)
        for bad in [records[:-1], [{**r, 'cpuMs': float('nan')} for r in records],
                    [{**r, 'PRIVATE': 'text'} for r in records]]:
            with patch.object(operator, 'request', return_value=(200, {'status': 'alive', 'timing': bad})):
                with self.assertRaises(AssertionError):
                    operator.timing_records()

    def test_stage_allowlist_excludes_arbitrary_functions_and_paths(self):
        timing = load('timing')
        rows = timing.stage_metrics({
            ('/private/laya/agent.py', 10, '_forward'): (1, 1, .01, .10, {}),
            ('/private/laya/common.py', 12, 'collate_items'): (1, 1, .02, .03, {}),
            ('/private/transformers/tokenization_utils_fast.py', 13, '_batch_encode_plus'): (1, 1, .03, .04, {}),
            ('/secret/patient.py', 14, 'PRIVATE'): (1, 1, 99, 99, {}),
        })
        self.assertEqual(set(rows), {'agent._forward', 'common.collate_items', 'tokenizer._batch_encode_plus'})
        self.assertEqual(rows['agent._forward']['cumulativeMs'], 100)
        self.assertNotIn('/private', json.dumps(rows))

    def test_timing_operator_uses_baseline_only_and_fresh_directory(self):
        operator = load('run_server_conversations')
        operator.configure_timing()
        self.assertEqual(operator.DIAGNOSTIC.name, 'timing-20261023-b')
        self.assertEqual(operator.VARIANTS, (('baseline', 'descriptions-baseline-unqualified-v1'),))
        self.assertIn('timing.py', operator.ASSET_NAMES)
        self.assertIn('StandardOutput,StandardError', operator.PROPS)

    def test_console_summary_is_bounded_and_keeps_full_records_out(self):
        operator = load('run_server_conversations')
        records = [{'sequence': i, 'completed': True, 'wallMs': i * 10,
                    'cpuMs': i * 9, 'stages': {'agent._forward': {
                        'calls': 1, 'selfMs': 1, 'cumulativeMs': i * 8}}}
                   for i in range(1, 37)]
        summary = operator.timing_summary(records)
        self.assertEqual(summary['count'], 36)
        self.assertEqual(summary['wallMs']['median'], 185)
        self.assertEqual(summary['stages']['agent._forward']['meanMs'], 148)
        self.assertNotIn('records', summary)
        self.assertLess(len(json.dumps(summary)), 4000)


def load_runtime_server(runtime):
    spec = importlib.util.spec_from_file_location('timing_test_server', runtime / 'server.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == '__main__':
    unittest.main()
