# Docmee — Phase 3D (Mobile / PWA / Push): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 3D delivers the mobile experience as a PWA with Web Push, reaching parity for secretary daily-driver operations. Native apps stay a Future Improvement.

---

## Scope
**In:** responsive panel → installable PWA; Web Push notifications; mobile feature parity for secretary operations.
**Out (deferred):** native iOS/Android apps → FI4.

## Decisions

**Q1 — Responsive → PWA strategy (8.5).** Deliver the spec's staged path: the Next.js panel is already responsive; 3D adds **PWA** capabilities (installable, app manifest, service worker for caching + push). Native iOS/Android stays **FI4**. One codebase, no app-store dependency.

**Q2 — Push notifications (8.5).** **Web Push (VAPID)** for PWA/browser, wired into the existing notification/escalation ladder (1B/2A) so P1–P4 alerts reach staff on mobile; per-user device subscriptions, preference-controlled, with email as fallback.

**Q3 — Mobile feature parity (8.5).** The PWA exposes the secretary daily-driver operations the spec lists (view/reply, take control, pause/activate bot, patient details, appointments, confirm, alerts, notes) via the responsive panel — not a stripped-down app. Deep IA Studio admin stays desktop-optimized.

## Sweep locks
- **G52 PWA offline behavior:** offline shell + graceful degradation; never show stale-as-live; queued actions clearly marked; no silent send failures.
- **G53 Push token lifecycle:** subscriptions registered/refreshed/revoked per device; expired pruned; no push after logout.
- **G54 iOS push limitations:** detect unsupported; require installed PWA on iOS; fall back to email/badge; set expectations.
- **G55 Push preferences / quiet hours:** reuse notification prefs + quiet hours; don't push P3/P4 overnight unless urgent.
- **G56 Mobile auth/session security:** same RBAC + session security on mobile; per-device session handling; biometric optional via browser.

## Acceptance gate
1. Panel installable as a PWA (manifest + service worker); responsive; native app stays FI4.
2. Web Push (VAPID) delivers P1–P4 alerts to staff devices; per-user subs; preference + quiet-hours respected; email fallback.
3. PWA reaches parity on secretary daily-driver ops (inbox, bot control, appointments, alerts, notes).

## Tracker cross-references
- Decisions: 3D PWA · Push · Mobile parity.
- Future Improvements: FI4 (native iOS/Android app).
- Requirements: PR23 (Mobile — Planned → 3D, PWA path), PR24 (Notifications — push channel Covered).
- Gaps: G52–G56.

---
