# LAYA integration execution contract

Status: local implementation in progress; not deployed or qualified for patient use.

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
| 1 | Read-only AWS capacity assessment | RAM/CPU/disk/peak load; AWS identity not yet verified |
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
- Fresh support-profile STS check confirms the non-root source IAM user. The separate
  deployment role is awaiting private MFA; no SSM deployment has started. Public health serves
  `git-61dff75f048d`, not this pending increment.
- Review used a fresh-context read-only subagent because the available Claude MCP did
  not provide verified direct filesystem access. This substitution is not deployment
  approval or model qualification.
- Independent re-review ran seven focused files / 117 tests successfully, including
  26 KB tests, and passed both release-review corrections with no remaining blocker
  in that bounded review. It did not assess deployment readiness or full integration.
- These are local software checks and bounded review, not measured model accuracy,
  deployment, AWS capacity, live patient-flow acceptance or owner acceptance.
- Next gates: authenticated AWS deployment access and disabled-foundation publication;
  then intent/workflow execution wiring, pinned runtime qualification,
  live capacity measurements and staged rollout evidence. The 14-item integration is
  not complete, and no live model accuracy or owner acceptance is established.
