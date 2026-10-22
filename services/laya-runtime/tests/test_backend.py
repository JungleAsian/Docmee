import copy
import hashlib
import importlib
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.artifacts = importlib.import_module('artifacts')
        self.backend = importlib.import_module('backend')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'encoder').mkdir()
        (self.root / 'encoder/config.json').write_bytes(b'abc')
        self.manifest = {'encoder/config.json': (3, hashlib.sha256(b'abc').hexdigest())}

    def test_closed_manifest(self):
        verify = self.artifacts.verify_artifacts
        verify(self.root, self.manifest)
        for data in (b'abd', b'abcd'):
            (self.root / 'encoder/config.json').write_bytes(data)
            with self.assertRaisesRegex(ValueError, '^artifact verification failed$'):
                verify(self.root, self.manifest)
        (self.root / 'encoder/config.json').unlink()
        with self.assertRaises(ValueError):
            verify(self.root, self.manifest)

    def test_reject_extra_paths_relative_and_traversal(self):
        for path in ('extra', 'empty'):
            extra = self.root / path
            extra.mkdir() if path == 'empty' else extra.write_bytes(b'x')
            with self.assertRaises(ValueError):
                self.artifacts.verify_artifacts(self.root, self.manifest)
            extra.rmdir() if extra.is_dir() else extra.unlink()
        with self.assertRaises(ValueError):
            self.artifacts.verify_artifacts(Path('.'), self.manifest)
        with self.assertRaises(ValueError):
            self.artifacts.verify_artifacts(self.root, {'../escape': (0, '')})

    def test_symlink_rejected(self):
        link = self.root / 'linked'
        try:
            link.symlink_to(self.root / 'encoder', target_is_directory=True)
        except OSError:
            self.skipTest('Windows symlink privilege unavailable')
        with self.assertRaises(ValueError):
            self.artifacts.verify_artifacts(self.root, self.manifest)

    def test_reparse_point_rejected_without_windows_privilege(self):
        from types import SimpleNamespace
        with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o40755, st_file_attributes=0x400)):
            with self.assertRaises(ValueError):
                self.artifacts.verify_artifacts(self.root, self.manifest)

    def test_production_loader_rejects_small_manifest_before_agent(self):
        def forbidden(**kwargs):
            self.fail('agent must not load an unpinned artifact tree')
        with self.assertRaisesRegex(ValueError, '^backend unavailable$'):
            self.load(forbidden)

    def test_actual_post_load_mutation_rejected(self):
        def mutate(**kwargs):
            (self.root / 'encoder/config.json').write_bytes(b'abd')
            return object()
        with patch.object(self.backend, 'verify_artifacts',
                          side_effect=lambda path: self.artifacts.verify_artifacts(path, self.manifest)):
            with self.assertRaisesRegex(ValueError, '^backend unavailable$'):
                self.load(mutate)

    def request(self, task='administrative_intent'):
        return {'schemaVersion': 1, 'requestId': '11111111-1111-4111-8111-111111111111',
                'task': task, 'language': 'en', 'text': 'synthetic input',
                'candidates': [{'id': 'real/id A', 'label': 'first'}, {'id': 'second', 'label': 'second'}]}

    def result(self):
        return {'model': 'laya-rl-agent', 'answers': {'decision': {'type': 'choice',
                'choice': 'option_1', 'probabilities': {'option_0': .2, 'option_1': .8},
                'confidence': .99, 'answer_confidence': .98, 'action': {'act_probability': .1}}},
                'usage': {'input_tokens': 20, 'output_tokens': 0, 'state_tokens': 3,
                          'state_tokens_dropped': 0, 'truncated': False, 'truncated_questions': []}}

    def load(self, factory, version='0.4.8'):
        return self.backend.PinnedBackend(self.root, agent_factory=factory,
            version_reader=lambda name: version, torch_loader=lambda: self.torch,
            )

    @property
    def torch(self):
        class Torch:
            def set_num_threads(self, n):
                assert n == 1
            def set_num_interop_threads(self, n):
                assert n == 1
        return Torch()

    def test_loader_offline_configuration_and_double_verification(self):
        calls = []
        def verify(path):
            calls.append('verify')
        def factory(**kwargs):
            calls.append('load')
            self.assertEqual(kwargs['device'], 'cpu')
            self.assertEqual(kwargs['backend'], 'eager')
            self.assertFalse(kwargs['fast'])
            self.assertFalse(kwargs['compile'])
            self.assertEqual(kwargs['model_id_or_path'], str(self.root))
            for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY'):
                self.assertEqual(os.environ[key], '1')
            self.assertEqual(os.environ['TOKENIZERS_PARALLELISM'], 'false')
            return object()
        with patch.object(self.backend, 'verify_artifacts', side_effect=verify):
            loaded = self.load(factory)
        self.assertTrue(loaded.ready)
        self.assertEqual(calls, ['verify', 'load', 'verify'])

    def test_version_mutation_and_constructor_errors_redacted(self):
        for version, side_effect in [('0.4.7', None), ('0.4.8', [None, ValueError('secret')])]:
            with patch.object(self.backend, 'verify_artifacts', side_effect=side_effect):
                with self.assertRaisesRegex(ValueError, '^backend unavailable$'):
                    self.load(lambda **kw: object(), version)
        with patch.object(self.backend, 'verify_artifacts'):
            def fail(**kwargs):
                print('secret')
                print('secret', file=sys.stderr)
                raise RuntimeError('secret')
            out, err = io.StringIO(), io.StringIO()
            with redirect_stdout(out), redirect_stderr(err):
                with self.assertRaisesRegex(ValueError, '^backend unavailable$'):
                    self.load(fail)
            self.assertEqual(out.getvalue() + err.getvalue(), '')

    def decide(self, result, request=None):
        outer = self
        class Agent:
            def system_one(self, state, questions):
                outer.assertEqual(set(questions), {'decision'})
                outer.assertEqual(questions['decision']['type'], 'choice')
                outer.assertEqual(set(questions['decision']['criteria']), {'option_0', 'option_1'})
                if isinstance(result, Exception):
                    print('secret')
                    raise result
                return copy.deepcopy(result)
        with patch.object(self.backend, 'verify_artifacts'):
            loaded = self.load(lambda **kw: Agent())
        return loaded.decide(request or self.request())

    def test_tasks_id_mapping_and_raw_probability(self):
        for task in ('administrative_intent', 'workflow_branch', 'kb_relevance'):
            response = self.decide(self.result(), self.request(task))
            self.assertEqual(response['choiceId'], 'second')
            self.assertEqual(response['rawScore'], .8)
            self.assertFalse(response['abstain'])
            self.assertEqual(response['requestId'], self.request()['requestId'])
            self.assertEqual(response['modelVersion'], 'laya-multilingual-e4e9ddf21a7b')
            self.assertEqual(response['calibrationVersion'], 'upstream-unqualified-v1')

    def test_malformed_truncated_collapsed_abstain(self):
        cases = [None, {}, {'answers': {}}, RuntimeError('secret')]
        for value in (True, float('nan'), float('inf'), -1, 1.1, '0.8'):
            result = self.result()
            result['answers']['decision']['probabilities']['option_1'] = value
            cases.append(result)
        for field, value in [('choice', 'unknown'), ('probabilities', {'option_1': 1}),
                             ('probabilities', {'option_0': .8, 'option_1': .8})]:
            result = self.result()
            result['answers']['decision'][field] = value
            cases.append(result)
        for field, value in [('truncated', True), ('state_tokens_dropped', 1),
                             ('truncated_questions', ['decision']),
                             ('options', {'decision': {'total': 2, 'distinct': 1, 'tokens_per_option': 0}})]:
            result = self.result()
            result['usage'][field] = value
            cases.append(result)
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            for result in cases:
                response = self.decide(result)
                self.assertTrue(response['abstain'])
                self.assertIsNone(response['choiceId'])
                self.assertEqual(response['rawScore'], 0)
        self.assertEqual(out.getvalue() + err.getvalue(), '')

    def test_explicit_invalid_cli_exits_generic(self):
        result = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / 'server.py'),
                                 '--artifact-dir', str(self.root)], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, 'backend unavailable\n')


if __name__ == '__main__':
    unittest.main()
