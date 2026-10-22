# LAYA integration execution contract

Status: disabled advisory foundation deployed; full integration in progress and not qualified for patient use.

## Scope and decision

Integrate LAYA as a private, bounded advisory dependency, not an agent with actions.
Docmee remains authoritative for tenant access, published workflow selection, consent,
business hours, secretary overrides, booking confirmations, availability and AI settings.
Baseline: Docmee has no LAYA dependency; preserve that behavior whenever unavailable.

Use an isolated runtime rather than importing Python/PyTorch into the web process.
Same-host deployment is conditional on live capacity measurements. Separate processes
reduce coupling but do not eliminate shared-host resource exhaustion or host failure.
No public LAYA port, database credentials, provider credentials or action tools.

## Work packages and acceptance evidence

| Goal | Deliverable | Required evidence / current gate |
| --- | --- | --- |
| 1 | Read-only AWS capacity assessment | Initial ARM64/2 CPU/7.8 GB snapshot collected; peak inference contention remains unqualified |
| 2 | Pinned non-root private runtime | Reviewed dependency/checkpoint hashes, health/restart/resource tests |
| 3 | Shared server adapter | Strict contracts, timeout, bounded concurrency, privacy and invalid-output tests |
| 4 | Independent runtime controls | Global maximum plus clinic mode, fail-closed reads, immediate disable |
| 5 | Administrative intent catalog | Booking/reschedule/cancel/information/secretary; unclear/unsupported |
| 6 | Workflow integration | Explicit routes/state preserved; only current published eligible branches |
| 7 | J.zel/AI shared integration | Provider settings unchanged; authoring remains validated drafts |
| 8 | KB integration | Clinic/doctor/approval/freshness filtering before transport; stale results rejected |
| 9 | Deterministic safeguards | No action execution or workflow publication from model output |
| 10 | Bilingual evaluations | EN/ES/mixed/typo/negation/ambiguity/menu/missing KB/isolation held-out cases |
| 11 | Calibrated abstention | Per-task/language qualification; raw scores never called confidence |
| 12 | Reviewed feedback | Minimal categorical outcomes; offline reviewed/versioned examples only |
| 13 | Diagnostics | Scoped authorization, redacted records, bounded retention, model/calibration identifiers |
| 14 | Rollout | Failure/load/regression tests; shadow then authorized controlled clinic tests; release docs |

## First test-driven increment

1. Add failing behavioral tests for controls, deterministic precedence, response validation,
   scope-safe requests, score gates, timeout and saturated capacity.
2. Implement dependency-injected adapter and loopback-only HTTP transport, no runtime enablement.
3. Test and typecheck; extend with scoped KB/workflow wrappers and shared caller hooks.
4. Add runtime deployment assets only after verifying upstream runtime contracts and hashes.
5. Complete server qualification and rollout separately; do not imply local tests prove live readiness.

## Failure, rollout and rollback

All failed/disabled/unqualified/uncertain decisions fall back to the existing supported path.
Shadow output cannot affect routing; advisory output is review-only. Live mode requires
independently reviewed task/language qualification and matching model/calibration versions.
Timeout retains concurrency capacity until an uncooperative transport settles.
No raw message/history, phone, patient identifiers, credentials or provider error text in diagnostics.
Global disable and per-clinic disable take effect on subsequent calls without redeployment.
Revalidate controls and scope after inference before applying a result.

Execution completion and owner acceptance are separate. Neither is established yet.

## Local checkpoint: adapter, workflow and KB boundaries

- Implemented validated adapter, loopback-only transport, seven-category administrative
  intent wrapper and server-resolved workflow edge wrapper. Intent and workflow-branch
  execution are not wired into production routing.
- Workflow wrapper verifies clinic, published workflow/revision, source node and eligible
  edges before disclosure and after inference. Preserves deterministic routes, rejects
  changed scope, bounds scope reads and keeps shadow decisions observational.
- Test-first workflow module check failed for the missing module; implementation then
  passed all 61 focused LAYA tests. Agents typecheck passed.
- Broader agents suite initially failed resolving missing local `db/dist` and
  `shared/dist` package entrypoints. Building those two workspace packages resolved the
  setup failure without source/config changes; rerun: 50 files, 611 tests passed.
- Added scoped KB relevance integration with pre-disclosure eligibility and currentness
  checks, post-inference revalidation, and baseline-preserving disabled/shadow/advisory
  behavior. J.zel and workflow KB callers now receive lazy, process-owned adapters
  with durable server-owned controls. No endpoint means no adapter or control pool;
  actual callers install no reviewed qualification, so live application remains blocked.
- Independent read-only review found that rejected KB evidence could retain a `ready`
  status. Seven test-first cases reproduced this for wrong doctor/language, excluded
  governance, expiry, future effective date, malformed date and stale revision. The
  boundary now returns `stale_sources` before transport. Fresh independent re-review
  passed the corrected disabled foundation; it does not qualify live inference.
- The currentness callback now receives doctor/language from the server query plan,
  including cached evidence. Three tests first failed on the missing scope and passed
  after the shared contract and J.zel/workflow callers were corrected.
- The release review found optional-control saturation could mark current evidence
  stale. Two regression cases reproduced it before correction. Unavailable passage-free
  preflight now skips LAYA and performs the ordinary source proof, without disclosure.
  Hanging-control regression coverage also verifies that occupied slots remain retained.
- Fresh verification after the availability correction: agents suite 53 files / 667
  tests passed; agents, API and workers TypeScript builds passed; API focused tests 15
  passed and worker focused tests 61 passed. These are scoped results, not a clean full
  worker-suite claim: 11 previously reproduced baseline mock failures remain separate.
- Non-root deployment role verified: `DocmeeDeployOperator`. Disabled foundation
  `49efb92371efb6aaea6e5548be0c83b2507eb459` deployed through SSM command
  `030ec16a-3164-4fb8-a310-722bed417cbc`, terminal Success/0 on 2026-10-22 UTC.
  Public health returned `git-49efb92371ef`; service active. Endpoint remains unset.
- Review used a fresh-context read-only subagent because the available Claude MCP did
  not provide verified direct filesystem access. This substitution is not deployment
  approval or model qualification.
- Independent re-review ran seven focused files / 117 tests successfully, including
  26 KB tests, and passed both release-review corrections with no remaining blocker
  in that bounded review. It did not assess deployment readiness or full integration.
- Capacity SSM `36ce3cb4-96c0-44d5-8c67-06c3225de9aa` succeeded: aarch64,
  two Neoverse-N1 CPUs, RAM 7804 MB / 6893 MB available, disk 57590 MB available,
  no swap; short samples 98-100% CPU idle. No LAYA service installed. This is not
  peak-load, model latency or shared-host inference qualification.
- These are scoped software and publication checks, not measured model accuracy,
  peak capacity, live patient-flow acceptance or owner acceptance.
- Next gates: private runtime protocol and pinned runtime qualification;
  then intent/workflow execution wiring, peak capacity and staged rollout evidence. The 14-item integration is
  not complete, and no live model accuracy or owner acceptance is established.

## Remaining execution increments

### Task 1: Private runtime HTTP boundary (no production installation)

Implement only `services/laya-runtime/` with standard-library Python and no new
third-party dependency. Target Python 3.10+, local tests on the available interpreter.
Separate protocol validation, server lifecycle and tests into focused files. Provide a
README with test instructions and explicit unqualified/uninstalled status.

Accept only loopback IPv4 bind `127.0.0.1`. Serve POST `/v1/decision`, GET `/health`
and GET `/ready`; reject query strings, other methods/paths and non-loopback binding.
Health reports process liveness; readiness is 503 unless an explicitly injected
backend reports ready with nonempty pinned model/calibration identifiers. Default
CLI has no backend and must remain unready. No pretend inference backend in CLI.

Match `packages/agents/src/laya/adapter.ts` wire schema exactly: request has only
schemaVersion=1, requestId, task, language, text, candidates. Tasks are
administrative_intent/workflow_branch/kb_relevance and languages en/es/mixed/unknown.
requestId must be a canonical UUID. Text nonblank <=1600 UTF-16 code units;
1..7 unique candidates, exactly id/label, id nonblank <=128, label nonblank <=1200;
total text+ids+labels <=6000 UTF-16 units. Reject bools as integer versions, extra
keys, duplicate JSON keys, invalid UTF-8, nonfinite JSON numbers and malformed shapes.

Require Content-Type application/json (optional UTF-8 charset only), one valid
Content-Length <=32768 bytes, no Transfer-Encoding, no Content-Encoding or Expect.
Bound request headers (count and bytes), sockets/read timeout and worker capacity.
Reject over-limit headers rather than trusting BaseHTTPRequestHandler defaults.
No per-request unbounded threads or queues. Inference concurrency exactly one;
busy returns a generic 503 promptly, including when backend hangs. Slot remains
occupied until backend settles. Health must remain responsive with inference busy.
Close every connection; do not accept pipelining or request smuggling.

Backend response exactly schemaVersion/requestId/modelVersion/calibrationVersion/
choiceId/rawScore/abstain. Validate requestId, pinned versions, allowed choice,
finite score 0..1, boolean abstain, choice null only with abstain. JSON output <=8192
bytes. Exceptions/invalid backend output return generic errors, never raw backend
text, request content or identifiers. Disable access/body/exception logging; no raw
inputs retained after a call. Backend owns model compute; this task provides none.
No DB, action, credential, checkpoint download, model install or Docmee routing edits.

TDD: first failing tests, then implementation. Exercise real loopback HTTP and raw
sockets: valid contract, default unready, ready backend, invalid/duplicate keys,
UTF-16 limits, extra shapes, unsupported paths/methods/query, header/body limits,
duplicate Content-Length, transfer/content encoding, timeout, busy inference with
responsive health, held slot during hang, exception redaction, invalid/oversized
backend response, bind rejection, shutdown and no sensitive stdout/stderr.
Record RED/GREEN commands and supported interpreter in the report. Commit only
owned files; self-review then controller-arranged independent review. No deployment.

Task 1 checkpoint: commit `11a9a1a30bbbd771f282510587b349f8540a397b`,
independent spec/quality review approved, zero findings. Local Python 3.11 tests
24/24 passed; no real model or production runtime installed by this task.

### Task 2: Pinned offline model backend (source only)

Own only `services/laya-runtime/artifacts.py`, `backend.py`, `tests/test_backend.py`,
and bounded extensions to `server.py` and `README.md`. No dependency installation,
production changes, downloads during inference, TypeScript routing or model qualification.
The existing protocol and HTTP lifecycle remain the boundary. Standard-library tests
inject a fake Agent; they must not require torch, transformers or a checkpoint.

Pin distribution `laya==0.4.8` and model repo `convaiinnovations/laya-multilingual`
at immutable revision `e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`.
Runtime accepts an absolute prepared artifact directory containing exactly these
regular files (and only their ancestor directories), no symlinks or path traversal:

| File | Bytes | SHA-256 |
| --- | --- | --- |
| encoder/config.json | 1938 | 83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4 |
| model.safetensors | 643835514 | 9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204 |
| rl_agent_config.json | 472 | 25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6 |
| tokenizer/tokenizer.json | 34363188 | 609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f |
| tokenizer/tokenizer_config.json | 524 | 6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1 |

The tokenizer config is pre-normalized, not the upstream download: upstream is
502 bytes/SHA `424b69444bf7b5809dc2cd2e36d0bd71b8055124dd24274d6db3c655d38205e7`.
Offline preparation replaces its extra_special_tokens list with the ordered mapping
extra_0/extra_1, then Python json.dumps(indent=2), UTF-8, no terminal newline.
Runtime must never normalize or download. Stream-hash and size-check the closed
manifest before importing/loading Agent; verify again after load to detect mutation.
Artifact metadata must not be mistaken for model qualification. Protect the actual
directory against concurrent writes operationally in the later packaging task.
Tests may pass an explicit small manifest to the low-level verifier; production
loader must always use the built-in pinned manifest, not caller-supplied hashes.

Backend exposes the existing ready/model_version/calibration_version/decide interface.
Model identifier: `laya-multilingual-e4e9ddf21a7b`; calibration identifier:
`upstream-unqualified-v1`. Ready means loaded, NOT qualified for live routing.
Before imports set HF_HUB_OFFLINE=1 and TRANSFORMERS_OFFLINE=1, disable telemetry
and tokenizer parallelism. Check installed distribution version exactly before load.
Use CPU, eager backend, compile=False, fast=False; torch intra/inter-op threads 1.
No credentials, logging hooks, tracing, raw-input logs, external telemetry or storage.
Constructor/decide errors are generic and do not expose paths, raw inputs or tokens.
Default CLI remains unready. Add explicit optional --artifact-dir; invalid explicit
configuration exits nonzero with a generic stderr message rather than pretending ready.
The service CLI may not accept arbitrary backend import paths or remote model names.

Use `system_one(state, questions)` and exactly one choice question. Support each of
the three existing tasks with fixed task instructions. Treat patient text and candidate
labels as data, never commands. Map candidate IDs to stable synthetic option keys and
map the selected key back. Parse a strict finite probability vector covering exactly
the supplied options; rawScore is the chosen probability, not upstream confidence.
Abstain with null choice/zero score on missing/malformed answers, unknown choice,
nonfinite/boolean/out-of-range probabilities, missing options, usage indicating state
or question truncation/dropped tokens, or option collapse. Do not guess or silently
reroute. Preserve request ID and pinned identifiers in every successful response.
No tools, actions, chat-provider calls or modification to clinic/KB/workflow state.
Clear transient references after a call; do not claim secure memory erasure or hard
cancellation of a running model. The HTTP timeout retains its occupied inference slot.

TDD: expected failing tests before implementation. Cover manifest integrity, missing,
extra and symlink files, absolute path requirement, version mismatch, offline constructor
configuration, post-load mutation, default unready/explicit startup error, all three
tasks and ID mapping, selected raw probability, malformed/truncated/collapsed results,
redacted exceptions and no raw stdout/stderr. Run the existing runtime tests as a
regression check once. Self-review, commit only owned files, full report with RED/GREEN
commands; root arranges independent review. No subagents and no deployment.

Task 2 checkpoint: commit `d17cd15`, independent spec/quality review approved,
zero findings. Fake-backend tests do not qualify the actual model. ARM/Linux
symlink enforcement, native privacy, filesystem sealing and load are later gates.

### Task 3: Reproducible offline ARM package preparation (source only)

Own only new `services/laya-runtime/packaging/` files and bounded documentation
extensions to `services/laya-runtime/README.md`. Do not modify the runtime/backend,
TypeScript, production, AWS configuration or other workers' files. No subagents.
You are not alone in the checkout; preserve unrelated work. Root owns this plan
and the progress ledger. Read the Task 2 artifact constants and upstream pin first.

Produce a closed, reviewable dependency lock and standard-library package-preparation
tool for Ubuntu 24.04 ARM64 CPython 3.12 CPU only. Every downloaded wheel must have
an exact version, immutable URL, size and SHA-256; no source distributions, dependency
resolution during install, floating indexes or CUDA/NVIDIA/triton packages. The lock
must include the entire runtime and bootstrap dependency closure with Linux/ARM64/
Python3.12 markers, not Windows host markers. Parse wheel METADATA and verify the
closure, Python requirements, extras and wheel compatibility. Record provenance
and bounds of verification. Any unresolved conditional dependency is a failure,
not silently ignored. Do not execute downloaded wheels on this Windows machine.

Keep `laya==0.4.8` (wheel SHA-256
`05064d8b949803af8cb173561ed0b24d6be5b62cb86d8d319321577c630d0288`).
Use the official CPU ARM64 torch wheel, not PyPI's generic CUDA dependency graph:
`https://download-r2.pytorch.org/whl/cpu/torch-2.14.1%2Bcpu-cp312-cp312-manylinux_2_28_aarch64.whl`,
SHA-256 `2af649994b36dffc627175c3f306d9e513a309b58d4619ac7107577613336454`.
Known local source-compatible pins are transformers 5.20.1, tokenizers 0.23.3,
safetensors 0.8.0; verify their actual published ARM/Python requirements before
locking. Fetch official PyPI metadata and PyTorch's CPU index only for provenance.
If these pins cannot form an eligible target closure, stop and report rather than
substitute an unreviewed runtime. Pin a standalone pip bootstrap wheel separately;
later install may use external pip --python against venv --without-pip.

Preparation is an explicit operator action, never inference or server startup.
Download only hardcoded/locked HTTPS artifact hosts, streaming to bounded temporary
files; validate size/hash before atomic placement. Never follow caller-specified
arbitrary URLs, print headers/tokens, accept executable hooks, extract archive paths,
follow symlinks/reparse points, overwrite an existing output directory or delete a
broad directory. Reject partial/mismatched existing artifacts rather than reuse.
Use a new explicit absolute output directory, fail on unsafe destinations, and
leave a clear incomplete-package marker on failure. No runtime credentials needed.

Fetch exactly the five model files at Task 2's immutable HF revision. Verify the
original tokenizer config hash before the single documented normalization, then
verify its prepared hash/size. Reuse the production closed-manifest verification
for final validation; do not invent a second, weaker model manifest. Include
runtime source identity and hashes in package metadata, without modifying production
artifacts or claiming secure filesystem ownership from Windows.

All network functions must be replaceable by fake in-memory streams for tests.
TDD tests cover bad hashes/sizes, truncated or oversized streams, unsafe URLs/paths,
symlinks, existing destination, incomplete output, correct normalization, missing or
extra model files, wheel target compatibility and dependency closure failures.
Downloads of public artifacts into an explicit temporary directory are allowed for
metadata inspection; installation/model execution and AWS writes are not.
Run full runtime regression tests once. Self-review and commit only owned source;
write report and dependency provenance in the ignored task workspace, with exact
RED/GREEN commands and unresolved ARM execution limits. Root arranges fresh spec
and quality review of BASE..HEAD. This task does not install or deploy anything.

### Task 4: Socket-activated, isolated service boundary (source only)

Start only after Task 3 is independently reviewed. Own new `services/laya-runtime/
isolation/`, bounded `server.py` and its tests, and README extensions. Do not modify
Task 3's lock or preparation code, backend/model pins, TypeScript routing, AWS or
production. No installation, model execution, privileged local changes or subagents.
Preserve all unrelated files. Root owns this plan and the task ledger.

Use systemd 255 host socket activation plus `PrivateNetwork=yes`: systemd listens
only on host IPv4 127.0.0.1:8767 and passes exactly one listening descriptor. The
service has no host network namespace, external interfaces or host DNS path. Do not
substitute connect-only filtering or BPF-only network rules (the observed host
systemd build lacks BPF framework). Official systemd 255 socket documentation
explicitly supports this arrangement. Actual enforcement remains a later Linux
negative-probe gate. LAYA advice 5c2c8087-3972-4d69-aac3-d8e1655c6ed6 favors this
option, unqualified/advisory only; engineering evidence determines the ruling.

Add explicit `--systemd-socket` startup mode without changing ordinary/default
startup. Fail closed unless Linux, LISTEN_PID matches the current process,
LISTEN_FDS is exactly one, optional descriptor names match the fixed expected name,
and fd 3 is an IPv4 stream socket listening at exactly 127.0.0.1:8767. Reject foreign
PIDs, extra descriptors, malformed variables, wrong address/port/type/family and
connected/non-listening sockets. Do not bind a replacement listener on failure or
accept arbitrary fd numbers/import paths. Validate before loading the model;
close owned descriptors on all failures. Preserve bounded lifecycle and response
contract. Use a root-sealed, fixed-path isolated Python entrypoint with -I/-B;
never depend on cwd, user site-packages, mutable PYTHONPATH or shell interpolation.

Provide reviewable socket/service templates with an explicit immutable release
directory placeholder and a fail-closed renderer/validator, not an installer.
Release path must be below a fixed /opt/docmee-laya/releases directory, use a
single safe identity component and contain no whitespace, '..', symlinks or unit
specifier injection. A later operator must verify all ancestors, source, venv and
model files root-owned/non-writable by runtime; no mutable `current` symlink.
Socket backlog 8, no public address, no reuseport; service Requires/After socket.
Non-root DynamicUser, no capabilities, no privileges, no credential/environment
files, no host application mount and no action API. Explicit CPU/memory/task/fd
caps, single-thread inference, bounded start/stop/restart with start limits. Native
stdout/stderr go to null; do not leak model/request output into journald. Core dumps
disabled. Use supported filesystem/process/device hardening, private temp/network,
read-only installation and inaccessible known secret/app/credential paths. Apply
native-architecture syscall allowlist before subtracting connect, mount and
io_uring syscalls; do not claim directive presence proves enforcement. Avoid
unverified ProcSubset=pid or MemoryDenyWriteExecute compatibility assumptions.

Document that disabling requires stopping BOTH socket and service to prevent
reactivation, and that rollback touches only this isolated service, not Docmee.
No startup/download/upgrade hooks. Explicitly distinguish loaded health from
model qualification and disabled Docmee routing.

Add a Linux-only synthetic isolation probe, not a raw-data collector. Emit only
categorical pass/fail and exit status. Check non-root identity, inability to read
fixed application/credential paths, write release files, make outbound TCP and
unconnected UDP/DNS/metadata connections, connect to host local services, or use
unsupported families. No real secrets, patient inputs, credential reads/printing,
external requests with data or mutation of Docmee. Explain how the operator runs
the probe under the exact rendered service sandbox, not a weaker approximation.
Use synthetic canaries for readability checks when needed. Do not claim Windows
tests exercise Linux namespace/seccomp/cgroup enforcement.

TDD first. Tests cover inherited descriptor adoption and all invalid cases,
unchanged ordinary HTTP lifecycle, safe template rendering, rejection of unit/
path injection, mandatory hardening directives and probe categorical output.
Where true fd inheritance needs Linux, include runnable Linux subprocess tests
and record Windows skips; don't replace actual descriptor semantics solely with
mocks. Run all runtime/packaging tests once, self-review, commit owned files and
report RED/GREEN and enforcement limits. Root arranges fresh strongest-model
spec/quality review for full Task 4 BASE..HEAD before any deployment use.

### Task 5: Complete offline release assembly and integrity verification

Source-only. Own services/laya-runtime/packaging/prepare.py, lock_validation.py,
new packaging/release_inventory.py, focused packaging tests and README. Root
owns plan and ledger. Do not spawn agents, access AWS, install software, execute
the model, change dependency versions, modify TypeScript or enable routing.
Baseline is 6317f8ecf4b75b5fb5923093d3a987289ea0fd21. Preserve immutable layout
and distinguish reviewed runtime source baseline from later packaging commit.

Complete the existing package with runtime, model, wheels, bootstrap, lock and
requirements PLUS isolation/entrypoint.py, renderer, probe and both unit
templates. Closed source inputs must have trusted baseline hashes, not hashes
that bless whatever dirty files happen to be present. Preserve no-overwrite and
INCOMPLETE behavior. No installer, sudo, service/port mutation or activation.

TDD first: omitted isolation assets, mutated sources, missing/extra package
files, tampered inventory, size/hash failures, symlink/reparse objects and unsafe
relative paths. Use small fake streams, not large model downloads.

Generate a deterministic versioned inventory of every allowed regular file:
relative path, byte size and SHA256, plus baseline, target, model and lock
identity. No timestamps, machine-specific paths or self-hash. Emit the inventory
SHA256 for retention outside the package. Reject unexpected directories too.

Provide a read-only stdlib CLI such as:
python release_inventory.py verify ABSOLUTE_PACKAGE --inventory-sha256 HEX
The out-of-band expected digest is mandatory. Hash inventory before parsing;
bound input size, enforce exact schema and reject duplicate keys, unsafe paths,
missing/extra files/directories, symlink/reparse objects and incomplete packages.
Stream file size/hash checks. Verification must not import the runtime, download,
load a model or write anything. Document invocation from reviewed trusted source,
not blindly executing the verifier bundled inside an untrusted package. Digest
integrity is not Linux sandbox qualification.

Address Task 3 deferred M1: platform-any wheel tags must be pure Python with ABI
none. Reject cp312-cp312-any and cp310-abi3-any fixtures; preserve all current
locked artifact versions and hashes.

Run focused RED/GREEN tests, then the full runtime and packaging source suites
once and git diff --check. Report exact commands, outputs and skips. Do not
claim ARM/systemd, privacy, load or model qualification from source tests.
Self-review, commit only owned files and write the ignored task report. Next
task is disposable exact Linux sandbox qualification, separate from AWS install.

### Source publication checkpoint (2026-10-22)

Tasks 1-5 have scoped independent source reviews. Task 5 correction review at
c8662d2211cfdfb3b6b95716249d5b9bab4dd55c closes I1 (validated helper bytes now
execute directly, bypassing cached/preloaded modules); zero remaining Critical
or Important findings in that correction. All nine source pins and the lock
digest were independently compared to the trusted 6317f8ec baseline.

Publish this reviewed source increment with LAYA disabled, after the final
whole-branch review and ordinary release checks. This is not installation,
qualification, activation, full 14-item completion or owner acceptance. No model
download, dependency installation, unit activation, routing/AI-provider/KB/DB
configuration change or patient test belongs to this source-only release.
Exact ARM64/Linux containment, held-out quality/calibration, sustained resource
and failure/load testing remain gates before any later runtime enablement.

Final whole-branch review (49efb923..c8662d22) found one Important packaging
defect: the real lock's additional platform marker fields were incompatible
with the inventory's intentionally exact target schema. The single bounded
final fix wave, c7a37ecd2372635cc33c920c28526c95adc84264, projects only the
already validated required target fields into the inventory, preserving the
original lock bytes/pin and strict inventory validation. The real-lock target
regression failed before correction and now completes fixture assembly and
production verification; all 18 missing/wrong required-field cases reject
before artifact fetching. Packaging: 38 tests, two Windows privilege skips.
The independent scoped re-review approved this correction (97/100), with no
remaining actionable findings. No source-review blocker remains for this
inert-source increment; the runtime and full-goal boundaries above still apply.
