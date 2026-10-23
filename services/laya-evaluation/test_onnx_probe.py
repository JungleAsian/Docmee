"""Experiment configuration tests, not native ONNX execution evidence."""
import importlib.util
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


def load():
    spec = importlib.util.spec_from_file_location('onnx_probe', Path(__file__).with_name('onnx_probe.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProbeTests(unittest.TestCase):
    def test_native_execution_requires_external_isolated_linux_operator(self):
        module = load()
        with patch.object(module.sys, 'platform', 'win32'), self.assertRaisesRegex(ValueError, 'isolated Linux operator required'):
            module.run_comparison('/model', '/experiment')

    def test_synthetic_cases_are_deterministic_bounded_and_cover_padding(self):
        module = load()
        cases = module.synthetic_cases()
        self.assertEqual(cases, module.synthetic_cases())
        self.assertEqual(len(cases), 3)
        self.assertEqual({len(case['input_ids']) for case in cases}, {1, 2, 3})
        self.assertEqual({len(case['input_ids'][0]) for case in cases}, {17, 53, 97})
        self.assertEqual({len(case['marker_pos'][0]) for case in cases}, {3, 5, 7})
        self.assertEqual({q for case in cases for q in case['qtype']}, {0, 1, 2})
        self.assertTrue(any(not value for case in cases for row in case['marker_mask'] for value in row))
        self.assertTrue(any(not value for case in cases for row in case['attention_mask'] for value in row))
        for case in cases:
            for ids, attention, positions, mask in zip(case['input_ids'], case['attention_mask'],
                                                      case['marker_pos'], case['marker_mask']):
                self.assertTrue(all(5 <= value < 1000 for value in ids))
                self.assertTrue(all(attention[pos] == 1 for pos, valid in zip(positions, mask) if valid))

    def test_export_uses_fp32_legacy_dynamic_axes_not_implicit_dynamo(self):
        config = load().export_arguments()
        self.assertIs(config['dynamo'], False)
        self.assertIs(config['external_data'], False)
        self.assertEqual(config['opset_version'], 18)
        self.assertEqual(config['output_names'], ['logits', 'act_logits'])
        self.assertEqual(config['dynamic_axes']['input_ids'], {0: 'batch_size', 1: 'seq_len'})
        self.assertEqual(config['dynamic_axes']['marker_mask'], {0: 'batch_size', 1: 'num_markers'})
        self.assertEqual(config['dynamic_axes']['act_logits'], {0: 'batch_size'})

    def test_ort_configuration_is_cpu_sequential_single_thread(self):
        options = SimpleNamespace()
        ort = SimpleNamespace(SessionOptions=lambda: options,
                              ExecutionMode=SimpleNamespace(ORT_SEQUENTIAL='sequential'),
                              GraphOptimizationLevel=SimpleNamespace(ORT_ENABLE_ALL='all'))
        self.assertIs(load().session_options(ort), options)
        self.assertEqual(options.intra_op_num_threads, 1)
        self.assertEqual(options.inter_op_num_threads, 1)
        self.assertEqual(options.execution_mode, 'sequential')

    def test_output_directory_is_new_and_cannot_replace_model_or_existing_artifacts(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            model = root / 'model'
            model.mkdir()
            output = root / 'experiment'
            module.prepare_output_directory(model, output)
            self.assertTrue(output.is_dir())
            for forbidden in (output, model, model / 'child', root, Path('relative')):
                with self.subTest(path=forbidden), self.assertRaises(ValueError):
                    module.prepare_output_directory(model, forbidden)
            self.assertEqual(list(model.iterdir()), [])

    def test_symlink_parent_output_is_rejected_when_supported(self):
        module = load()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            model = root / 'model'
            model.mkdir()
            link = root / 'link'
            try:
                link.symlink_to(root, target_is_directory=True)
            except OSError:
                self.skipTest('symlink creation unavailable')
            with self.assertRaises(ValueError):
                module.prepare_output_directory(model, link / 'experiment')


if __name__ == '__main__':
    unittest.main()
