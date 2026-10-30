"""Threshold + accuracy report for the menu corpus replay.

Usage: python menu_report.py corpus.json results.csv [--precision 0.97] > report.json
A case is ROUTED when LAYA returns a choice (not abstaining) with rawScore >= threshold.
Routed and right = correct. Routed and wrong (or routed a case that should not route) = wrong route.
Not routed = falls back to the menu's own default (the patient is asked to tap), which is safe.
Thresholds are chosen per language bucket on the calibration split only, then checked on held-out.
"""
import csv
import json
import math
import statistics
import sys

GRID = [round(0.30 + i * 0.01, 2) for i in range(70)]  # 0.30 .. 0.99


def wilson_low(ok, n, z=1.96):
    if n == 0:
        return None
    p = ok / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n)


def evaluate(rows, t):
    routed = correct = wrong = should_route = 0
    for r in rows:
        if r['expected'] is not None:
            should_route += 1
        if r['choice'] and not r['abstain'] and r['score'] is not None and r['score'] >= t:
            routed += 1
            if r['choice'] == r['expected']:
                correct += 1
            else:
                wrong += 1
    return {'cases': len(rows), 'routed': routed, 'correct': correct, 'wrong': wrong,
            'precision': None if routed == 0 else round(correct / routed, 4),
            'precisionLow95': None if routed == 0 else round(wilson_low(correct, routed), 4),
            'coverage': None if should_route == 0 else round(correct / should_route, 4)}


def choose(rows, target):
    for t in GRID:  # lowest threshold that meets the target maximises coverage
        m = evaluate(rows, t)
        if m['routed'] >= 5 and m['precision'] is not None and m['precision'] >= target:
            return t
    return None


def main():
    corpus = {c['id']: c for c in json.load(open(sys.argv[1], encoding='utf-8'))}
    target = float(sys.argv[sys.argv.index('--precision') + 1]) if '--precision' in sys.argv else 0.97
    rows = []
    for rec in csv.DictReader(open(sys.argv[2], encoding='utf-8')):
        c = corpus[rec['id']]
        rows.append({**c, 'status': int(rec['status']), 'ms': int(rec['ms']), 'choice': rec['choice'] or None,
                     'score': float(rec['score']) if rec['score'] else None, 'abstain': rec['abstain'] == '1',
                     'bucket': rec['bucket']})
    answered = [r for r in rows if r['status'] == 200]
    ms = [r['ms'] for r in answered]
    report = {
        'targetPrecision': target, 'cases': len(rows), 'answered': len(answered),
        'notAnswered': {str(s): sum(1 for r in rows if r['status'] == s) for s in sorted({r['status'] for r in rows if r['status'] != 200})},
        'latencyMs': {'median': statistics.median(ms), 'p95': sorted(ms)[max(0, math.ceil(len(ms) * 0.95) - 1)], 'max': max(ms)} if ms else None,
        'rawTop1': evaluate(answered, 0.0), 'buckets': {}, 'thresholds': {}, 'mistakes': [],
    }
    for bucket in sorted({r['bucket'] for r in rows}):
        cal = [r for r in answered if r['bucket'] == bucket and r['split'] == 'calibration']
        held = [r for r in answered if r['bucket'] == bucket and r['split'] == 'heldout']
        t = choose(cal, target)
        report['buckets'][bucket] = {'threshold': t, 'calibration': evaluate(cal, t) if t is not None else None,
                                     'heldout': evaluate(held, t) if t is not None else None,
                                     'heldoutNoThreshold': evaluate(held, 0.0)}
        if t is not None:
            report['thresholds'][f'workflow_branch:{bucket}'] = t
    for r in answered:
        t = report['thresholds'].get(f"workflow_branch:{r['bucket']}")
        routed = r['choice'] and not r['abstain'] and r['score'] is not None and t is not None and r['score'] >= t
        if routed and r['choice'] != r['expected']:
            report['mistakes'].append({k: r[k] for k in ('menu', 'lang', 'bucket', 'split', 'text', 'expected', 'choice', 'score')})
    json.dump(report, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
