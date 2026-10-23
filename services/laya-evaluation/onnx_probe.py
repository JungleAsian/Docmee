"""Offline FP32 experiment library; deliberately has no deployment/CLI entrypoint.

A separately reviewed, resource-capped Linux operator must load this module.
Native dependencies are imported only inside run_comparison, never installed.
"""
import contextlib
import hashlib
import importlib.util
from importlib.metadata import version
import json
import os
from pathlib import Path
import random
import stat
import sys
import time


INPUTS = ('input_ids', 'attention_mask', 'marker_pos', 'marker_mask', 'qtype')


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def synthetic_cases():
    """Small fixed tensor cases, not patient conversations or accuracy cases."""
    cases = []
    for batch, length, markers in ((1, 17, 3), (3, 53, 5), (2, 97, 7)):
        generator = random.Random(batch * 1000 + length)
        case = {name: [] for name in INPUTS}
        for index in range(batch):
            usable = length if index == 0 else length - 15
            positions = [1 + i * 2 for i in range(markers)]
            mask = [True] * markers
            if index:
                mask[-2:] = [False, False]
                positions[-2:] = [0, 0]
            case['input_ids'].append([generator.randrange(5, 1000) for _ in range(length)])
            case['attention_mask'].append([1] * usable + [0] * (length - usable))
            case['marker_pos'].append(positions)
            case['marker_mask'].append(mask)
            case['qtype'].append(index % 3)
        cases.append(case)
    return cases


def export_arguments():
    """Explicit legacy exporter: dynamic_axes must not use an implicit default."""
    return {'export_params': True, 'opset_version': 18, 'do_constant_folding': True,
            'dynamo': False, 'external_data': False, 'input_names': list(INPUTS),
            'output_names': ['logits', 'act_logits'],
            'dynamic_axes': {
                'input_ids': {0: 'batch_size', 1: 'seq_len'},
                'attention_mask': {0: 'batch_size', 1: 'seq_len'},
                'marker_pos': {0: 'batch_size', 1: 'num_markers'},
                'marker_mask': {0: 'batch_size', 1: 'num_markers'},
                'qtype': {0: 'batch_size'},
                'logits': {0: 'batch_size', 1: 'num_markers'},
                'act_logits': {0: 'batch_size'}}}


def session_options(ort):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    options.log_severity_level = 4
    return options


def prepare_output_directory(model_directory, output_directory):
    """Create one new experiment directory, never a model child or replacement."""
    model = Path(model_directory)
    output = Path(output_directory)
    try:
        for path in (model, output):
            if not path.is_absolute() or '..' in path.parts:
                raise ValueError()
        if model == output or model in output.parents or output in model.parents:
            raise ValueError()
        for path in (model, *model.parents, *output.parents):
            info = path.lstat()
            if (not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode)
                    or getattr(info, 'st_file_attributes', 0) & 0x400):
                raise ValueError()
        output.mkdir(mode=0o700, parents=False, exist_ok=False)
    except (OSError, ValueError):
        raise ValueError('new isolated output directory required') from None
    return output


def _sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def run_comparison(model_directory, output_directory):
    """Export and compare only the pinned local multilingual model on CPU.

    Call only under an external wall-time/memory/CPU/network cap. This library
    does not qualify server capacity, pin new wheels, or promote runtime files.
    Native execution is not covered by dependency-free configuration tests.
    """
    if sys.platform != 'linux' or not sys.flags.isolated or not sys.dont_write_bytecode:
        raise ValueError('isolated Linux operator required')
    here = Path(__file__).resolve().parent
    artifacts = _module('onnx_probe_artifacts', here.parent / 'laya-runtime' / 'artifacts.py')
    compare = _module('onnx_probe_compare', here / 'onnx_compare.py')
    artifacts.verify_artifacts(model_directory)
    if version('laya') != artifacts.DISTRIBUTION_VERSION or version('torch') != '2.14.1+cpu':
        raise ValueError('reviewed model stack required')
    for key in ('HF_HUB_OFFLINE', 'TRANSFORMERS_OFFLINE', 'HF_HUB_DISABLE_TELEMETRY', 'DO_NOT_TRACK'):
        os.environ[key] = '1'
    os.environ['TOKENIZERS_PARALLELISM'] = 'false'
    # These imports cannot download packages or change the live service.
    import torch
    import onnx
    import onnxruntime as ort
    from laya import Agent

    output = prepare_output_directory(model_directory, output_directory)
    graph = output / 'candidate-fp32.onnx'
    cases = synthetic_cases()
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.manual_seed(20261023)
    torch.use_deterministic_algorithms(True)
    parities, eager_times, onnx_times = [], [], []
    # Suppress third-party text; persist only numeric summaries and identities.
    with open(os.devnull, 'w', encoding='utf-8') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        agent = Agent(model_id_or_path=str(model_directory), device='cpu', backend='eager',
                      compile=False, fast=False)
        model = agent.model.float().eval()
        if not all(parameter.dtype == torch.float32 for parameter in model.parameters()):
            raise ValueError('FP32 model required')
        tensors = [tuple(torch.tensor(case[name], dtype=torch.bool if name == 'marker_mask' else torch.long)
                         for name in INPUTS) for case in cases]
        with torch.no_grad():
            torch.onnx.export(model, tensors[0], str(graph), **export_arguments())
            onnx.checker.check_model(str(graph))
            session = ort.InferenceSession(str(graph), sess_options=session_options(ort),
                                           providers=['CPUExecutionProvider'])
            if session.get_providers() != ['CPUExecutionProvider']:
                raise ValueError('CPU provider required')
            for case, inputs in zip(cases, tensors):
                feed = {name: tensor.numpy() for name, tensor in zip(INPUTS, inputs)}
                model(*inputs)
                session.run(['logits', 'act_logits'], feed)
                for repeat in range(3):
                    # Alternate order to reduce systematic warm-cache bias.
                    results, elapsed = {}, {}
                    for engine in (('eager', 'onnx') if repeat % 2 == 0 else ('onnx', 'eager')):
                        start = time.perf_counter()
                        results[engine] = (model(*inputs) if engine == 'eager'
                                           else session.run(['logits', 'act_logits'], feed))
                        elapsed[engine] = (time.perf_counter() - start) * 1000
                    eager = [value.detach().cpu().tolist() for value in results['eager']]
                    candidate = [value.tolist() for value in results['onnx']]
                    parities.append(compare.compare_outputs(eager, candidate, case['marker_mask']))
                    eager_times.append(elapsed['eager'])
                    onnx_times.append(elapsed['onnx'])
    artifacts.verify_artifacts(model_directory)
    report = compare.comparison_report(parities, eager_times, onnx_times)
    report.update({'schemaVersion': 1, 'experiment': 'synthetic-fp32-raw-output-parity-v1',
                   'modelRepository': artifacts.MODEL_REPOSITORY,
                   'modelRevision': artifacts.MODEL_REVISION,
                   'checkpointSha256': artifacts.MANIFEST['model.safetensors'][1],
                   'graphSha256': _sha256(graph), 'precision': 'FP32',
                   'providers': ['CPUExecutionProvider'], 'threads': 1,
                   'versions': {name: version(name) for name in ('laya', 'torch', 'onnx', 'onnxruntime')},
                   'shapeCases': len(cases), 'repetitionsPerShape': 3,
                   'timingScope': 'raw-model-only-excludes-tokenization-and-transport'})
    with (output / 'comparison.json').open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(report, sort_keys=True, allow_nan=False) + '\n')
    return report
