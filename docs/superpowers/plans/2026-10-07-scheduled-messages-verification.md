# Scheduled Messages: verification and controlled rollout

Status: source release `32e2989f6a8ad4097e2f5d3a5ab5ce44626569a3` was deployed with delivery disabled on 2026-10-08. Delivery readiness is not yet accepted. No external messages sent.

Product Updates and All Features include EN/ES Scheduled Messages entries explicitly marked as a controlled rollout, disabled by default until rollout checks pass and a clinic is enabled. Publication does not authorize clinic or worker enablement.

Design: [approved scope](2026-10-07-scheduled-messages.md).

## Behavior delivered

- WhatsApp composer clock opens a clinic-timezone scheduling dialog when the clinic opts in. Text and approved static templates are supported; dynamic parameters, headers, and buttons are rejected. Static FOOTER components are allowed alongside the BODY.
- Pending messages can be edited/cancelled with version checks. The collapsible list preserves pending, sending, and uncertain rows independently of the bounded terminal history.
- Scheduling alone does not create a chat message or pause the bot. Provider-confirmed sending writes the timeline and conversation activity atomically; current conversation metadata is preserved, and closed conversations are not reopened.
- Delivery revalidates clinic/author access, consent, conversation state, original recipient/account, approved template structure, and the account-specific inbound window. Legacy messages without account provenance fail closed; legacy templates without components must be synced before eligibility.
- UTC persistence, clinic-local presentation, and rejection of ambiguous/nonexistent DST input avoid guessing a time. Existing schedules retain their original timezone and instant.
- Database rows are authoritative; Redis contains ID/version wakeups. Atomic claims prevent concurrent workers from sending the same claim. Reconciliation recovers missed wakeups; messages over 15 minutes late are blocked.
- A sending attempt older than five minutes becomes delivery_unknown. Timeouts or missing provider IDs are not automatically resent. This intentionally prioritizes avoiding duplicates over guaranteed delivery; it is not an exactly-once guarantee.
- New-create response recovery retains the same payload/key across dialog close/reopen while the component/session remains mounted. A reload/navigation does not retain that local recovery reference: inspect the persisted schedule list before making another request.
- EN/ES labels, a native modal dialog, accessible controls, session-bound requests, and preservation of unrelated composer drafts are implemented. Real browser behavior still requires acceptance testing.

## Final local evidence (2026-10-07)

Base: `566c46d8d06bd952a83befa51eed90363f331657`, branch `codex/sidebar-overflow-20261002`. Unrelated `.claude/` work preserved.

| Check | Result | Provenance |
| --- | --- | --- |
| Full Inbox suite | 581 passed, 84 files | Coordinator, release source including product catalog coverage |
| API scheduling route/context | 18 passed, 2 files | Coordinator, final source |
| Worker scheduling/reconciliation/transcription | 26 passed, 3 files | Coordinator, final source |
| Scheduled repository | 6 passed, 1 file | Coordinator, final source; SQL assertions, not DB execution |
| Shared package | 17 passed, 5 files | Coordinator, final source |
| TypeScript | Inbox/API/workers/DB/shared/queue passed | Coordinator |
| Translation keys | 2312 EN and 2312 ES; direct usages passed | Coordinator |
| Full API/workers/DB suites | 555 passed + 8 skipped / 444 passed / 167 passed | Backend implementer after final backend fixes |
| Fresh-context review | Pass with conditions; four findings fixed | Same-model reviewer; not independent-model assurance |
| Whitespace | `git diff --check` passed | Coordinator/reviewer; existing CRLF normalization warning only |

Tests use existing local package executables. The package-manager shim could not fetch its configured version, so no dependencies were installed. Docker CLI exists but its local Linux engine pipe was unavailable; no isolated database execution was possible in this run. No Docker service, production DB, worker runtime, AWS resource, or provider was started/changed.

Review corrections: confirmed-send activity timestamps; current target-clinic access for original author identity; unbounded actionable rows despite bounded history; preservation of a draft when scheduling a template or different text. Added session-bound UI transport prevents a stale-session write or implicit authentication retry.

## Required before production enablement

1. Run the migration and repository integration suite against an isolated PostgreSQL instance with synthetic records. Exercise RLS under a restricted role, cross-clinic access, unique idempotency keys, concurrent claim/edit/cancel, confirmation CTE atomicity, current metadata merging, and close-during-send. SQL-string unit tests do not prove these properties at runtime.
2. Use isolated Redis and a mocked provider to test restart recovery, multiple workers, failed wakeups, stale attempts, late confirmations, lost provider responses, and cancellation at the due boundary. Verify zero provider calls after a failed eligibility check.
3. In a real browser, test keyboard focus/Escape, mobile layout, EN/ES, clinic switching/logout during requests, unrelated draft preservation, same-key recovery after a lost create response and close/reopen, disabled-clinic replay, edit conflicts, cancellation, timeline refresh, and long pending/history lists.
4. Run a production build and the existing release regression checks. Confirm ordinary immediate replies, inbound text/audio, workflow execution, KB, and booking paths remain unchanged. Passing unit/type checks alone is not release proof.
5. Obtain release and pilot authorization. Apply `packages/db/supabase/migrations/20261007000001_scheduled_messages.sql` before deploying code that queries the new table/component column; these reads exist even while delivery is disabled. Use the project's approved migration/release process and verify rollback compatibility.
6. Deploy with clinic opt-ins false/absent and `SCHEDULED_MESSAGES_WORKER_ENABLED` false/absent. Verify exact live build and service health; do not publish this feature as enabled merely because its source is deployed.
7. Only after the preceding gates, opt in a designated test clinic and enable its worker environment under explicit authorization. Verify a synthetic, authorized test-recipient send and provider receipt before patient use. This document is not authorization to enable or send.

## Pause, rollback, and unknown outcomes

- Disable clinic opt-in to block new schedules/edits and subsequent delivery revalidation; pending cancellation remains available. This cannot revoke a provider call already in flight.
- Stop/disable scheduled-message workers to prevent future claims. Preserve all schedule and audit rows. Re-enablement must account for pending due rows and the overdue grace; it is not a fresh queue.
- Do not reset sending/delivery_unknown rows to pending or blindly resend them. Reconcile against provider evidence using a separately authorized operational process. There is no automatic uncertain-outcome recovery send.
- Keep the additive table/component column during application rollback; do not drop durable pending or audit evidence. The existing immediate-send path remains separate.
- Do not change `docmee.ai`, clinic AI settings, KB, booking configuration, or provider credentials as part of this feature rollout.

## Acceptance states

- Local source and automated checks: complete for this bounded implementation.
- Runtime integration / browser acceptance / production build: not verified.
- Migration / disabled deployment: completed in the release evidence below. Clinic enablement / patient sends: not performed.
- Disabled-release `execution_complete`: true; delivery-readiness `execution_complete`: false.
- `owner_accepted`: false (awaiting user acceptance).

## Delivery-readiness work contract (2026-10-08)

Objective: strengthen executable failure/recovery coverage and provide an opt-in, synthetic-data integration harness for the actual scheduled-message migration and repository. This is verification work, not authorization for patient delivery.

Scope: scheduling unit tests, an isolated local PostgreSQL harness, and this existing acceptance record. Preserve unrelated `.claude/` work. Non-goals: enabling clinics/workers, sending WhatsApp messages, changing `docmee.ai`, provider credentials, AI/KB/booking settings, or repairing the workstation's Docker installation.

Acceptance: fresh focused tests and relevant typechecks; harness rejects non-local/shared database targets and never falls back to `DATABASE_URL`; real SQL checks cover idempotency, competing claims/edits/cancellation, RLS isolation, stale reconciliation, and atomic confirmed-send persistence. Unrun integration/browser/pilot checks remain explicitly incomplete. Stop before external sends, unsafe database targets, or unavailable isolated dependencies.

Local prerequisite: Docker Desktop failed to start (Windows inference socket initialization); WSL Ubuntu has no PostgreSQL or Redis server. Do not bypass isolation by using production.

### Fresh readiness checks

Source: `32e2989f6a8ad4097e2f5d3a5ab5ce44626569a3`, branch `codex/sidebar-overflow-20261002`; readiness edits are local and uncommitted. No production code or runtime configuration changed.

| Check | Result | Scope |
| --- | --- | --- |
| Worker scheduling/reconciliation | 22 passed, 2 files | Includes failed revalidation, uncertain send/confirmation persistence, missed wakeup recovery, non-overlapping ticks and malformed jobs |
| Full worker suite | 452 passed, 41 files | Existing suite emitted local Redis connection-refused warnings; not Redis integration proof |
| Full DB unit suite | 167 passed, 23 files | Includes scheduling repository assertions and migration planning; not real database execution |
| Integration target guard | 6 passed | Explicit opt-in, separate local database, no shared/remote/query-override target or `DATABASE_URL` fallback |
| Worker and harness TypeScript | Passed | Existing local executables; dependency path restriction required scoped execution outside sandbox |
| Touched source ESLint | Passed | Tests and isolated harness |
| SQL suite without opt-in | Refused before client creation | Expected safety rejection; not an integration pass |

The [isolated SQL harness](../../../scripts/scheduled-messages/README.md) adds nine executable checks using the actual migration/repository. It creates and cleans only its randomly named schema and restricted role in an explicitly supplied disposable local test database. Its minimal synthetic dependency schema does not prove the complete historical migration chain. Localhost guardrails cannot distinguish a local server from a tunnel; do not use a production/shared tunnel.

The nine SQL checks remain **unrun** because isolated PostgreSQL is unavailable. Isolated Redis/multiple-worker restart checks, real browser acceptance, production build and authorized test-recipient/provider receipt also remain incomplete. Docker was started hidden as a prerequisite check, then failed initialization; no socket deletion, workstation repair, production database access, clinic enablement or external message occurred. Delivery-readiness `execution_complete` and `owner_accepted` remain false.

## Disabled deployment evidence (2026-10-08)

Previously recorded release evidence: encrypted RDS snapshot `docmee-predeploy-32e2989-20261008-230335` was Available before migration. SSM deployment `fd147acd-bb93-4cbf-8441-2bc494058639` and verification `255b9635-eb76-4326-982a-f7de86e50d39` both succeeded (response code 0). The additive migration was recorded, migration drift was zero, and `docmee.service`/Caddy were active. External health returned HTTP 200 with `git-32e2989f6a8a`. Product Updates and All Features carried controlled-rollout entries.

At that verification: zero enabled clinics and `scheduledDeliveryEnabled: false`. Snapshot restore, live scheduled delivery, and owner acceptance were not tested. These are prior release observations, not a fresh runtime probe from the readiness work.

## Release preflight (2026-10-07)

- Origin fetch succeeded; the source branch matched its upstream at the base commit above before preparing this release.
- Fresh external `/api/health` returned `ok: true`, service `docmee-api`, build `git-566c46d8d06b`, matching the release base.
- Fresh source-profile STS verification reported an expired session. No SSM deployment command or database migration was submitted. Deployment must wait for renewed authentication and verification of the expected non-root deployment role.
- Re-ran the full Inbox suite, focused API/worker/repository suites, shared suite, all six package typechecks, translation validation, and whitespace checks successfully for release preparation.
- Production requires migration preflight and the approved backup gate before applying the additive migration; then the existing safe build/deploy path and exact external build verification. The new table is queried even with scheduled delivery disabled.

## Historical migration recovery (2026-10-08)

Authenticated read-only SSM preflight found seven names in the live `_migrations` ledger absent from release `d963273709820f441aca5e37bc3266d2ca8baa9d`. The live checkout remained clean at `566c46d8d06bd952a83befa51eed90363f331657`. The guard correctly blocked deployment; it was not bypassed.

Restored the original files byte-for-byte from existing backups, with SHA-256 verification. Backup roots are under `C:\Users\Mikazuki\Dropbox\Docmee`; server rollback copies were inspected as `ubuntu` through SSM invocation `a4d0f3c6-b424-4b79-bf5c-05bcd67fd148` (Success, response code 0).

| Migration filename | Verified original source | SHA-256 |
| --- | --- | --- |
| `20260708000100_default_inactivity_timeout_15.sql` | Three matching server copies: `docmee-rollback-20260720033648`, `docmee-rollback-emailfix-202607200414`, and `docmee-rollbacks/docmee-cre520-20260721T0350Z`, under `/var/www` | `D058664D850119947CB4C9338F1502B83C99C30939975A255C5E75DD03A5CE53` |
| `20260710000100_default_inactivity_timeout_15.sql` | `Docmee_Backup070726/packages/db/supabase/migrations` | `9F517845BD82EAC26136EFC044071C7F7BF3EDABC49A82546B6448209F222CC4` |
| `20260719000001_enforce_authenticated_rls.sql` | Same backup directory | `3D8A6899A5A5143642BA6448D2DD3E8B41B51BC38C3AAE242F16176B55320A63` |
| `20260719000002_governance_rls.sql` | Same backup directory | `E6EA5E86F42A51F7A4C82BB3F8D86FD42EB51B9DCE5D1A67948211FB12F47F62` |
| `20260719000003_launch_readiness_rls.sql` | Same backup directory | `558B4597FDBB6FE041CF6D079AB67FC98B281A1FAED243E134A0433CF4F177CD` |
| `20260719000004_memberships_rls.sql` | Same backup directory | `5898F34FC0962B1BDEE0987258CDD58A61EF73577F72FC35D72E0358F8ADF1E1` |
| `20260720000100_message_templates_authenticated_access.sql` | `Docmee_release_CRE520_20260720033648/packages/db/supabase/migrations` | `692504DE1C0B21AB2CE66642E89D707013D460B81854A222FD8D539C60458C65` |

This is source-history reconciliation, not SQL execution. Do not delete/change ledger rows or manually rerun the restored migrations. Live metadata already records all seven as applied; later migrations retain the current inactivity default of 30 minutes. A fresh live comparison against the reconciliation commit must confirm zero unknown names and only `20261007000001_scheduled_messages.sql` pending before any migration runs.

Recovery verification: all seven working-tree SHA-256 hashes match the originals above; the existing DB suite passed 167 tests across 23 files, including seven migration-plan tests, and the DB TypeScript check passed. Initial sandbox runs could not resolve dependency realpaths; the same checks passed after approved execution outside that filesystem restriction. These are local checks, not live DB integration or fresh-install proof.

No database migration, build promotion, service restart, clinic enablement, or patient send occurred during recovery. A verified fresh RDS snapshot remains required before the pending additive migration; source backups are not database backups. The deployment role could not inspect RDS snapshots (`rds:DescribeDBSnapshots` denied). Do not expand IAM or use another identity implicitly to bypass this gate. Scheduled delivery stays disabled and `docmee.ai` is excluded.
