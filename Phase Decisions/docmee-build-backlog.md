# Docmee — Build Backlog & Sequencing Plan

**Derived from `docmee-trackers.xlsx` (all decisions sealed).** This converts the locked plan into a build order: each phase carries its acceptance **gates** (definition of done), its **gaps** (implementation rules for edge cases), and the **actions** + **security items** that gate it. Build in order, top to bottom.

> **Two rules that override sequence:**
> 1. **Start external/blocking actions on day one** — they have lead times you don't control (Meta approval, legal counsel).
> 2. **Two test layers belong *in* the build, not after** — RLS/tenant-isolation and six-gate/idempotency. They guard your worst failure modes (cross-tenant PHI leak, a message escaping the gates).

---

## Sprint 0 — Setup, unblock, and one decision (parallel with Phase 0)

**Kick off immediately (external lead time):**
- **X7** — WhatsApp display-name + number approval → *blocked on Meta; start now.*
- **X20** — Guatemalan data-protection counsel review → *legal lead time; start now.*
- **X1** — Transfer Meta/WABA asset into Docmee.
- **X5** — Provision Docmee platform API keys (LLM/ASR/embeddings).
- **X6** — Stand up Supabase + Redis + VPS + DNS + Storage (the Phase 0 deploy target).
- **X2 / X9** — Interim WhatsApp connectivity via self-hosted Evolution (bridges until per-clinic Meta cutover X10).

**Decide before the pipeline is built:**
- **🔴 SEC06 (High) — PHI to third-party LLM/ASR.** Settle data-processing agreements and/or PHI-minimization before sending patient content to providers. This shapes the core pipeline, so resolve it in Sprint 0.

**Engineering setup:** monorepo + CI (run on every PR), seeded **staging** clinic, and stand up **observability early** (D63: Sentry + `/health` + uptime/synthetic checks + Bull Board + alerting). Add `npm/pip audit` to CI now (**SEC22**).

---

## Phase 0 — Foundation  ·  *9 gates · 10 gaps*
The spine everything else trusts. **Do not skip or shortcut.**
- **Build:** multi-tenant isolation (RLS + worker context), app-layer envelope encryption (Vault + key_version + separate HMAC key), platform/clinic identity split, opt-out chokepoint, idempotency (provider_message_id unique), single-VPS deploy.
- **Gaps (impl rules):** G01–G08 (mechanism locks) + **G62** (deletion/erasure cascade) + **G63** (consent capture for processing & export).
- **Security:** start **SEC16** discipline now — never log message bodies/PHI; enforce via lint + code review.
- **🔒 Build the RLS tenant-isolation test suite here** — it protects every later phase.
- **Exit:** all 9 gates pass; cross-tenant access provably impossible.

## Phase 1A — Core Bot + WhatsApp inbox  ·  *10 gates · 5 gaps*
- **Build:** unified KB (manual + doc text-layer chunks, always-injected rules, 0.70 retrieval), 5-intent pipeline (ordered gate chain), prompt assembly (fail-safe truncation), auto-reply + 24h window handling, inbox modes + self-healing handback, swappable transcription (Deepgram), Spanish + English chatbot.
- **Gaps:** G09–G13.
- **Security:** **SEC06** mitigations live here (LLM/ASR calls).
- **Exit:** bot answers grounded per-clinic; never interrupts a human; medical-safety guardrails hold.

## Phase 1B — Human Inbox + Patient CRM  ·  *16 gates · 5 gaps*
- **Build:** patient auto-create/enrich, panel CRM, shared-queue + claim assignment, tags + light patient status, notes, identity (HMAC) search, bot data-capture via tool-calling → DAL allowlist, notification slice.
- **Gaps:** G14–G18.
- **Exit:** secretaries fully operate the inbox; bot writes go through the allowlist.

## Phase 1C — Scheduling  ·  *14 gates · 7 gaps*
- **Build:** Google Calendar as datetime truth + availability (no double-book), 8-step resumable intake (re-validate on write), appointment lifecycle + auto-completion hook, bot appointment-status query.
- **Gaps:** G19–G25.
- **Action:** **X15** per-clinic Calendar connect (onboarding).
- **Exit:** end-to-end booking; reschedule/cancel route to humans.

---

## 🚦 MVP / PILOT-LAUNCH GATE (before any real patient traffic)
Hard pre-conditions — none are optional:
- **X3** — privacy policy & terms (Spanish) published.
- **X20** — counsel review complete (started in Sprint 0).
- **X7** — WhatsApp number live (started in Sprint 0).
- **X12** — VPS backup + recovery in place → closes **SEC14 (High)**.
- **X14** — deflection-message sign-off + local emergency number.
- **SEC18** — API rate limiting / DoS protection at the gateway.
- **X11** — clinic onboarding checklist ready.

---

## Phase 2A — Multi-User Ops  ·  *11 gates · 3 gaps*
RBAC + IA Studio admin, presence-aware routing, full notifications/escalation, quick replies, manual invoicing, **panel i18n (ES/EN)**. Gaps G26–G28.

## Phase 2B — Channels  ·  *8 gates · 3 gaps*
Messenger + Instagram via Meta Graph API, unified cross-channel inbox, manual cross-channel merge. Gaps G29–G31. Action **X16** (per-clinic Messenger/IG connect).

## Phase 2C — Automation & Templates  ·  *4 gates · 5 gaps*
Templates + Meta approval, six-gate proactive model, reminders/confirmations + cancellation cascade, post-visit follow-ups. Gaps G57–G61. Action **X4** (submit templates). **🔒 Build the six-gate + idempotency test suite here.**

## Phase 2D — Analytics & Search  ·  *3 gates · 5 gaps*
Metrics + QoS rollups, error-review area, per-clinic full-text message search. Gaps G32–G36.

## Phase 3A — Multi-Doctor  ·  *4 gates · 5 gaps*
Doctor entity + per-doctor calendar/KB/routing; doctor selection in booking. Gaps G37–G41. Action **X17** (per-doctor Calendar connect).

## Phase 3B — Advanced Intake  ·  *3 gates · 5 gaps*
Declarative flow builder, structured/deterministic advanced rules, secretary copilot. Gaps G42–G46.

## Phase 3C — Integrations & OCR  ·  *3 gates · 5 gaps*
OCR/rich-format ingestion, Sheets/CRM export, automated reports. Gaps G47–G51. Action **X18** (Sheets/CRM connect). **Security: SEC24** — export requires written consent (Guatemala law).

## Phase 3D — Mobile / PWA / Push  ·  *3 gates · 5 gaps*
Installable PWA, Web Push (VAPID), mobile parity for secretary ops. Gaps G52–G56.

---

## Cross-cutting / ongoing
- **X19 — Testing/QA:** layered suite (unit, integration, contract, E2E, eval harness). *Per scope, tracked as a non-blocking action — but pull the RLS (Phase 0) and six-gate (2C) layers into the build.*
- **Observability (D63):** stood up in Sprint 0, maintained throughout.
- **X13 — HA/redundancy:** parked until first real patients / SLA pressure.
- **Open security to carry:** SEC06 (decided Sprint 0), SEC14 (X12), SEC16 (build discipline), SEC18 (launch gate), SEC22 (CI).

## Suggested cadence (indicative, 26-week plan)
Sprint 0 + Phase 0 (wk 0–2) → 1A (2–6) → 1B (6–9) → 1C (9–12) → **Pilot launch gate** → 2A (12–14) → 2B (14–16) → 2C (16–18) → 2D (18–20) → 3A (20–22) → 3B (22–23) → 3C (23–25) → 3D (25–26).

---
*Source of truth: `docmee-trackers.xlsx` — Phase Gates (acceptance), Gaps (impl rules), Action Tracker (X1–X20), Security Audit (SEC01–SEC25).*
