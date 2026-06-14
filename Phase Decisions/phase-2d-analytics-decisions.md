# Docmee — Phase 2D (Analytics & Search): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 2D adds clinic/platform analytics + QoS monitoring, an error-review area, and per-clinic message-content search (resolving the search gap deferred from 1B).

---

## Scope
**In:** metrics + QoS analytics (rollups); error review area; per-clinic full-text message search.
**Out (deferred):** semantic/vector search → Future Improvement.

## Decisions

**Q1 — Metrics + QoS analytics (8.5).** Scheduled rollup jobs aggregate from existing data (conversations, messages, appointments, events) into per-clinic aggregate tables (RLS-scoped). Covers PR17 (totals, by-channel, leads, requests, scheduled, transfers, common questions, peak hours, no-response, conversion) and PR32 QoS (upset patients, abandoned, response times, no-closure, follow-up opportunities), surfaced as dashboards in IA Studio + the clinic panel.

**Q2 — Error review area (8.5).** A review queue fed by the existing error_log + DLQ + event stream: unanswered questions, bot-asked-for-help, bad responses, handoffs, unknown intents, Meta/Calendar errors, failed messages — categorized and actionable, with unanswered questions feeding back as KB-entry suggestions (closing the quality loop).

**Q3 — Message-content search (8.5).** Postgres full-text search (tsvector + GIN) over message bodies, strictly per-clinic via RLS and audited. Resolves **R12**, the content-search gap deliberately deferred in 1B. Semantic/pgvector search stays a Future Improvement.

## Sweep locks
- **G32 Analytics timezone:** rollups bucket by clinic-local time; peak-hours/daily metrics per clinic timezone.
- **G33 Metrics PHI-safety:** aggregate tables store counts/derived flags only — no raw PHI; sentiment = derived label, not message text (ties SEC16).
- **G34 Search clinic-isolation:** FTS strictly RLS-scoped per clinic; no cross-clinic results; queries audited.
- **G35 Error-review action loop:** unanswered/unknown-intent items become KB-entry suggestions; resolved items tracked.
- **G36 Analytics query performance:** precomputed rollups / materialized views + indexes; dashboards read aggregates, never heavy live scans.

## Acceptance gate
1. Metrics + QoS rollup jobs populate per-clinic aggregate tables; dashboards in IA Studio + clinic panel.
2. Error review queue surfaces categorized bot/agent/API failures; unanswered → KB suggestion.
3. Per-clinic full-text message search (tsvector+GIN, RLS, audited); R12 resolved.
4. Aggregates hold no raw PHI; search results never cross clinic boundaries.

## Tracker cross-references
- Decisions: 2D Analytics · Error review · Content search.
- Risks: R12 (Resolved — content search locked in 2D).
- Security: SEC16 (PHI-in-logs — reinforced by aggregate-only metrics).
- Requirements: PR17, PR29, PR32 (Planned → 2D); PR09 status-query benefits from analytics.
- Gaps: G32–G36.

---
