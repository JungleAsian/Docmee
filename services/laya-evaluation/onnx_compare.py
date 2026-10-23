"""Dependency-free, fail-closed summaries for an isolated FP32 parity experiment.

Tolerances follow the upstream raw-output tests, not a clinical accuracy target.
Inputs and raw logits never appear in the report.
"""
import math
from statistics import median


LOGITS_ATOL = 1e-3
ACTION_ATOL = 1e-2
MAX_CASES = 256
MAX_BATCH = 16
MAX_MARKERS = 64
_KEYS = {'passed', 'choiceChanges', 'actionChanges', 'validMarkers',
         'logitsMaxAbsError', 'actionMaxAbsError'}


def _fail():
    raise ValueError('invalid numerical outputs')


def _sequence(value):
    return type(value) in (list, tuple)


def _finite(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _shape(outputs, mask):
    if not _sequence(outputs) or len(outputs) != 2:
        _fail()
    logits, actions = outputs
    if (not _sequence(logits) or not _sequence(actions)
            or len(logits) != len(mask) or len(actions) != len(mask)):
        _fail()
    for row, action, row_mask in zip(logits, actions, mask):
        if (not _sequence(row) or len(row) != len(row_mask)
                or not _sequence(action) or len(action) != 2):
            _fail()
        for value, valid in zip(row, row_mask):
            # Negative infinity is the usual masked padding value. All valid
            # markers and all action outputs must be finite, never booleans.
            if not _finite(value) and not (not valid and type(value) is float and value == -math.inf):
                _fail()
        if not all(_finite(value) for value in action):
            _fail()


def compare_outputs(eager, candidate, mask):
    """Require numeric parity AND identical winning marker/action per row."""
    if not _sequence(mask) or not 1 <= len(mask) <= MAX_BATCH:
        _fail()
    width = None
    for row in mask:
        if (not _sequence(row) or not 1 <= len(row) <= MAX_MARKERS
                or not all(type(value) is bool for value in row) or not any(row)):
            _fail()
        if width is not None and len(row) != width:
            _fail()
        width = len(row)
    _shape(eager, mask)
    _shape(candidate, mask)
    choice_changes = action_changes = valid_markers = 0
    logits_error = action_error = 0.0
    for index, row_mask in enumerate(mask):
        valid = [i for i, enabled in enumerate(row_mask) if enabled]
        valid_markers += len(valid)
        choice_changes += (max(valid, key=lambda i: eager[0][index][i])
                           != max(valid, key=lambda i: candidate[0][index][i]))
        action_changes += (max(range(2), key=lambda i: eager[1][index][i])
                           != max(range(2), key=lambda i: candidate[1][index][i]))
        logits_error = max(logits_error, *(abs(eager[0][index][i] - candidate[0][index][i]) for i in valid))
        action_error = max(action_error, *(abs(eager[1][index][i] - candidate[1][index][i]) for i in range(2)))
    if not _finite(logits_error) or not _finite(action_error):
        _fail()
    return {'passed': (not choice_changes and not action_changes
                       and logits_error <= LOGITS_ATOL and action_error <= ACTION_ATOL),
            'choiceChanges': choice_changes, 'actionChanges': action_changes,
            'validMarkers': valid_markers, 'logitsMaxAbsError': logits_error,
            'actionMaxAbsError': action_error}


def comparison_report(parities, eager_times_ms, onnx_times_ms):
    """Summarize complete paired cases; never certify accuracy or promotion."""
    if (not all(_sequence(values) for values in (parities, eager_times_ms, onnx_times_ms))
            or not 1 <= len(parities) <= MAX_CASES
            or len(parities) != len(eager_times_ms) or len(parities) != len(onnx_times_ms)):
        _fail()
    for parity in parities:
        if type(parity) is not dict or set(parity) != _KEYS or type(parity['passed']) is not bool:
            _fail()
        for key in ('choiceChanges', 'actionChanges', 'validMarkers'):
            if type(parity[key]) is not int or parity[key] < 0:
                _fail()
        if (not 1 <= parity['validMarkers'] <= MAX_BATCH * MAX_MARKERS
                or parity['choiceChanges'] > MAX_BATCH or parity['actionChanges'] > MAX_BATCH):
            _fail()
        if not all(_finite(parity[key]) and parity[key] >= 0
                   for key in ('logitsMaxAbsError', 'actionMaxAbsError')):
            _fail()
        expected = (parity['choiceChanges'] == parity['actionChanges'] == 0
                    and parity['logitsMaxAbsError'] <= LOGITS_ATOL
                    and parity['actionMaxAbsError'] <= ACTION_ATOL)
        if parity['passed'] != expected:
            _fail()
    if not all(_finite(value) and value > 0 for value in (*eager_times_ms, *onnx_times_ms)):
        _fail()
    eager_median = median(eager_times_ms)
    onnx_median = median(onnx_times_ms)
    if not _finite(eager_median) or not _finite(onnx_median):
        _fail()
    speedup = eager_median / onnx_median
    if not _finite(speedup) or speedup <= 0:
        _fail()
    return {'casesCompared': len(parities), 'numericalParityPassed': all(p['passed'] for p in parities),
            'eagerMedianMs': eager_median, 'onnxMedianMs': onnx_median,
            'medianSpeedup': speedup, 'logitsAbsoluteTolerance': LOGITS_ATOL,
            'actionAbsoluteTolerance': ACTION_ATOL, 'accuracyImprovementProven': False,
            'productionDeadlineQualified': False, 'runtimePromotionApproved': False}
