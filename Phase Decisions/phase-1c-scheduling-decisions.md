# Docmee — Phase 1C (Scheduling): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** `phase-0-foundation-decisions.md` · `phase-1a-core-bot-decisions.md` · `phase-1b-human-inbox-decisions.md` · `docmee-trackers.xlsx` · `00-architecture.md`

Phase 1C makes booking real: the Google Calendar integration, the scheduling agent + resumable intake, and the appointment lifecycle surfaced in the CRM. The 1A `booking` route now lands here instead of handoff. Patient-facing reminders/confirmations are deliberately **2C** (template-gated).

---

## Scope

**In:** Google Calendar integration + availability model; scheduling agent + 8-step intake (`patient_intake`); appointment lifecycle + status surfacing; cancellation-cascade mechanism; auto-completion job firing a 2C-bound hook.

**Out (deferred):** patient-facing reminders/confirmations (2C) · bot-driven reschedule/cancel (later; humans in 1C) · per-doctor calendars + routing (3A) · live two-way Calendar sync (Future Improvements FI1) · slot-holding/locking (future refinement).

---

## 1. Calendar integration & availability (Q1)

- **Source of truth:** Google Calendar owns appointment **datetime**; the `appointments` row owns everything else (patient link, status, intake, history), linked by event id. Every booking exists in both.
- **Availability = clinic-configured schedule ∩ Google free/busy.** The clinic sets hours/days, slot length, and buffers in Docmee; Docmee reads the calendar's free/busy and subtracts busy time, so only slots that are both within stated hours **and** actually open are offered (prevents double-booking against out-of-band calendar entries).
- **Write model:** on confirmed booking, Docmee creates the Calendar event + the `appointments` row. **Docmee is primary writer.**
- **Sync depth:** free/busy-at-booking + reconciliation; **live two-way sync deferred → FI1.**
- **One calendar per clinic** (per-doctor → 3A). UTC storage, clinic-local display. OAuth tokens encrypted (Phase 0); reuses the isolated `integrations/google` client.

## 2. Scheduling agent + intake (Q2)

- **8-step resumable intake** in `patient_intake`: trigger → service/reason → identity/name → preferred window → offer real slots (Q1 availability) → patient picks → confirm (read-back) → write (event + row).
- **Minimal collection** in 1C: service/reason, name, chosen slot (clinic-configurable service list optional). Richer per-service intake → later.
- **Persistence/recovery:** state (current step + collected fields) persists each step; **resumes from saved step** after interruption; **mid-intake digression** → bot answers from KB then returns to the step; takeover pauses intake (secretary owns it; resume or manual complete on resolve).
- **Slot collision:** **re-validate availability at write** (not just at offer) — if taken in the async gap, apologize + re-offer fresh slots. No slot-locking in 1C.
- **Fallback to human:** no available slots / explicit person request / repeated failure / anything off the booking happy-path → handoff **with partial intake attached**. **Reschedule/cancel of existing appointments routed to secretaries in 1C** (not bot-driven).

## 3. Appointment lifecycle + surfacing (Q3)

- **States:** `booked` → `confirmed` → `completed`, with `cancelled` / `no_show` terminal; every transition logged to `appointment_status_log` (append-only).
- **`confirmed`** is settable by a secretary in 1C; auto-driven by 2C confirmation flow later (seam present, dormant).
- **Auto-completion job** (every 30 min): now > end + 30 min and not cancelled/no-show → set `completed`, log it, and **fire a 2C-bound hook** (no subscriber yet — the seam for post-visit automations).
- **No-show:** manual (a human sets it; the system can't detect attendance).
- **Surfacing:** appointments appear on the patient profile (upcoming/past + status) and as an inbox/conversation status indicator. Manual status changes are RBAC-gated (1B matrix) + logged.
- **Cancellation cascade (mechanism built now):** cancel → set `cancelled` + log → cancel the Google event + clear pending; ready for 2C to plug automation-killing into (six-gate model). Patient-facing reminders → 2C.

## 4. Final-sweep locks (G19–G25)

1. **G19 Calendar OAuth failure / API outage mid-booking:** can't read/write calendar → **fail-safe to handoff** + holding message; raise a clinic alert + a visible **"Calendar disconnected"** settings state; bounded retry. (Mirrors the locked provider-outage pattern.)
2. **G20 Double-write integrity:** write **event first, then the `appointments` row**; if the row write fails, **best-effort delete the just-created event** + handoff; never write a row without an event; reconciliation job backstops stragglers.
3. **G21 Timezone + relative-time:** compute in **clinic-local tz**, store UTC, display clinic-local; **DST via a tz library**, never fixed offsets; the **confirmation step always reads back the fully-resolved absolute local datetime** so ambiguity is resolved by explicit confirmation.
4. **G22 Reschedule/cancel mechanics:** **Docmee is canonical** — secretary edits in Docmee → Docmee rewrites the Google event + logs the transition; direct-Calendar edits are reconciled, not real-time (FI1). Documented in onboarding (X11).
5. **G23 Booking guardrails:** booking is **not gated by opt-out** (inbound-initiated; opt-out governs proactive/outbound) — but **2C reminders are** (six-gate); after-hours booking is fine (books against availability, not "now"); `paused`/taken-over conversations follow the locked mode rules.
6. **G24 Slot-offer staleness:** already handled by **re-validate-availability-on-write** (Q2). *(Resolved, no separate mechanism.)*
7. **G25 Booking horizon + past-time guard:** configurable **booking horizon** (default ~60 days) + a **no-past-slots** guard, both from the availability computation.

---

## Acceptance gate (definition of done)

1. Booking creates a **linked Google Calendar event + `appointments` row**; availability offered = clinic schedule ∩ free/busy (no slot that conflicts with calendar busy).
2. Intake is **resumable** — interrupting and returning continues from the saved step; a mid-intake KB question is answered then intake resumes.
3. **Re-validate-on-write** — a slot taken between offer and confirm triggers a re-offer, never a double-book.
4. **Lifecycle** — states + logged transitions; auto-completion sets `completed` (now>end+30m) and fires the hook; no-show settable manually; statuses surfaced in profile + inbox.
5. **Cancellation** cancels the Google event + logs it; cascade mechanism present for 2C.
6. **G19** — calendar outage/disconnect → booking fails safe to handoff + clinic "Calendar disconnected" alert.
7. **G20** — induced row-write failure after event creation → event is compensated (deleted), no orphan; reconciliation catches stragglers.
8. **G21** — a booking confirmed via relative phrasing reads back the correct absolute clinic-local datetime; stored UTC; correct across a DST boundary.
9. **RBAC** — appointment status changes enforced per the locked role matrix + logged.

## Build-task list (dev)

- Google client: calendar submodule (free/busy read, event create/update/cancel), encrypted token storage, OAuth connect/refresh/revoke handling, "Calendar disconnected" state.
- Availability: clinic schedule config (hours/slot/buffers) ∩ free/busy; horizon + no-past guard; brief availability cache.
- Agent: 8-step intake state machine in `patient_intake`; resume + digression; re-validate-on-write; handoff-with-intake.
- Lifecycle: states + `appointment_status_log`; auto-completion job + 2C-bound hook; no-show manual; cancellation cascade (event cancel + clear pending); profile/inbox surfacing.
- Reliability: double-write order + compensation; reconciliation job; timezone (tz library, UTC store, local read-back); provider-outage fail-safe.

## Tracker cross-references

- **Actions:** X15 (per-clinic Calendar connect + availability config), X5 (Google OAuth creds, Docmee side), X11 (onboarding: reschedule-in-Docmee guidance).
- **Future Improvements:** FI1 (live two-way Calendar sync).
- **Gaps:** G19–G25 (all locked; G24 resolved by Q2).

---

*Phase 1C is sealed. The entire core product (0 · 1A · 1B · 1C) is now decided. Next: Phase 2A — Multi-User Operations.*
