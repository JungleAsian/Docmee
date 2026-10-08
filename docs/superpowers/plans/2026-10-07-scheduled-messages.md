# Scheduled Messages: controlled local implementation

Status: local implementation and automated checks complete; deployment/runtime acceptance not performed. See [verification and rollout gates](2026-10-07-scheduled-messages-verification.md). No deployment or patient sends authorized in this task.

## Scope

WhatsApp staff-authored delayed text and approved-template messages. Independent durable queue, default-disabled clinic setting and worker switch. Scheduling does not pause automation, create timeline messages, reopen a conversation, or change immediate reply behavior. Database is authoritative; queue is a wake-up mechanism. No new dependencies or provider changes.

## Contract

- GET `/conversations/:id/scheduled-messages`: `{ enabled, timezone, messages }`.
- POST same: `{ kind: 'text'|'template', content?, templateId?, scheduledAt, timezone, idempotencyKey }`.
- PATCH `/:messageId`: same editable fields plus `version` (no idempotencyKey required).
- POST `/:messageId/cancel`: `{ version }`.
- Each message: `id, kind, content, templateId, scheduledAt, timezone, status, version, reasonCode, createdAt` (camelCase).
- Status: pending, sending, sent, cancelled, blocked, failed, delivery_unknown.
- Clinic opt-in: `settings.scheduledMessages.enabled === true`; default false. Worker startup requires `SCHEDULED_MESSAGES_WORKER_ENABLED=true`.
- UI supports text and approved templates without dynamic/header/button parameters initially; unsafe templates rejected server-side.

## Tasks and ownership

1. Backend: new migration/repository/shared policy, API plugin, dedicated worker and queue, contract tests. Own `apps/api`, `apps/workers`, `packages/db`, `packages/shared`, `packages/queue`. Do not refactor immediate reply routes. Tests first.
2. UI: own `apps/inboxos`. Clinic-local date/time conversion rejects nonexistent/ambiguous DST times, EN/ES accessible scheduling dialog, clock button, collapsible pending/history list, edit/cancel, clinic/conversation-scoped queries and preserved drafts. Tests first.
3. Integration and fresh-context read-only safety review. Check tenant/author/consent/status/account/window/retry/cancel races, restart recovery, uncertain acceptance and current metadata updates. Run focused tests, package typechecks and i18n. Review used the same model; runtime database/concurrency/browser proof remains a separate enablement gate.

## Delivery safeguards

Claim/version checks and attempt persistence before external sends. No automatic provider retry after uncertain send. Reconcile stale attempts to delivery_unknown. Delivery revalidates current clinic, author permission, opt-out, conversation, original account/recipient and channel-specific last inbound timestamp. Fifteen-minute overdue grace then block. Recheck approval/template structure and 24h free-text window at send. On confirmed send only, write timeline/provider ID and pause bot using current metadata; never reopen closed conversations. Cancel/edit only while pending. Account changes block, not silently reroute.

## Verification / acceptance

No database migration on production, live worker startup, clinic enablement, external message, AWS action, commit, push or deployment. Run tests without external services. Preserve unrelated `.claude/`. Report local source and automated checks separately from runtime/deployment and owner acceptance.
