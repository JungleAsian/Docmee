# Private LAYA HTTP boundary

Source-only, **uninstalled and unqualified**. No model, calibration, credentials,
inference library installation, model download, DB, action tools or Docmee routing is included.
Python 3.10+ standard library only; locally tested on Python 3.11.15.

From the repository root:

```powershell
python -m unittest discover -s services/laya-runtime/tests -v
python services/laya-runtime/server.py --host 127.0.0.1 --port 8767
```

By default the CLI has no backend: GET `/health` is process liveness (200), GET `/ready`
and POST `/v1/decision` remain unavailable (503). It never pretends to infer.
Ctrl+C closes the listener. This is not a service installation or deployment.

For a separately reviewed local integration, import `RuntimeServer` from `server`
with this directory on the module path, inject a trusted `Backend` satisfying the
protocol, and own `serve_forever` / `shutdown` / `server_close` lifecycle. The
backend's `ready`, `model_version`, and `calibration_version` must be nonblocking
plain attributes. Nonempty version identifiers are pinned when the server is
constructed; changes make readiness fail closed. `decide(request)` returns exactly
the TypeScript adapter response schema. Readiness is not model qualification.
Backend implementations must neither log nor retain inputs and must not mutate
the request. No packaging or qualified production backend is supplied here.

## Explicit pinned offline backend (not qualification)

`--artifact-dir C:\absolute\prepared\checkpoint` opts into `PinnedBackend`.
Invalid explicit configuration exits 1 with only `backend unavailable` on stderr.
No arbitrary backend imports or remote model names are accepted by the CLI.
The default invocation remains unready and needs only the standard library.

The optional loader requires already-installed `laya==0.4.8` and its reviewed
dependencies. Checkpoint provenance is `convaiinnovations/laya-multilingual` at
`e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`. `artifacts.py` contains the closed
size/SHA-256 manifest: exactly five regular files and their ancestor directories;
absolute paths only, no symlinks, Windows reparse points, traversal or extra files.
Files are stream-verified before Agent import and again after loading. Runtime
never downloads, repairs, normalizes, or writes artifact files.

Offline preparation must normalize the upstream tokenizer config (502 bytes,
SHA-256 `424b69444bf7b5809dc2cd2e36d0bd71b8055124dd24274d6db3c655d38205e7`):
replace `extra_special_tokens` with the ordered `extra_0`/`extra_1` mapping,
serialize with Python `json.dumps(indent=2)`, UTF-8 and no terminal newline.
The resulting 524-byte file must match the built-in digest. Preparation and
dependency installation are not provided or authorized by this runtime.

Loading sets offline/telemetry environment controls before ML imports, CPU eager
execution, `compile=False`, `fast=False`, and one torch intra/inter-op thread.
One fixed Choice question handles each supported task; synthetic option keys map
back to caller IDs. Patient text and labels are JSON data, not task instructions.
Missing/malformed answers, incomplete/nonfinite/invalid probability vectors,
truncation, dropped state tokens and collapsed options abstain. `rawScore` is the
selected option probability, never upstream confidence. Prompt separation is not
a model-quality or prompt-injection-resistance qualification.

Ready means loaded only. Identifiers are `laya-multilingual-e4e9ddf21a7b` and
`upstream-unqualified-v1`. Do not enable live routing based on these identifiers.
Later packaging must prevent concurrent writes to the actual artifact directory:
pre/post checks detect mutation but do not eliminate races. Python output is
discarded during upstream load/inference, without buffering raw output. This is
not a sandbox for native dependencies or arbitrary logging handlers. No logging
hooks, tools, credentials, trace sinks, caches or input storage are configured.
Transient local references are released after calls; no secure erasure or hard
model cancellation is claimed. Existing HTTP timeout slot retention is unchanged.

## Resource and privacy boundary

- Literal IPv4 `127.0.0.1` only. No authentication is provided: trusted same-host
  isolation is required. Do not proxy or expose this listener to other hosts.
- Four connection workers by default (configurable 2..8), no userspace request
  queue, listen backlog eight, exactly one unsettled inference. Excess capacity
  receives generic 503. Health does not acquire the inference slot.
- One-second absolute header/body read deadline and send timeout; inference caller
  deadline 750ms (both configurable to positive values <=5 seconds).
- At most 32 headers / 8192 total request-line-plus-header bytes, 2048 request-line
  bytes, 32768 body bytes and 8192 serialized response bytes. JSON uses strict
  UTF-8, duplicate-key rejection, exact schema and UTF-16 length accounting.
- No transfer/content encoding, Expect, duplicate headers, query strings or
  persistent connections. Every connection handles at most one request and closes;
  pipelined trailing data is discarded, never dispatched. A bounded 10ms / 40960-byte
  trailing drain after write-half-close avoids Windows TCP resets erasing errors.
- Inference timeouts do not kill Python computation or free the slot. A hung
  backend leaves the service inference-busy until it settles; operator process
  replacement is the eventual recovery boundary. At most one daemon inference
  thread exists. Shutdown closes the listener/connections without waiting forever
  for a backend. No backend cancellation or unsafe thread termination is attempted.
- No access/body/exception logging, caches or storage. Input references are cleared
  after inference settles; in-flight backend input necessarily remains in memory.
  Python memory is not securely erased. Generic failures never echo input, request
  identifiers, pins, exceptions or model text. A trusted injected backend itself
  must comply with the logging/retention contract; it is not sandboxed.

Independent review, supported-version CI, a real pinned/calibrated model/backend,
deployment packaging and operational qualification are later gates. These local
synthetic HTTP tests do not establish model quality, production readiness or owner
acceptance.

## Source-only offline ARM64 package preparation

The separate `packaging/prepare.py` command now supplies explicit preparation;
the runtime never invokes it. It targets **Ubuntu 24.04 ARM64, CPython 3.12,
CPU only**, not this Windows test host. No installation, model inference, service
setup, deployment, calibration, or qualification has been performed by this work.

```powershell
python -m unittest discover -s services/laya-runtime/packaging -p 'test_*.py' -v
python services/laya-runtime/packaging/prepare.py --output C:\absolute\new-laya-package
```

The output must be a new absolute local directory whose parent already exists.
Existing destinations (including partial packages), unsafe names, symlinks and
reparse points are rejected. Preparation downloads public locked artifacts only;
it needs no Hugging Face token or runtime credentials. HTTPS artifact/redirect
hosts are hardcoded; ambient proxy/authentication/cookie configuration is not used.
Files stream into size-bounded temporary files and are SHA-256 checked before
atomic non-overwriting placement. The filesystem must support same-directory
hard links. An `INCOMPLETE` marker remains on failure: never install/load that
output, even if some files or `package.json` exist. Choose a fresh destination
for a new attempt; this tool does not resume, overwrite or recursively delete.

`packaging/arm64-cp312.lock.json` records 35 runtime wheels and one separate
standalone pip bootstrap wheel, each with exact version, immutable URL, size,
artifact and METADATA SHA-256, Python requirements, dependencies, extras and
version-specific provenance. It retains `laya==0.4.8`, the official
`torch==2.14.1+cpu` ARM wheel, `transformers==5.20.1`, `tokenizers==0.23.3`, and
`safetensors==0.8.0`. CPU torch has no CUDA/NVIDIA/triton requirements.
`sympy==1.14.0` requires `mpmath<1.4`, so `mpmath==1.3.0` is deliberately pinned.
No optional extras are requested. Conditional requirements are evaluated against
Linux/aarch64/CPython 3.12, never Windows. Requested transitive extras propagate
to a fixed point. Unknown markers, unsupported version syntax/tags, missing
dependencies, incompatible versions/Python requirements and unused wheels fail
closed. The standard-library validator is intentionally a bounded verifier for
this lock, not a general package resolver. Platform-`any` wheels must have pure
Python (`py...`) interpreter tags and ABI `none`; native `cp312-cp312-any` and
`cp310-abi3-any` tags are rejected. Existing versions and artifact hashes are unchanged.

Preparation reads wheel METADATA without extraction or code execution, fetches
exactly the five immutable checkpoint files, verifies the original tokenizer
bytes before the documented normalization, then calls `artifacts.verify_artifacts`
for final prepared-model validation. The package contains `runtime/`, `model/`,
`wheels/`, `bootstrap/`, `isolation/` (entrypoint, renderer, probe and both unit
templates), hash-only `requirements.txt`, a lock copy, `package.json`, and
`release-inventory.json`. No venv, installer, service activation, mutable release
symlink, routing enablement or deployment is created.

All nine copied runtime/isolation source inputs and the lock must match exact
size/SHA-256 pins taken from Git blobs at reviewed source baseline
`6317f8ecf4b75b5fb5923093d3a987289ea0fd21`. A dirty source is rejected, not
silently blessed with its current hash. Use LF checkout bytes for these inputs;
CRLF conversion is intentionally not normalized or trusted. The preparer executes
its `artifacts.py` helper directly from the retained, hash-checked source bytes in
a fresh private namespace, ignoring bytecode caches and preloaded `artifacts` modules.
`runtime_origin_commit`
retains the earlier backend baseline `d17cd150b11d9ed3efa91ac74d9a0a5dc312f44d`;
it is not a claim that the later isolation/runtime content equals that old commit.
The later packaging implementation commit is recorded **outside** the package
beside the inventory digest; embedding its own final commit would be self-referential.

### Read-only package integrity verification

The version-1 inventory deterministically records every allowed regular payload
file's POSIX relative path, byte size and SHA-256, plus reviewed source baseline,
runtime origin, target, model repository/revision and lock identity. Files are
sorted; serialization has no timestamp, machine path or inventory self-hash.
Preparation rejects unexpected files **and directories**, checks the final closed
tree before removing `INCOMPLETE`, and prints `inventory-sha256: HEX`.
Retain that digest with the reviewed packaging commit in a trusted record outside
the package. A digest obtained only from the received package is not a trust anchor.

Run the verifier from a separate **reviewed trusted source checkout**, never
blindly execute Python from an untrusted received package. For example:

```powershell
python -I -B C:\trusted\docmee\services\laya-runtime\packaging\release_inventory.py verify C:\absolute\received-package --inventory-sha256 RETAINED_64_LOWERCASE_HEX_DIGEST
```

This stdlib-only command hashes the inventory **before parsing**, requires the
out-of-band digest, bounds inventory input to 1 MiB and 4096 entries, requires an
exact schema, rejects duplicate keys/nonfinite values/unsafe or aliased paths,
missing/extra files or directories, `INCOMPLETE`, symlinks and Windows reparse
objects, and stream-checks file sizes/hashes (at most 1 GiB per file). It only
reads and hashes; it does not import the runtime, download, install, load a model,
write caches or repair files. Exit 0 / `release:PASS` means integrity matched the
retained digest, **not** ARM/systemd, privacy, load or model qualification.
Use trusted exclusive filesystem access during verification and later sealing;
these checks do not prevent a concurrent writer replacing files afterward.

A later, separately authorized Ubuntu operator may create a venv **without pip**
and run the locked external bootstrap against that interpreter, for example:

```sh
python3.12 -m venv --without-pip /absolute/laya-venv
python3.12 /absolute/package/bootstrap/pip-26.2.2-py3-none-any.whl/pip --isolated --python /absolute/laya-venv/bin/python install --no-index --no-deps --only-binary=:all: --require-hashes --find-links /absolute/package/wheels -r /absolute/package/requirements.txt
```

These commands are a future installation procedure, not evidence of installation.
All locked wheels were downloaded into a disposable public-artifact research
directory and their bytes/METADATA checked on Windows; none were installed or
executed. Full real model-package preparation and ARM execution remain untested.
The target interpreter patch version, Ubuntu ABI/shared-library availability,
native code, dependency behavior and model quality require ARM-side verification.
One real-symlink test may skip on Windows without symlink privilege; metadata
fixtures still exercise symlink/reparse rejection. Operators must ensure exclusive
trusted filesystem access during preparation and later loading and establish
ownership/permissions on Linux. These path checks do not enforce ownership,
eliminate concurrent-writer races, create a sandbox or establish production safety.

## Source-only isolated service boundary (systemd 255)

`isolation/` adds reviewable templates and a stdout-only renderer, **not an
installer**. Nothing in this change starts, downloads, installs, upgrades, or
enables a service or Docmee routing. The service has no action API or application
mount. Its fixed HTTP boundary remains unauthenticated and private to trusted
same-host callers; do not proxy it. Loaded `/ready` health is not model
qualification, security acceptance, or permission to enable routing.

The host socket is exactly IPv4 `127.0.0.1:8767`, backlog eight, no reuseport.
`--systemd-socket` is an explicit Linux mode: it consumes fd 3 only after checking
the exact current PID, one descriptor, optional `docmee-laya` descriptor name,
IPv4/TCP/listening status and fixed address. Failure closes the owned fd and exits
without binding a replacement or importing/loading the backend. Ordinary/default
startup is unchanged. The helper owns fd 3 only; rejected extra descriptors close
when the fail-closed CLI process exits. It never scans or closes guessed unrelated
descriptors. A fixed Linux default-action SIGALRM timer bounds backend plus server
initialization to 60s after activation validation; it is canceled only after both
initializations (or on failure). There is no CLI/environment deadline override.
This is a startup bound, not steady-state readiness or model qualification;
`Type=exec`/`TimeoutStartSec` alone would not bound a hung native model load.
The service requires/starts after the socket, but runs in a
private network namespace, without host interfaces or host DNS files. Host
communication is possible only on the inherited listener. This arrangement is
documented by [systemd 255 socket activation](https://www.freedesktop.org/software/systemd/man/255/systemd.socket.html).
It does not depend on the unavailable BPF framework. Connect-only filtering would
not block unconnected UDP; the private namespace is essential, in addition to the
native-architecture syscall allowlist followed by connect/mount/io_uring denials.

Render candidates for review, one unit at a time, for example:

```powershell
python services/laya-runtime/isolation/render.py --release /opt/docmee-laya/releases/release-20261021-a --unit docmee-laya.socket
python services/laya-runtime/isolation/render.py --release /opt/docmee-laya/releases/release-20261021-a --unit docmee-laya.service
python -m unittest discover -s services/laya-runtime/isolation -p test_isolation.py -v
```

The immutable release layout is fixed: `venv/bin/python`, `runtime/` (the four
reviewed runtime sources), `model/` (verified pinned checkpoint), and `isolation/`
(the reviewed entrypoint, renderer, probe and both templates). The preparation
package now includes this closed isolation set and a verifiable inventory; it
does not create `venv/`. A later authorized operator must verify the retained
inventory digest before installation, then inspect and seal the installed venv
and entire immutable release. There is no implicit install hook. Use one safe release identity below
`/opt/docmee-laya/releases`; no dots, whitespace, shell syntax, unit specifiers,
extra components or mutable `current` symlink. The renderer integrity-checks both
templates and rejects existing symlink/reparse ancestors on Linux. It can render
an as-yet nonexistent release for source review. Windows rendering checks syntax
and template integrity only, not future Linux filesystem identity.

Before any Linux activation, a separately authorized operator must:

- Verify every release ancestor and every source, venv/interpreter/library and
  model file is trusted, root-owned and not writable by the DynamicUser identity,
  groups, ACLs or any concurrent runtime writer. Inspect interpreter symlink
  targets too; never use a mutable release symlink. These checks and immutable
  placement must exclude concurrent replacement races. The fixed `-I -B`
  entrypoint additionally rejects unsafe source ancestry before adding only the
  fixed release's `runtime/` path; it does not replace full venv/model sealing.
- Review the actual rendered units with systemd 255's `systemd-analyze verify`,
  treating unsupported directives as failures. Verify namespace, seccomp, cgroup,
  mount and address-family support on the actual ARM64 host. Inspect the effective
  unit and all drop-ins; do not infer enforcement from directive presence.
- Confirm the denied application/credential locations match the host inventory.
  No host application is mounted. Known app, cloud, credentials, home, SSH,
  private-key, system-manager, bus and DNS locations are masked. Do not relax a
  mask to accommodate a model dependency. `PrivateDevices`, filesystem/process
  protection, no capabilities and no new privileges are explicit. Neither
  `ProcSubset=pid` nor `MemoryDenyWriteExecute` compatibility is assumed.
- Verify the model fits CPU quota 100%, memory high 2500M/max 3G/no swap, 16 tasks,
  64 fds and single-thread inference. Start is bounded to 60s, stop to 5s,
  failure restart delay 5s with at most three starts per 300s, process lifetime
  one day, and control-group termination. These values are source policy, not
  measured model fit. Native stdout/stderr are null, not journald; core dumps
  are disabled. No credential/environment files or startup/download hooks exist.

### Exact-sandbox synthetic negative probe (later Linux gate)

`isolation/probe.py` is Linux-only and emits fixed `category:PASS|FAIL` lines plus
exit status. It does not accept raw input, read file contents, enumerate secrets,
print errors/addresses or collect request/model data. It tests non-root identity;
masked synthetic app/credential canaries; inability to open its root-sealed file
for writing (without writing/truncating); outbound TCP; unconnected zero-byte UDP,
DNS and metadata destinations; host loopback connection; and unsupported socket
families. TCP refusal/timeouts do not count as enforcement. DNS uses a synthetic
TEST-NET resolver, not a real lookup. An unexpectedly successful UDP probe emits
only an empty datagram, never user data.

Run only in a separately authorized Linux qualification environment. First place
and verify **synthetic, non-secret**, harmless readability canaries at exactly
`/opt/docmee/.laya-isolation-canary` and
`/run/credentials/.laya-isolation-canary` outside the sandbox. Do not create or
modify Docmee application files on production for this test; use a disposable
host with these fixed paths. A missing host canary invalidates the readability
result: ENOENT inside the masked namespace is meaningful only with this host-side
precondition. Never substitute real credential files.

To test the exact service sandbox, stop BOTH candidate socket and service. Use
the reviewed rendered service on the disposable Linux host and a reviewed
temporary override with only these execution/lifecycle differences:

```ini
[Service]
ExecStart=
ExecStart=/opt/docmee-laya/releases/release-20261021-a/venv/bin/python -I -B /opt/docmee-laya/releases/release-20261021-a/isolation/probe.py
Restart=no
```

Retain every other rendered sandbox/resource/output directive, same release,
DynamicUser, unit dependencies and socket. Inspect the effective merged unit;
then run the one-shot candidate service with its socket and check
`ExecMainCode=exited` and `ExecMainStatus=0` (failure is nonzero). Stdout/stderr
remain null; do not redirect probe/native output into journald or weaken the
policy to view it. Categorical lines are useful only in an equivalently reviewed
captured test harness; exit status is the exact-unit gate. Stop both units again,
remove the temporary override and recheck the effective original unit before a
separately authorized inference check. An unsandboxed shell invocation, manual
`sudo -u`, or a partial `systemd-run` approximation is not acceptance evidence.
No installation/start commands are executed or automated by these sources.

Disabling requires stopping **both `docmee-laya.socket` and
`docmee-laya.service`**: stopping the service alone leaves socket reactivation
possible. Disable both for persistent shutdown if they were later enabled.
Rollback changes/stops only these isolated units and their reviewed immutable
release selection; it never edits/restarts Docmee, changes its routing, touches
AWS or deletes model/releases. Remove the probe override before normal use.

Windows tests exercise source policy, rendering, real local socket validation and
ordinary HTTP behavior. Runnable Linux subprocess tests exercise actual inherited
fd 3 across a launcher-to-isolated-interpreter exec, matching PID metadata, HTTP
health and closure; a CLOEXEC control verifies rejection when fd 3 is not inherited.
Separate in-process socket cases retain malformed-metadata/type/address/listener
validation. Synthetic TCP fixtures consistently set SO_REUSEADDR before fixed-port
binds to avoid TIME_WAIT coupling; production socket policy is unchanged, with no
SO_REUSEPORT. These Linux tests are skipped on Windows. Neither those
tests nor source directives prove namespace/seccomp/cgroup/native-library
enforcement. Linux negative probes, ARM compatibility/model fit, independent
security review and model qualification remain pending. Docmee routing stays
disabled.

A Linux subprocess regression also arms a short test-only deadline and verifies
kernel SIGALRM termination of a hung synthetic startup; Windows skips this actual
signal test and runs only timer-orchestration checks, not Linux enforcement.
