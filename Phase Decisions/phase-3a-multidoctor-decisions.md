# Docmee — Phase 3A (Multi-Doctor Clinics): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 3A activates the doctor seam reserved in Phase 0: multiple doctors per clinic, each with their own calendar, services, hours, and FAQs, plus doctor selection in booking.

---

## Scope
**In:** doctor entity + per-doctor config; doctor selection in booking; per-doctor KB scoping; per-doctor routing/visibility.
**Out (deferred):** none specific to 3A.

## Decisions

**Q1 — Doctor entity & per-doctor configuration (8.5).** Activate the dormant doctor entity (reserved since P0). Each clinic has 1..N doctors; per-doctor config = own Google Calendar, services, opening hours, doctor-scoped FAQs — layered on the shared clinic KB/rules. A "doctor" is a **bookable profile**, *optionally* linked to a platform **user account** with the doctor role (2A RBAC), so a bookable doctor need not log in. Single-doctor clinics are the N=1 default — backward compatible.

**Q2 — Doctor selection in booking (8.5).** Extends the locked 8-step intake: when a clinic has >1 doctor, add a doctor-selection step (explicit pick / specialty-or-service inference / "any available" = earliest across doctors), then check that doctor's calendar. Single-doctor clinics auto-skip the step.

**Q3 — Per-doctor KB & answer scoping (8.5).** Retrieval becomes doctor-aware once a doctor context is set: clinic-shared chunks (always) + selected-doctor chunks (their services/hours/FAQs); rules still always-injected. No cross-doctor leakage (one doctor's prices/hours never surface for another). Before selection, answer at clinic level or list doctors.

**Q4 — Assignment, routing & notifications per doctor (8.0).** Conversations/appointments associate with a doctor; secretaries filter the inbox by doctor; notifications/escalations route to per-doctor staffing or the shared queue; the doctor role sees their own appointments/conversations. Reuses 2A routing/RBAC.

## Sweep locks
- **G37 N=1 backward compatibility:** single-doctor is the default; existing clinics unaffected; intake auto-skips the doctor step.
- **G38 Per-doctor calendar lifecycle:** each doctor's Google Calendar = separate connection (X17); disconnection mirrors the per-clinic calendar/provider-outage pattern.
- **G39 "Any-doctor" booking & conflicts:** "any available" books earliest across selected doctors; per-doctor no-double-book reuses calendar-truth.
- **G40 Doctor deactivation/removal:** future appointments reassign or cancellation-cascade; KB chunks archived; bot stops offering that doctor; history retained.
- **G41 Cross-doctor isolation:** a doctor's prices/hours/FAQs never surface for another; retrieval filtered by selected doctor.

## Acceptance gate
1. Doctor entity active: per-doctor calendar/services/hours/FAQs; doctor = bookable profile ± user account; N=1 backward compatible.
2. Booking intake adds doctor selection when >1 doctor (explicit/specialty/any-available); single-doctor auto-skips.
3. Doctor-aware KB retrieval (clinic-shared + selected-doctor chunks); no cross-doctor leakage.
4. Conversations/appointments associate to a doctor; inbox filter + per-doctor routing/visibility.

## Tracker cross-references
- Decisions: 3A Doctor entity · Doctor selection · Per-doctor KB · Doctor routing.
- Actions: X17 (per-doctor Google Calendar connect).
- Requirements: PR30 (Multi-Doctor — Planned → 3A); PR10 doctor/specialty capture.
- Gaps: G37–G41.

---
