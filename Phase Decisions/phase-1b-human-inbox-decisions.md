# Docmee — Phase 1B (Human Inbox + Patient Data): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** `phase-0-foundation-decisions.md` · `phase-1a-core-bot-decisions.md` · `docmee-trackers.xlsx` · `00-architecture.md`

Phase 1B turns 1A's thin inbox into the clinic's real workspace: patient records (the built-in CRM), the organized secretary inbox, bot-driven data capture, and the first staff notifications.

---

## Scope

**In:** patient record (auto-created, progressively enriched) + built-in CRM views; inbox organization (assignment, tags, statuses, notes, search/filter); bot→CRM data capture; the 1B notification slice + clinic-level email config.

**Out (deferred):** auto-routing/assignment rules (2A) · full P1–P4 + escalation + quiet hours + per-user prefs + push (2A/3D) · message-content search (~2D, R12) · cross-channel identity merge (2B, R11) · lead-stage pipelines / CRM polish (2A/2C) · appointment data on the patient (1C).

---

## 1. Patient model + CRM (Q1)

- **`patient` = a person the clinic communicates with**, auto-created on first contact (identity only: encrypted phone/channel + HMAC lookup hash), **clinic-scoped, one-per-channel-identity**, RLS-isolated, never cross-clinic.
- **Progressively enriched** (name etc. fill in over time; valid with identity only; no registration gate).
- **Distinct from per-visit `patient_intake`** (1C). **Communication record, not medical record.**
- **Built-in CRM = the panel** (patient profile + inbox): identity, history, tags, statuses, notes. Advanced polish (segments, bulk actions, pipelines, timeline viz) → 2A/2C. External-CRM export (webhook) → 3C.

## 2. Inbox organization (Q2)

- **Assignment:** shared queue + **claim** + **auto-assign-on-takeover**; reassign allowed; auto-routing rules → 2A.
- **Tags/status:** free-form multi-tags + a **light patient status** (new-lead/active/inactive, clinic-configurable). **No duplicate conversation-status** — the locked conversation **mode** (`bot/human/paused/resolved`) is the conversation workflow state.
- **Notes:** patient-level internal notes primary (authored, timestamped, staff-only); conversation notes secondary.
- **Search/filter:** structured filters (mode/assignment/tags/status/date) + patient-identity search (name; phone via HMAC). **Message-content search deferred** (encryption limit, R12, ~2D).

## 3. Patient data capture (Q3)

- Bot extracts **contact/CRM fields** (name, reason/interest, language) — **not** clinical, not appointment specifics.
- **Writes via tool-calling → the DAL allowlist** (field-level, validated, logged-before-execution, no deletes — Phase 0 agent-write rules).
- **Confidence-gated:** high-confidence facts commit; ambiguous → confirm in-conversation or write as **suggested** (not committed); **never fabricate**.
- **Per-field source** (`bot`/`staff`) + timestamp; **secretary edits always win** (staff-set fields locked from bot overwrite).

## 4. Notifications — 1B slice (Q4)

- **Fires on:** bot handoff / deflection-distress (**urgent** → panel + email) · new lead / first contact (**info** → panel).
- **Priority-tagged** (P1–P4 forward-compatible) but acts on a simple **urgent/info** split.
- **Visible until acknowledged** (no auto-escalation in 1B).
- **Clinic-level email configurability:** master on/off, recipient(s), per-event-type toggles; defaults urgent-on / new-lead-off. Uses a clinic-level slice of `notification_preferences`.
- **Deferred to 2A/3D:** escalation chain, per-user preferences, quiet hours, dedup, push/PWA.

## 5. Final-sweep locks (operational detail)

1. **`patient_id` backfill:** forward-only **resolve-or-create** on every inbound (by channel-identity HMAC) + a one-time idempotent backfill migration grouping existing conversations into patients.
2. **Patient timeline:** profile shows the patient's **conversation list** (newest first) + patient-level data/tags/notes; **no merged cross-conversation message-stream** in 1B (forward-compatible later).
3. **Bot-vs-bot correction:** newest high-confidence `bot` capture may update an earlier `bot`-set field (newest-confident-bot wins); **never** overrides `staff`. Precedence: **staff > newest-confident-bot > older-bot > suggested.**
4. **Assignment × mode:** assignment **persists through resolve** (last-owner stamp); `bot`/`resolved` conversations are **not** in an active queue; active queue = `human`-mode/unresolved. Reassign allowed.
5. **RBAC in the inbox:** implements the locked 5-role matrix on these surfaces, enforced at API/DAL (not UI-only). Secretary RW; Doctor read (no reply); Assistant read (no reply, **no internal notes**); Clinic Admin full; IA Studio via impersonation only. Internal notes staff-roles-only.

---

## Acceptance gate (definition of done)

1. **Patient lifecycle:** a new sender auto-creates a clinic-scoped patient (identity only); conversations carry `patient_id`; backfill links existing conversations.
2. **Enrichment:** patient valid with identity only; fields fill progressively; no registration gate.
3. **Inbox organization:** shared queue + claim; reply/takeover auto-assigns; tags (multi) + patient status apply; conversation state = mode (no duplicate status).
4. **Notes:** patient-level internal notes authored/timestamped/staff-only; respect role visibility.
5. **Search/filter:** filter by mode/assignment/tags/status/date; find patient by name/phone (HMAC); message-content search absent (expected).
6. **Data capture:** bot captures name/reason via tool-calling → validated DAL write; ambiguous → suggested/confirm; never fabricates; secretary-set field not overwritten; newest-confident-bot updates older bot field; all writes audited.
7. **Notifications:** handoff/distress → panel + email; new lead → panel; visible until acknowledged; clinic email config (recipients + per-event toggles) honored by the dispatcher.
8. **RBAC:** role matrix enforced at the data layer across inbox/profile/notes (e.g., Assistant cannot reply or read internal notes).

## Build-task list (dev)

- Patient: `patients` enrichment fields + per-field `*_source`/timestamp; resolve-or-create on inbound; backfill migration; `patient_id` on conversations.
- CRM/inbox: patient profile + conversation-list view; assignment (claim/auto-assign/reassign); tags + patient status; patient/conversation notes; filters + identity search.
- Capture: tool-calling schema + DAL allowlist writes + confidence gate + suggested-vs-committed + source/precedence rules + audit.
- Notifications: event hooks (handoff/distress/new-lead) → `notification` queue → panel (Realtime) + email (Resend); clinic-level `notification_preferences` (recipients + per-event toggles) + dispatcher config read; visible-until-acknowledged.
- RBAC enforcement at API/DAL for all 1B surfaces.

## Tracker cross-references

- **Risks:** R11 (cross-channel dupes → 2B), R12 (no message-content search → ~2D), R13 (extraction accuracy — mitigated).
- **Actions:** X11 (onboarding now includes clinic notification recipients), X5 (Resend for email; LLM tool-calling for capture).

---

*Phase 1B is sealed. Next: Phase 1C — Scheduling (Google Calendar, the scheduling agent, the booking flow).*
