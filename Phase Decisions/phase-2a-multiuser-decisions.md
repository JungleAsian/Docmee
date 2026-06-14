# Docmee — Phase 2A (Multi-User Operations): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 2A is the operations layer for multi-staff clinics: routing, the full notification/escalation system, quick replies, the IA Studio admin surface + panel RBAC, and manual invoicing. Mostly activation of seams 1B/Phase 0 left dormant.

---

## Scope
**In:** auto-routing/assignment; full P1–P4 notification + escalation system; quick replies; IA Studio platform-admin + full panel RBAC; manual invoicing.
**Out (deferred):** skill/tag routing (3x); automated billing/payment gateway (FI5); native push (3D/FI4).

## Decisions

**Q1 — Routing.** Optional per-clinic strategy (shared-queue default / round-robin / load-based); presence-aware (route only to available; none available → shared queue + notify); on handoff + new conversation; never overrides explicit assignment; RBAC-gated. Robust presence + load-optimization → FI5/FI6 superseded; tradeoffs in Cons tab.

**Q2 — Notifications + escalation.** P1–P4 driving differentiated channels/behavior; configurable escalation ladder (assignee → all staff → admin → IA Studio) stopping on acknowledgement (resolves routed-but-unacknowledged); dedup/collapse; per-user preferences + quiet hours with P1/safety breaking through; panel + per-user email + basic web push (native push → 3D/FI4).

**Q3 — Quick replies.** Clinic-defined canned responses with variable interpolation (patient/clinic/next-slot), secretary-inserted (never auto-sent), category/shortcut organized, sent via the outbound chokepoint. No AI-suggested replies in 2A.

**Q4 — IA Studio + panel RBAC.** Platform-admin surface (platform_users only): clinic CRUD, plan/limit + provider/model config, KB oversight, health, audited impersonation (activates Phase 0 acted_by seam). Full 5-role matrix enforced at API/DAL across the clinic panel. Plan limits configured here, enforced in the pipeline.

**Q5 — Manual invoicing.** Manual subscription invoice records (plan/amount/period GTQ/status) + simple invoice doc + manual mark-paid. Automated billing → FI5.

## Sweep locks
- **G26 Conversation-limit enforcement:** soft-cap (warn at threshold, keep serving, flag overage); hard cutoff configurable.
- **G27 Quick-reply variable safety:** server-side resolution from current context only; unresolved → blank.
- **G28 IA Studio impersonation:** acted_by stamp + audit + time-boxed + platform-only.

## Acceptance gate
1. Clinic selects routing strategy; round-robin/load-based assign only to available staff; none available → shared queue + notify; explicit assignment never overridden.
2. P1–P4 fire correct channels; unacknowledged P1/P2 escalates up the ladder and stops on ack; dedup collapses repeats; quiet hours suppress non-urgent while P1 breaks through; web push delivers.
3. Quick replies insert with variables resolved from current context only; sent via chokepoint.
4. IA Studio: clinic/plan/provider config; impersonation stamped + audited; panel RBAC enforced at API/DAL (Assistant cannot reply/see notes, etc.).
5. Manual invoice created/tracked; conversation-limit soft-cap warns + flags overage without cutting off care.

## Tracker cross-references
- Future Improvements: FI5 (automated billing/payments), FI4 (native push).
- Gaps: G26–G28.

---
*Phase 2A sealed. Next: Phase 2B — Channels (Messenger/Instagram + cross-channel identity).*
