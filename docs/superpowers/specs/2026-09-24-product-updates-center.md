# Product Updates Center Design

## Objective

Give every authenticated Docmee operator a clear, non-disruptive way to discover newly published application changes and review the current product feature set.

## Experience

- A dedicated megaphone control appears in the global header, separate from the operational notification bell.
- The newest unseen published update opens once as a small anchored popover after user preferences load.
- A badge shows the number of unseen releases.
- Dismiss, outside-click, Escape, and “View all updates” mark the newest release seen in the authenticated user's server-backed UI preferences.
- The control remains available after acknowledgement and opens the latest release on demand.
- The Product Updates page has “What’s new” and “All features” views. Entries and features are filtered by audience/role before rendering.
- The same header control remains present on the full-screen workflow route because that route retains the Admin header while hiding only its side rail.

## Data and state

The release and feature catalog is version-controlled application content. This is the simplest valid publishing path for the first release: updates are reviewed and deployed with the code that they describe, without introducing a new content-management database or editor. Per-user acknowledgement is stored in the existing `clinic_users.ui_preferences` JSON document as `lastSeenProductUpdateId`, preserving state across devices.

## Safety and accessibility

- Product updates never share the clinic-alert feed or its unread semantics.
- Only customer-safe copy is stored in the catalog; audience filtering prevents role-inappropriate links from being presented.
- The button exposes an accessible name and expanded state; the popover has dialog semantics; Escape and click-away close it; no sound or browser push is used.
- Failure to persist acknowledgement does not block navigation. The release will be offered again on a later session so it is not silently lost.

## Acceptance evidence

- Focused unit tests prove ordering, audience filtering, unseen-release calculation, preference normalization, and the rendered popup content.
- InboxOS typecheck, lint, tests, i18n validation, and production build pass.
- Source review confirms both global layouts render the shared control and the current operational notification bell remains unchanged.
