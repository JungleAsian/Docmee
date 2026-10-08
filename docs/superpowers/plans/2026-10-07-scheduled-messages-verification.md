# Scheduled Messages: verification and controlled rollout

Status: local source implemented and reviewed; delivery disabled by default. Owner authorized commit, push, and disabled deployment on 2026-10-07. Release execution and live evidence must be recorded separately; this document is not proof of deployment. No external messages sent.

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
- Migration / deployment / clinic enablement / patient sends: not performed.
- Release `execution_complete`: false (authorized; deployment pending authentication and release gates).
- `owner_accepted`: false (awaiting user acceptance).

## Release preflight (2026-10-07)

- Origin fetch succeeded; the source branch matched its upstream at the base commit above before preparing this release.
- Fresh external `/api/health` returned `ok: true`, service `docmee-api`, build `git-566c46d8d06b`, matching the release base.
- Fresh source-profile STS verification reported an expired session. No SSM deployment command or database migration was submitted. Deployment must wait for renewed authentication and verification of the expected non-root deployment role.
- Re-ran the full Inbox suite, focused API/worker/repository suites, shared suite, all six package typechecks, translation validation, and whitespace checks successfully for release preparation.
- Production requires migration preflight and the approved backup gate before applying the additive migration; then the existing safe build/deploy path and exact external build verification. The new table is queried even with scheduled delivery disabled.
