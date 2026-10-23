"""Reviewed SSM operator: install synthetic tester, compare, restore runtime.

ASSETS is injected by send-conversation-tests.ps1. No credentials or app data.
"""
import hashlib
import http.client
import importlib.util
import json
import math
import os
from pathlib import Path
import signal
import stat
import statistics
import subprocess
import time

RELEASE = Path('/opt/docmee-laya/releases/release-20261022-a')
DIAGNOSTIC = Path('/opt/docmee-laya/diagnostics/descriptions-20261023-a')
VARIANTS = (('baseline', 'descriptions-baseline-unqualified-v1'),
            ('distinct', 'descriptions-distinct-unqualified-v1'))
DROP_DIR = Path('/etc/systemd/system/docmee-laya.service.d')
DROP = DROP_DIR / '90-docmee-conversation-probe.conf'
PROPS = ('ActiveState,SubState,MainPID,NRestarts,ControlGroup,ExecStart,DropInPaths,'
         'CPUQuotaPerSecUSec,MemoryMax,MemorySwapMax,TasksMax,DynamicUser,'
         'PrivateNetwork,NoNewPrivileges,ProtectSystem,ProtectHome,PrivateDevices,'
         'SystemCallFilter,RestrictAddressFamilies,CapabilityBoundingSet,Restart,StandardOutput,StandardError')
VOLATILE = {'ActiveState', 'SubState', 'MainPID', 'NRestarts', 'ControlGroup', 'ExecStart', 'DropInPaths', 'Restart'}
ASSET_NAMES = {'conversation_probe.py', 'conversations.py', 'evaluate.py', 'native_probe.py', 'plaintext_variant.py'}
PROFILE = False
FRAMING = False


def configure_framing():
    global DIAGNOSTIC, VARIANTS, FRAMING
    DIAGNOSTIC = Path('/opt/docmee-laya/diagnostics/framing-20261023-a')
    VARIANTS = (('json', 'framing-json-unqualified-v1'), ('text', 'framing-text-unqualified-v1'))
    FRAMING = True


def configure_timing():
    global DIAGNOSTIC, VARIANTS, PROFILE, ASSET_NAMES
    DIAGNOSTIC = Path('/opt/docmee-laya/diagnostics/timing-20261023-b')
    VARIANTS = (('baseline', 'descriptions-baseline-unqualified-v1'),)
    ASSET_NAMES = ASSET_NAMES | {'timing.py'}
    PROFILE = True


def command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=15).stdout.strip()


def unit(name):
    return dict(line.split('=', 1) for line in command('systemctl', 'show', name,
                '--property=' + PROPS).splitlines() if '=' in line)


def request(port, path, *, maximum=8192):
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=2)
    try:
        connection.request('GET', path, headers={'Connection': 'close'})
        response = connection.getresponse()
        body = response.read(maximum + 1)
        assert len(body) <= maximum, 'bounded_health'
        return response.status, json.loads(body)
    finally:
        connection.close()


def health():
    code, value = request(3001, '/health')
    assert code == 200 and value.get('ok') is True, 'application_health'
    return {'http': code, 'ok': True, 'buildId': value.get('buildId')}


def ready():
    deadline = time.monotonic() + 65
    while time.monotonic() < deadline:
        assert unit('docmee-laya.service')['ActiveState'] not in ('failed', 'inactive'), 'runtime_start_failed'
        try:
            if request(8767, '/ready')[0] == 200:
                return
        except (OSError, ValueError, http.client.HTTPException):
            pass
        time.sleep(1)
    raise AssertionError('runtime_start_deadline')


def counters(state):
    group = Path('/sys/fs/cgroup') / state['ControlGroup'].lstrip('/')
    events = dict(line.split() for line in (group / 'memory.events').read_text().splitlines())
    return {'memoryPeakBytes': int((group / 'memory.peak').read_text()),
            'oom': int(events['oom']), 'oomKill': int(events['oom_kill'])}


def cpu_counters(state):
    group = Path('/sys/fs/cgroup') / state['ControlGroup'].lstrip('/')
    return {key: int(value) for key, value in
            (line.split() for line in (group / 'cpu.stat').read_text().splitlines())
            if key in {'usage_usec', 'nr_periods', 'nr_throttled', 'throttled_usec'}}


def timing_records():
    # Diagnostic-only bounded RAM snapshot; preserve production null logging.
    code, body = request(8767, '/health', maximum=65536)
    assert code == 200 and set(body) == {'status', 'timing'} and body['status'] == 'alive', 'profile_health'
    records = body['timing']
    assert len(records) == 36 and [r['sequence'] for r in records] == list(range(1, 37)), 'complete_profile'
    numeric = lambda value: type(value) in (int, float) and math.isfinite(value) and value >= 0
    stages = {'agent.' + name for name in ('system_one', 'predict_batch', '_infer', '_forward', '_forward_in_chunks')}
    stages |= {'common.collate_items', 'common.forward'}
    stages |= {'tokenizer.' + name for name in ('__call__', '_call_one', '_batch_encode_plus', '_encode_plus')}
    for record in records:
        assert set(record) == {'sequence', 'completed', 'wallMs', 'cpuMs', 'stages'}, 'numeric_profile_only'
        assert record['completed'] is True and numeric(record['wallMs']) and numeric(record['cpuMs']), 'successful_profile'
        assert set(record['stages']) <= stages, 'known_stages'
        for row in record['stages'].values():
            assert set(row) == {'calls', 'selfMs', 'cumulativeMs'} and all(numeric(v) for v in row.values()), 'numeric_stage'
    return records


def timing_summary(records):
    """Bound SSM stdout; the complete numeric profile remains in its sealed file."""
    def distribution(values):
        return {'min': round(min(values), 3), 'median': round(statistics.median(values), 3),
                'max': round(max(values), 3)}
    stages = sorted({stage for record in records for stage in record['stages']})
    return {'count': len(records),
            'wallMs': distribution([record['wallMs'] for record in records]),
            'cpuMs': distribution([record['cpuMs'] for record in records]),
            'stages': {stage: {'samples': len(values), 'meanMs': round(statistics.mean(values), 3),
                               'maxMs': round(max(values), 3)}
                       for stage in stages
                       if (values := [record['stages'][stage]['cumulativeMs']
                                      for record in records if stage in record['stages']])}}


def sealed(path):
    for item in (path, *path.parents):
        metadata = item.lstat()
        assert not stat.S_ISLNK(metadata.st_mode) and metadata.st_uid == 0, 'root_sealed_path'
        assert metadata.st_mode & 0o022 == 0, 'nonwritable_path'


def write_new(path, body):
    with path.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(body)
    path.chmod(0o644)
    sealed(path)


def restore_runtime(armed):
    """Attempt independent recovery steps even if stopping or cleanup fails."""
    failures = []
    def attempt(label, operation):
        try:
            operation()
        except Exception as error:
            failures.append(label + ':' + type(error).__name__)
    attempt('stop', lambda: command('systemctl', 'stop', 'docmee-laya.socket', 'docmee-laya.service'))
    if armed:
        if DROP.exists():
            attempt('remove_override', DROP.unlink)
        attempt('remove_directory', DROP_DIR.rmdir)
    attempt('reload', lambda: command('systemctl', 'daemon-reload'))
    # Do not restart an uncleared diagnostic override following cleanup failure.
    override_cleared = not armed or not DROP.exists()
    reload_succeeded = not any(step.startswith('reload:') for step in failures)
    if override_cleared and reload_succeeded:
        attempt('start', lambda: command('systemctl', 'start', 'docmee-laya.socket', 'docmee-laya.service'))
    elif not override_cleared:
        failures.append('override_still_present')
    return failures


def interrupted(signum, frame):
    raise RuntimeError('operator_interrupted')


def verify_original_process(state, diagnostic_pids=()):
    """Check the running process, not just systemd's configured command."""
    pid = state['MainPID']
    assert state['ActiveState'] == 'active' and pid.isdecimal() and int(pid) > 0, 'original_process_active'
    assert pid not in diagnostic_pids, 'diagnostic_process_survived'
    actual = (Path('/proc') / pid / 'cmdline').read_bytes().split(b'\0')
    expected = [str(RELEASE / 'venv/bin/python').encode(), b'-I', b'-B',
                str(RELEASE / 'isolation/entrypoint.py').encode(), b'']
    assert actual == expected, 'original_live_entrypoint'


def console_report(report):
    """Keep SSM stdout bounded; full redacted case evidence stays on disk."""
    return {**{key: value for key, value in report.items() if key != 'cases'},
            'mismatches': [case for case in report['cases'] if case.get('correct') is not True]}


def main():
    assert os.geteuid() == 0, 'ssm_operator_required'
    before = unit('docmee-laya.service')
    app_before, caddy_before = unit('docmee.service'), unit('caddy.service')
    initial = health()
    assert initial['buildId'] == 'git-139b000e9947', 'expected_served_build'
    assert all(value['ActiveState'] == 'active' for value in (before, app_before, caddy_before)), 'services_active'
    assert before['DropInPaths'] == '' and not DROP_DIR.exists(), 'no_existing_override'
    assert str(RELEASE / 'isolation/entrypoint.py') in before['ExecStart'], 'expected_entrypoint'
    assert str(RELEASE / 'venv/bin/python') in before['ExecStart'], 'expected_interpreter'
    assert before['CPUQuotaPerSecUSec'] == '1s' and before['MemoryMax'] == '3221225472', 'resource_limits'
    assert before['PrivateNetwork'] == before['DynamicUser'] == before['NoNewPrivileges'] == 'yes', 'sandbox'
    assert before['StandardOutput'] == before['StandardError'] == 'null', 'private_logging'
    assert before['Restart'] == 'on-failure' and request(8767, '/ready')[0] == 200, 'runtime_ready'
    assert not DIAGNOSTIC.exists(), 'fresh_diagnostic_directory'
    sealed(RELEASE / 'isolation/entrypoint.py')
    assert set(ASSETS) == ASSET_NAMES, 'asset_set'
    for asset in ASSETS.values():
        assert hashlib.sha256(asset['body'].encode('utf-8')).hexdigest() == asset['sha256'], 'asset_digest'
    print(json.dumps({'phase': 'preflight', 'health': initial,
                      'sourceCommit': command('sudo', '-u', 'ubuntu', '-H', 'git', '-C', '/var/www/docmee', 'rev-parse', 'HEAD'),
                      'sandbox': before, 'sendsExternalMessages': False}), flush=True)
    DIAGNOSTIC.mkdir(parents=True, mode=0o755)
    for directory in (DIAGNOSTIC, DIAGNOSTIC / 'laya-evaluation', DIAGNOSTIC / 'laya-runtime'):
        directory.mkdir(exist_ok=True, mode=0o755)
        sealed(directory)
    for name, asset in ASSETS.items():
        target = DIAGNOSTIC / name if name == 'conversation_probe.py' else DIAGNOSTIC / 'laya-evaluation' / name
        write_new(target, asset['body'])
    write_new(DIAGNOSTIC / 'laya-runtime/protocol.py', (RELEASE / 'runtime/protocol.py').read_text())
    spec = importlib.util.spec_from_file_location('conversation_replay', DIAGNOSTIC / 'laya-evaluation/conversations.py')
    replay = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(replay)
    for variant, _ in VARIANTS:
        for split in ('calibration', 'heldout'):
            (replay.framing_corpus if FRAMING else replay.description_corpus)(split, variant)
    armed, complete = False, True
    reports = {}
    diagnostic_pids = set()
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        command('systemctl', 'stop', 'docmee-laya.socket', 'docmee-laya.service')
        DROP_DIR.mkdir(mode=0o755)
        armed = True
        for variant, calibration in VARIANTS:
            if DROP.exists():
                DROP.unlink()
            write_new(DROP, '[Service]\nExecStart=\nExecStart=' + str(RELEASE / 'venv/bin/python') +
                      ' -I -B ' + str(DIAGNOSTIC / 'conversation_probe.py') + ' ' + variant +
                      (' framing' if FRAMING else ' timing' if PROFILE else '') + '\nRestart=no\n')
            command('systemctl', 'daemon-reload')
            merged = unit('docmee-laya.service')
            assert all(merged[key] == before[key] for key in before if key not in VOLATILE), 'unchanged_sandbox'
            assert merged['DropInPaths'] == str(DROP) and merged['Restart'] == 'no', 'diagnostic_override'
            command('systemctl', 'start', 'docmee-laya.socket', 'docmee-laya.service')
            ready()
            started = unit('docmee-laya.service')
            diagnostic_pids.add(started['MainPID'])
            reports[variant] = {}
            cpu_before = cpu_counters(started) if PROFILE else {}
            for split in ('calibration', 'heldout'):
                run_replay = replay.run_framing if FRAMING else replay.run_descriptions
                report = run_replay(pins=('laya-multilingual-e4e9ddf21a7b', calibration),
                                    variant=variant, timeout=5, split=split)
                after = unit('docmee-laya.service')
                assert after['MainPID'] == started['MainPID'] and after['NRestarts'] == started['NRestarts'], 'stable_runtime'
                measured = counters(after)
                assert measured['oom'] == measured['oomKill'] == 0, 'no_oom'
                reports[variant][split] = report
                # Persist redacted evidence outside the application, without input transcripts.
                write_new(DIAGNOSTIC / (variant + '-' + split + '-report.json'), json.dumps(report, ensure_ascii=True, indent=2))
                print(json.dumps({'phase': 'conversation_report', 'variant': variant, 'split': split,
                                  'report': console_report(report), 'counters': measured}), flush=True)
                complete = complete and report['complete']
                if not complete:
                    break
            if PROFILE and complete:
                records = timing_records()
                cpu_after = cpu_counters(unit('docmee-laya.service'))
                profile = {'records': records, 'cpuDelta': {k: cpu_after[k] - v for k, v in cpu_before.items()},
                           'instrumented': True, 'cumulativeStagesOverlap': True}
                write_new(DIAGNOSTIC / 'timing-report.json', json.dumps(profile, indent=2))
                print(json.dumps({'phase': 'timing_report', **{key: value for key, value in profile.items()
                                  if key != 'records'}, 'summary': timing_summary(records)}), flush=True)
            command('systemctl', 'stop', 'docmee-laya.socket', 'docmee-laya.service')
            if not complete:
                break  # No retry after transport failure or retained native work.
        if len(reports) == len(VARIANTS):
            print(json.dumps({'phase': 'comparison', 'summaries': {
                variant: {split: report['summary'] for split, report in splits.items()}
                for variant, splits in reports.items()}, 'activationApproved': False}), flush=True)
    except Exception as error:
        complete = False
        print(json.dumps({'phase': 'test_failed', 'errorType': type(error).__name__}), flush=True)
    finally:
        restoration_failures = restore_runtime(armed)
        if restoration_failures:
            complete = False
            print(json.dumps({'phase': 'restoration_warnings', 'steps': restoration_failures}), flush=True)
        restored = unit('docmee-laya.service')
        assert all(restored[key] == before[key] for key in before if key not in VOLATILE), 'restored_sandbox'
        assert restored['DropInPaths'] == before['DropInPaths'] and restored['Restart'] == before['Restart'], 'restored_unit'
        assert restored['ExecStart'].split(' ; ignore_errors', 1)[0] == before['ExecStart'].split(' ; ignore_errors', 1)[0], 'restored_entrypoint'
        ready()
        verify_original_process(unit('docmee-laya.service'), diagnostic_pids)
        assert not restoration_failures, 'restoration_steps_failed'
        assert health() == initial, 'unchanged_build'
        for name, previous in (('docmee.service', app_before), ('caddy.service', caddy_before)):
            current = unit(name)
            assert current['ActiveState'] == 'active' and current['MainPID'] == previous['MainPID'], 'unchanged_app_process'
        print(json.dumps({'phase': 'restored', 'health': health(), 'runtimeReady': True,
                          'originalDeadlineMs': 750, 'patientRoutingChanged': False,
                          'testerInstalled': str(DIAGNOSTIC)}), flush=True)
    return 0 if complete and len(reports) == len(VARIANTS) and all(len(splits) == 2 for splits in reports.values()) else 1


if __name__ == '__main__':
    try:
        assert not (globals().get('TIMING_MODE') and globals().get('FRAMING_MODE')), 'exclusive_mode'
        if globals().get('FRAMING_MODE') is True:
            configure_framing()
        if globals().get('TIMING_MODE') is True:
            configure_timing()
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'phase': 'operator_failure', 'errorType': type(error).__name__}), flush=True)
        raise SystemExit(2)
