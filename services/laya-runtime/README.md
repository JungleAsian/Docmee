# Private LAYA HTTP boundary

Source-only, **uninstalled and unqualified**. No model, calibration, credentials,
inference library, model download, DB, action tools or Docmee routing is included.
Python 3.10+ standard library only; locally tested on Python 3.11.15.

From the repository root:

```powershell
python -m unittest discover -s services/laya-runtime/tests -v
python services/laya-runtime/server.py --host 127.0.0.1 --port 8767
```

The CLI has no backend: GET `/health` is process liveness (200), GET `/ready`
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
the request. No production backend or packaging is supplied here.

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
