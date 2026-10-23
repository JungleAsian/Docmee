"""Fault injection for restoration: one failed operation must not skip recovery."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('operator_runner', Path(__file__).with_name('run_server_conversations.py'))
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)
probe_spec = importlib.util.spec_from_file_location('conversation_probe', Path(__file__).with_name('conversation_probe.py'))
probe = importlib.util.module_from_spec(probe_spec)
probe_spec.loader.exec_module(probe)


class DescriptionExperimentTests(unittest.TestCase):
    def test_operator_and_probe_share_fresh_target_and_version_pins(self):
        self.assertEqual(operator.DIAGNOSTIC, probe.DIAGNOSTIC)
        self.assertEqual(operator.DIAGNOSTIC.name, 'descriptions-20261023-a')
        self.assertEqual(dict(operator.VARIANTS), probe.VARIANTS)
        self.assertEqual(set(probe.VARIANTS), {'baseline', 'distinct'})

    def test_probe_allows_only_its_own_36_synthetic_requests_without_expected(self):
        import sys
        with patch.object(sys, 'path', [str(Path(__file__).parent), *sys.path]):
            baseline = probe.experiment_requests('baseline')
            distinct = probe.experiment_requests('distinct')
            self.assertEqual(len(baseline), 36)
            self.assertEqual(len(distinct), 36)
            for left, right in zip(baseline, distinct):
                self.assertNotIn('expected', left)
                self.assertEqual({k: v for k, v in left.items() if k != 'candidates'},
                                 {k: v for k, v in right.items() if k != 'candidates'})
                self.assertNotEqual(left['candidates'], right['candidates'])
            with self.assertRaises(ValueError):
                probe.experiment_requests('plaintext')


class RestorationTests(unittest.TestCase):
    def test_restoration_requires_live_original_process_not_configured_execstart(self):
        state = {'ActiveState': 'active', 'MainPID': '123'}
        original = [str(operator.RELEASE / 'venv/bin/python'), '-I', '-B',
                    str(operator.RELEASE / 'isolation/entrypoint.py')]
        with patch.object(Path, 'read_bytes', return_value=('\0'.join(original) + '\0').encode()):
            operator.verify_original_process(state)
            with self.assertRaises(AssertionError):
                operator.verify_original_process(state, {'123'})
        diagnostic = original[:-1] + [str(operator.DIAGNOSTIC / 'conversation_probe.py'), 'plaintext']
        with patch.object(Path, 'read_bytes', return_value=('\0'.join(diagnostic) + '\0').encode()):
            with self.assertRaises(AssertionError):
                operator.verify_original_process(state)

    def test_console_report_bounds_case_output_without_mutating_full_evidence(self):
        full = {'complete': True, 'summary': {'accuracy': 0.5}, 'cases': [
            {'id': 'correct', 'correct': True}, {'id': 'wrong', 'correct': False},
            {'id': 'not-run', 'correct': None}]}
        compact = operator.console_report(full)
        self.assertNotIn('cases', compact)
        self.assertEqual([case['id'] for case in compact['mismatches']], ['wrong', 'not-run'])
        self.assertEqual(len(full['cases']), 3)

    def test_termination_is_catchable_for_finally_recovery(self):
        with self.assertRaises(RuntimeError):
            operator.interrupted(15, None)

    def test_failed_reload_never_starts_cached_diagnostic_entrypoint(self):
        calls = []
        def command(*args):
            calls.append(args)
            if args[1] == 'daemon-reload':
                raise TimeoutError()
        with patch.object(operator, 'command', side_effect=command):
            failures = operator.restore_runtime(False)
        self.assertEqual(failures, ['reload:TimeoutError'])
        self.assertFalse(any(call[1] == 'start' for call in calls))

    def test_failed_stop_still_removes_override_reloads_and_starts_original(self):
        calls = []
        def command(*args):
            calls.append(args)
            if args[1] == 'stop':
                raise TimeoutError()
        drop, directory = Mock(), Mock()
        drop.exists.side_effect = [True, False]
        with patch.object(operator, 'command', side_effect=command), patch.object(operator, 'DROP', drop), patch.object(operator, 'DROP_DIR', directory):
            failures = operator.restore_runtime(True)
        drop.unlink.assert_called_once()
        directory.rmdir.assert_called_once()
        self.assertIn(('systemctl', 'daemon-reload'), calls)
        self.assertIn(('systemctl', 'start', 'docmee-laya.socket', 'docmee-laya.service'), calls)
        self.assertEqual(failures, ['stop:TimeoutError'])

    def test_directory_cleanup_failure_does_not_skip_original_restart(self):
        directory = Mock()
        directory.rmdir.side_effect = OSError()
        drop = Mock()
        drop.exists.side_effect = [True, False]
        with patch.object(operator, 'command') as command, patch.object(operator, 'DROP', drop), patch.object(operator, 'DROP_DIR', directory):
            failures = operator.restore_runtime(True)
        command.assert_any_call('systemctl', 'daemon-reload')
        command.assert_any_call('systemctl', 'start', 'docmee-laya.socket', 'docmee-laya.service')
        self.assertEqual(failures, ['remove_directory:OSError'])

    def test_failed_override_removal_never_starts_diagnostic_again(self):
        drop = Mock()
        drop.exists.return_value = True
        drop.unlink.side_effect = PermissionError()
        with patch.object(operator, 'command') as command, patch.object(operator, 'DROP', drop), patch.object(operator, 'DROP_DIR', Mock()):
            failures = operator.restore_runtime(True)
        self.assertTrue(failures)
        self.assertFalse(any(call.args[1] == 'start' for call in command.call_args_list))


class FramingExperimentTests(unittest.TestCase):
    def test_framing_mode_has_a_fresh_path_and_consistent_pins(self):
        with patch.object(operator, 'DIAGNOSTIC'), patch.object(operator, 'VARIANTS'), \
                patch.object(operator, 'FRAMING', False), patch.object(probe, 'DIAGNOSTIC'), \
                patch.object(probe, 'VARIANTS'):
            operator.configure_framing()
            probe.configure_framing()
            self.assertEqual(operator.DIAGNOSTIC.name, 'framing-20261023-a')
            self.assertEqual(operator.DIAGNOSTIC, probe.DIAGNOSTIC)
            self.assertEqual(dict(operator.VARIANTS), probe.VARIANTS)
            self.assertTrue(operator.FRAMING)

    def test_framing_allowlist_has_no_answers_and_is_identical_across_variants(self):
        import sys
        with patch.object(sys, 'path', [str(Path(__file__).parent), *sys.path]):
            left = probe.experiment_requests('json', framing=True)
            right = probe.experiment_requests('text', framing=True)
        self.assertEqual(left, right)
        self.assertEqual(len(left), 51)
        self.assertTrue(all(set(row) == {'schemaVersion', 'requestId', 'task', 'language', 'text', 'candidates'}
                            for row in left))

    def test_json_factory_is_unwrapped_and_text_retains_language_and_history(self):
        import sys
        with patch.object(sys, 'path', [str(Path(__file__).parent), *sys.path]):
            native = Mock()
            base = Mock(return_value=native)
            self.assertIs(probe.agent_factory(base, 'json', framing=True)(sentinel=True), native)
            base.assert_called_once_with(sentinel=True)
            wrapped = probe.agent_factory(base, 'text', framing=True)()
            self.assertIs(wrapped._native, native)
            self.assertEqual(wrapped.input_state({'patient_text': 'full history', 'language': 'es'}),
                             'Patient text:\nfull history\nLanguage: es')
            with self.assertRaises(ValueError):
                probe.agent_factory(base, 'baseline', framing=True)


if __name__ == '__main__':
    unittest.main()
