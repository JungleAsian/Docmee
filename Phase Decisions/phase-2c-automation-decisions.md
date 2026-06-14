# Docmee — Phase 2C (Automation & Templates): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 2C adds compliant proactive (out-of-window) messaging: WhatsApp template management, a six-gate safety model, scheduled reminders/confirmations, and post-visit follow-ups. Broadcast/marketing is deliberately deferred.

---

## Scope
**In:** template management + Meta approval lifecycle; six-gate proactive-messaging model; reminders/confirmations scheduling; post-visit follow-ups (auto-completion hook subscriber). Transactional only.
**Out (deferred):** broadcast / marketing campaigns → FI8.

## Decisions

**Q1 — Templates (8.5).** Clinic-defined templates (reminders/confirmations/follow-ups) with variable placeholders, tracked through draft → submitted → approved/rejected (status synced from Meta), versioned, managed in IA Studio. Templates are the only path to message outside the 24h window; WhatsApp uses templates, Messenger/IG use message tags. Approval latency/rejection is clinic-owned (R2/X4).

**Q2 — Six-gate proactive-messaging model (8.5).** Every proactive/automated message must pass all six gates at the outbound chokepoint before sending: ① patient not opted-out · ② an approved template exists · ③ timing/eligibility valid · ④ appointment state still valid (cancellation cascade plugs in here) · ⑤ dedup/frequency-cap · ⑥ clinic has the automation enabled (+ send-time/quiet hours). Fail any → not sent, logged. Scoped to transactional messages tied to a patient-initiated appointment.

**Q3 — Reminders + confirmations + cancellation-kill cascade (8.5).** On booking, schedule configurable reminder/confirmation jobs (BullMQ delayed, e.g. 24h/1h before); each fires through the six-gate at send time; a patient "confirm" reply moves `booked → confirmed`; appointment cancellation/reschedule cancels/reschedules the queued jobs — 1C's cancellation-cascade mechanism finally gets its subscriber.

**Q4 — Post-visit follow-ups (8.5).** A 2C automation engine subscribes to 1C's auto-completion hook (and no-show/cancellation events): completion → optional post-visit / review follow-up; no-show → optional recovery follow-up; all template-gated through the six-gate, per-clinic configurable. Completes the 1C seam.

**Q5 — Broadcast / marketing = DEFERRED (locked).** Marketing/broadcast campaigns are deferred to Future Improvement **FI8** (build later with explicit marketing opt-in, marketing templates, frequency caps, and number-reputation safeguards). 2C ships transactional-only — this keeps spam/number-ban risk out of v1. *Recorded as a con (no promotional outreach in v1) and as FI8.*

## Sweep locks
- **G57 Automation timezone:** reminders/confirmations/follow-ups fire in clinic-local time (reuse locked tz handling).
- **G58 Confirm-reply handling:** reply parsed — confirm → confirmed; cancel/reschedule → route to humans (1C policy).
- **G59 Template-rejection handling:** Meta rejects a template → clinic alerted + automations using it paused until fixed.
- **G60 Frequency cap / anti-spam:** per-patient frequency cap across automations (gate 5).
- **G61 Failed-send idempotency:** bounded retry on failure; provider_message_id dedup prevents double-sends.

## Acceptance gate
1. Templates tracked draft→submitted→approved/rejected (Meta-synced); only approved templates send out-of-window.
2. Every proactive message passes all six gates at the chokepoint; fail any → not sent + logged.
3. Reminder/confirmation jobs scheduled on booking; confirm-reply → confirmed; cancel/reschedule moves/kills jobs.
4. Auto-completion hook fires post-visit follow-up; no-show recovery; all template-gated + per-clinic configurable.
5. No broadcast/marketing send path exists in 2C (transactional only).

## Tracker cross-references
- Decisions: 2C Templates · Six-gate · Reminders · Follow-ups · Broadcast (deferred).
- Future Improvements: FI8 (broadcast/marketing with explicit opt-in).
- Security: SEC23 (proactive-messaging compliance / number reputation — mitigated by six-gate).
- Actions: X4 (clinic template approval).
- Gaps: G57–G61.

---
