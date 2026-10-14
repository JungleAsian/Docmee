# Approved Inbox usability implementation

Scope: official Dropbox checkout; preserve existing phone-display and handler-label edits. No release or production data changes.

1. Add regression tests for active-doctor default selection and clinic changes, mutually exclusive header panels, contact avatar fallback, WhatsApp badge, and navigation order.
2. Implement clinic/conversation-scoped booking state, default only a sole active doctor, and preserve multi-doctor selection.
3. Share one header-panel state between Customize and Product Updates in both layouts. Preserve update acknowledgement and automatic opening; support outside clicks and Escape.
4. Use a reusable contact avatar with an authorized profile-image URL when available and initials on absence/error. Do not scrape WhatsApp or invent provider data.
5. Remove the WhatsApp badge ring and use the official glyph. Place Waitlist above Alerts while respecting other navigation preferences.
6. Audit platform Spanish strings; repair source-owned labels, placeholders, accessibility names, dialogs and errors. Never translate clinic-authored or patient data.
7. Run focused tests, typecheck, translation-key checks and diff checks. Record unverified provider/rendering or localization gaps explicitly; do not call source checks deployment proof.

## Local implementation evidence (2026-10-14)

- Implemented: sole-active-doctor defaults in appointment forms/calendar; booking state reset by clinic, conversation and active roster; mutually exclusive Customize/Updates state in both layouts; Waitlist before Alerts; WhatsApp badge without the extra white ring; name-based avatar fallback.
- Spanish repairs cover shared Inbox controls, settings, media repository, notifications, breadcrumb labels, workflow diagnostic/simulator system statuses, daily summary and WhatsApp account dialog. Clinic-authored names and patient content are unchanged.
- Verification: 58 tests across 10 focused files passed; TypeScript no-emit check passed; translation-key check passed with 2,516 English and 2,516 Spanish keys; Git whitespace check passed (existing ConversationView line-ending warning only).
- Existing handler-label and always-visible-number edits were preserved. Unrelated package/archive/backup work was not staged or released.

## Remaining acceptance gaps

- Contact photos: the inspected conversation/patient contracts and WhatsApp ingestion do not currently supply a contact profile-image URL. Do not invent one or scrape WhatsApp. Provider-backed ingestion and absence/error fallback still require implementation and tests.
- Official WhatsApp glyph: the current Phosphor glyph is not an official Meta asset. Obtain the official logo pack from https://www.meta.com/brand/resources/whatsapp/whatsapp-brand/ and integrate the unmodified permitted asset before calling this requirement complete.
- Platform-wide Spanish: the hardcoded-string audit still identifies additional workflow, administration and integration screens. Equal dictionary key counts do not prove complete translation coverage.
- Rendered desktop/compact-width verification has not been performed. Automated source/SSR checks are not visual acceptance.
- No commit, push, deployment, live-data modification or owner acceptance is claimed for this implementation pass.
