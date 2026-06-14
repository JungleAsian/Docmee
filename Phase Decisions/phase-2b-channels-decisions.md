# Docmee — Phase 2B (Channels): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 2B adds Messenger + Instagram alongside WhatsApp, a unified cross-channel inbox, and (manual) cross-channel patient merge.

---

## Scope
**In:** Messenger + Instagram channels (official Meta Graph API); unified cross-channel inbox; manual cross-channel patient merge.
**Out (deferred):** smarter/auto identity merge (FI6); proactive cross-channel re-engagement / templates (2C).

## Decisions

**Q1 — Channels (8.5).** Messenger + Instagram via Meta Graph API/webhooks behind the locked channel abstraction (`packages/channels`); official from day one (no Evolution). Inbound normalized to the common message shape; outbound via the chokepoint; pipeline (gates/bot) channel-agnostic. Per-clinic connect (FB Page / IG account); channel identity encrypted + HMAC.

**Q3 — Unified inbox (8.0).** All channels in one inbox with a per-conversation channel badge; CRM/inbox channel-agnostic (1B). Per-channel messaging-window rules enforced at the outbound layer (WhatsApp/Messenger/IG 24h + each platform's re-engagement rules). Bot replies identically across channels. A patient on two channels = two conversations under one patient.

**Q2 — Cross-channel merge = MANUAL ONLY (user decision; was flagged 7.5).** A secretary explicitly merges two patient records (audited, confirmation step). No auto-merge, no auto-suggestions — avoids the PHI-mixing risk. Merged patient keeps all channel identities; conversations attach to the unified patient. *Recorded as a con (manual effort; dupes persist until staff act) and as Future Improvement FI6 (verified auto-link + suggestions + reversible merge).*

## Sweep locks
- **G29 Media/attachments:** normalize supported types across channels; unsupported → notice or handoff.
- **G30 Re-engagement boundary:** in-window normal; out-of-window proactive re-engagement → 2C; 2B uses locked hold-resend/escalate per channel.
- **G31 Channel token/connection failure:** mark channel disconnected + alert clinic + pause that channel's inbound + bounded retry.

## Acceptance gate
1. Messenger + IG inbound normalized; outbound via chokepoint; pipeline channel-agnostic across all channels.
2. Per-clinic channel connect; channel identity encrypted + HMAC.
3. Unified inbox shows all channels with badges; per-channel window rules enforced at outbound.
4. Secretary can manually merge two patient records (audited, confirmation); no auto-merge occurs.
5. Channel disconnect → clinic alerted + that channel paused; unsupported media → graceful notice/handoff.

## Tracker cross-references
- Risks: R11 (mitigated — manual merge in 2B; smarter merge → FI6).
- Future Improvements: FI6 (smarter cross-channel merge).
- Actions: X16 (per-clinic Messenger/IG connect).
- Gaps: G29–G31.

---
*Phase 2B sealed. Next: Phase 2C — Automation & Templates.*
