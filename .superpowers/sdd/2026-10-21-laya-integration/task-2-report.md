# Task 2 report — pinned offline backend

Parent mission: docmee-laya-integration-20261021. Branch: codex/laya-integration-20261021.
Base: 11a9a1a30bbbd771f282510587b349f8540a397b.

## Contract and boundaries

Objective: implement the brief's source-only offline pinned loader and strict Choice adapter.
Scope: artifacts.py, backend.py, tests/test_backend.py, bounded server.py/README.md extensions.
Non-goals: installation, download, model qualification, live data/routing, AWS, deployment, push.
Acceptance: fake-Agent standard-library tests, manifest checks, generic CLI failure, runtime regression.
Gate: independent review belongs to controller; owner acceptance not claimed.
Stop: bounded implementation complete or architecture expansion needed.
Authorization: delegated brief; no subagents used, no dependencies installed.

Applied canonical Agent Operations, Engineering and Code Adoption, Language and Framework
Development, and Prompt and Evaluation rules from the vault's `Projects/11- RULES/`.
Python-development and superpowers-test-driven-development guided implementation.
No material route/model choice was made: all pins and CPU settings were fixed by brief,
so no advisory LAYA call was needed.

## Implementation

- Closed five-file size/SHA-256 manifest, absolute path/tree checks, symlink and Windows
  reparse rejection, streaming SHA-256, verification before imports and after load.
- Exact installed laya version gate, offline/telemetry controls before ML imports,
  CPU/eager/noncompiled Agent, torch intra/inter-op threads one; dependency injection
  is confined to Python constructor, not exposed through HTTP or CLI.
- Fixed per-task Choice instructions, JSON data boundary, stable option_N key mapping,
  exact answer/options validation, finite nonboolean probabilities in [0,1], normalized
  vector tolerance for upstream four-decimal rounding, selected raw probability.
- Fail-closed abstention for malformed/missing/truncated/collapsed responses and inference
  errors; generic constructor error; Python upstream stdout/stderr discarded without buffering.
- CLI defaults to no backend; explicit --artifact-dir failure exits 1 generically.
- Existing protocol and HTTP inference-slot lifecycle unchanged.

Upstream interface inspected locally at the provided installed laya/agent.py, including
constructor, decoded answers, usage fields and system_one. No upstream execution/import
or network research was necessary for these inspected source contracts.

## RED / GREEN evidence

Working directory for every test: `C:/w/docmee-laya-20261021`.
Interpreter: `C:/Users/Mikazuki/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe`
(provided Python 3.11 environment). No Python runtime dependencies added.

RED command:
```powershell
& 'C:/Users/Mikazuki/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe' -m unittest discover -s services/laya-runtime/tests -p test_backend.py -v
```
Observed before implementation: `Ran 8 tests in 0.020s`, `FAILED (errors=8)`;
each failed during setup with `ModuleNotFoundError: No module named 'artifacts'`.
This demonstrates missing implementation, but is import-error RED rather than assertion
RED; that procedural limitation is explicitly disclosed. Three additional integrity
regression cases were added after GREEN, not claimed as independently observed RED.

First GREEN, same command: `Ran 8 tests in 0.320s`, `OK (skipped=1)`.
Final focused GREEN, same command: `Ran 11 tests in 0.371s`, `OK (skipped=1)`.
Skipped: actual Windows symlink creation lacked privilege. Deterministic Windows
reparse metadata rejection test passes; it does not replace actual privileged integration.

Full runtime command:
```powershell
& 'C:/Users/Mikazuki/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe' -m unittest discover -s services/laya-runtime/tests -v
```
First run: `Ran 35 tests in 1.883s`, `FAILED (failures=1, skipped=1)`.
Existing worker-capacity test received empty response instead of 503 (TCP timing).
No worker/lifecycle changes were made. One bounded rerun, unchanged code:
`Ran 35 tests in 1.712s`, `OK (skipped=1)`.
`git diff --check`: exit 0, no output.

## Self-review, gaps and concerns

Self-review checked owned source, manifest values against brief, CLI diff and scope.
Controller plan edit remains untouched and excluded from commit.
No actual model/dependency loading, quality/calibration, performance, packaging,
network-denial integration, secure memory erasure or owner acceptance is established.
Packaging must enforce artifact write protection; hash checks do not eliminate races.
Python redirect_stdout/stderr is process-wide and does not sandbox native writes or
preconfigured logging handlers; later packaging must control those process outputs.
This loader does not configure logs/hooks/telemetry/storage. Synthetic tests cannot
prove all third-party internals are privacy-safe in an actual packaged process.
Prompt/data separation is not a qualification claim or perfect prompt-injection defense.
Backend releases transient locals on return; trusted upstream Agent retention needs
real-runtime verification. Model inference cannot be forcibly cancelled by HTTP timeout.
One existing TCP timing test failure then passing rerun is a residual test-flakiness signal.

Changed owned files: services/laya-runtime/artifacts.py, backend.py, tests/test_backend.py,
server.py, README.md, and this report. No other files staged.
Execution: implemented locally and synthetic tests passing; independent review pending.
Owner review: pending. Deployment: not performed.
