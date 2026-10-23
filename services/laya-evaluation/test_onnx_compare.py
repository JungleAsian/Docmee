"""Numerical parity must not silently excuse invalid outputs or choice changes."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest


def load():
    spec = importlib.util.spec_from_file_location('onnx_compare', Path(__file__).with_name('onnx_compare.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ParityTests(unittest.TestCase):
    def setUp(self):
        self.mask = [[True, True, False], [True, True, True]]
        self.eager = ([[1.0, 2.0, float('-inf')], [3.0, 1.0, 0.0]],
                      [[0.0, 1.0], [1.0, 0.0]])

    def test_module_exists(self):
        self.assertTrue(Path(__file__).with_name('onnx_compare.py').is_file(), 'parity implementation missing')

    def test_close_values_pass_without_serializing_logits(self):
        module = load()
        candidate = ([[1.0001, 2.0001, -1e9], [3.0001, 1.0, 0.0]],
                     [[0.0, 1.0001], [1.0001, 0.0]])
        result = module.compare_outputs(self.eager, candidate, self.mask)
        self.assertTrue(result['passed'])
        self.assertEqual(result['choiceChanges'], 0)
        self.assertEqual(result['actionChanges'], 0)
        self.assertEqual(result['validMarkers'], 5)
        self.assertAlmostEqual(result['logitsMaxAbsError'], .0001)
        self.assertEqual(set(result), {'passed', 'choiceChanges', 'actionChanges',
                                      'validMarkers', 'logitsMaxAbsError', 'actionMaxAbsError'})
        json.dumps(result, allow_nan=False)

    def test_small_choice_flip_fails_even_within_numeric_tolerance(self):
        module = load()
        result = module.compare_outputs(([[1.0, 1.0001]], [[0.0, 1.0]]),
                                        ([[1.0001, 1.0]], [[0.0, 1.0]]), [[True, True]])
        self.assertFalse(result['passed'])
        self.assertEqual(result['choiceChanges'], 1)

    def test_action_flip_and_large_drift_fail(self):
        module = load()
        for candidate in [([[1.0, 2.0, -1e9], [3.0, 1.0, 0.0]], [[1.0, 0.0], [1.0, 0.0]]),
                          ([[1.0, 2.1, -1e9], [3.0, 1.0, 0.0]], self.eager[1])]:
            with self.subTest(candidate=candidate):
                self.assertFalse(module.compare_outputs(self.eager, candidate, self.mask)['passed'])

    def test_bad_shapes_types_and_nonfinite_valid_values_are_rejected(self):
        module = load()
        for bad in [([], []), ([[1.0]], [[0.0, 1.0]]),
                    ([[1, 2, 3], [3, 1]], self.eager[1]),
                    ([[1, float('nan'), 0], [3, 1, 0]], self.eager[1]),
                    ([[1, float('inf'), 0], [3, 1, 0]], self.eager[1]),
                    ([[1, float('-inf'), 0], [3, 1, 0]], self.eager[1]),
                    ([[True, 2, 0], [3, 1, 0]], self.eager[1]),
                    ([[1, 2, 0], [3, 1, 0]], [[0, 1, 2], [1, 0, 2]]),
                    (self.eager[0], [[0, float('nan')], [1, 0]])]:
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, '^invalid numerical outputs$'):
                module.compare_outputs(self.eager, bad, self.mask)

    def test_empty_or_nonboolean_masks_fail_and_inputs_remain_unchanged(self):
        module = load()
        for mask in [[], [[False, False, False], [True, True, True]],
                     [[1, 1, 0], [1, 1, 1]], [[True, True], [True, True, True]]]:
            with self.subTest(mask=mask), self.assertRaises(ValueError):
                module.compare_outputs(self.eager, self.eager, mask)
        before = copy.deepcopy(self.eager)
        module.compare_outputs(self.eager, self.eager, self.mask)
        self.assertEqual(self.eager, before)

    def test_complete_report_keeps_latency_and_accuracy_claims_separate(self):
        module = load()
        parity = module.compare_outputs(self.eager, self.eager, self.mask)
        report = module.comparison_report([parity, parity], [1400.0, 1500.0], [600.0, 700.0])
        self.assertTrue(report['numericalParityPassed'])
        self.assertEqual(report['eagerMedianMs'], 1450.0)
        self.assertEqual(report['onnxMedianMs'], 650.0)
        self.assertAlmostEqual(report['medianSpeedup'], 1450 / 650)
        self.assertFalse(report['accuracyImprovementProven'])
        self.assertFalse(report['productionDeadlineQualified'])
        self.assertFalse(report['runtimePromotionApproved'])

    def test_partial_or_invalid_timing_cannot_produce_success_report(self):
        module = load()
        parity = module.compare_outputs(self.eager, self.eager, self.mask)
        for parities, eager, onnx in [([], [], []), ([parity], [1, 2], [1]),
                                     ([parity], [float('nan')], [1]),
                                     ([parity], [1], [0]), ([parity], [True], [1]),
                                     ([{'passed': True}], [1], [1])]:
            with self.subTest(eager=eager), self.assertRaises(ValueError):
                module.comparison_report(parities, eager, onnx)

    def test_overflowing_timing_summary_is_rejected(self):
        module = load()
        parity = module.compare_outputs(self.eager, self.eager, self.mask)
        with self.assertRaises(ValueError):
            module.comparison_report([parity, parity], [1.0, 1.0], [1e308, 1e308])

    def test_failed_parity_stays_failed_and_forged_summary_is_rejected(self):
        module = load()
        candidate = ([[1, 3, 0], [3, 1, 0]], self.eager[1])
        parity = module.compare_outputs(self.eager, candidate, self.mask)
        self.assertFalse(module.comparison_report([parity], [2], [1])['numericalParityPassed'])
        parity['passed'] = True
        with self.assertRaises(ValueError):
            module.comparison_report([parity], [2], [1])

    def test_masked_nan_positive_infinity_and_boolean_are_still_rejected(self):
        module = load()
        for value in (float('nan'), float('inf'), False):
            candidate = ([[1, 2, value], [3, 1, 0]], self.eager[1])
            with self.subTest(value=value), self.assertRaises(ValueError):
                module.compare_outputs(self.eager, candidate, self.mask)


if __name__ == '__main__':
    unittest.main()
