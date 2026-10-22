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
