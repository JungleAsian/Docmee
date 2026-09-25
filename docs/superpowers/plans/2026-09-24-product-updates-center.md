# Product Updates Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated global product-update notification and a role-aware Product Updates/All Features page.

**Architecture:** Keep reviewed release content in a typed, version-controlled catalog and persist only each authenticated user's latest seen release ID through the existing server-backed UI-preferences API. A shared React header component owns popover interaction while the updates page owns browsing and role filtering.

**Tech Stack:** React 19, Next.js 15 App Router, TanStack Query, TypeScript, Vitest, existing Docmee API/UI-preferences storage.

**Spec:** `docs/superpowers/specs/2026-09-24-product-updates-center.md`

## Global Constraints

- Do not merge product announcements into the operational notification feed.
- Do not add a dependency or a new content-management backend in this first release.
- Persist acknowledgement through authenticated server-backed preferences.
- Render only role-appropriate entries and links.
- Preserve all unrelated working-tree changes.

---

### Task 1: Catalog and unseen-state contract

**Files:**
- Create: `apps/inboxos/src/shared/productUpdates.ts`
- Create: `apps/inboxos/src/shared/productUpdates.test.ts`
- Modify: `apps/inboxos/src/shared/userUiPreferences.ts`
- Modify: `apps/inboxos/src/shared/userUiPreferences.test.ts`
- Modify: `apps/api/src/routes/user.ts`

**Interfaces:**
- Produces: `PRODUCT_UPDATES`, `PRODUCT_FEATURES`, `updatesForRole(role)`, `featuresForRole(role)`, `unseenProductUpdates(updates, lastSeenId)`.
- Produces: `UserUiPreferences.lastSeenProductUpdateId: string | null`.

- [ ] Write failing tests for newest-first ordering, role filtering, unseen calculation, and preference normalization.
- [ ] Run the focused tests and confirm failures are caused by the missing contracts.
- [ ] Implement the typed catalog, helpers, normalizer field, and API validation.
- [ ] Rerun focused tests to green.

### Task 2: Shared header update control

**Files:**
- Create: `apps/inboxos/src/shared/components/ProductUpdatesControl.tsx`
- Create: `apps/inboxos/src/shared/components/ProductUpdatesControl.test.tsx`
- Modify: `apps/inboxos/src/app/(clinic)/layout.tsx`
- Modify: `apps/inboxos/src/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: catalog helpers and `useUserUiPreferences()`.
- Produces: accessible global megaphone button, unseen badge, auto-opening popup, persistent dismissal, and `/updates` navigation.

- [ ] Write a failing static-render test for the distinct label, latest content, badge, dismiss action, and history link.
- [ ] Run it and confirm failure because the component does not exist.
- [ ] Implement the presentational popup and stateful shared control.
- [ ] Mount it in both authenticated headers without changing `NotificationBell`.
- [ ] Rerun the focused test to green.

### Task 3: Product Updates page and navigation

**Files:**
- Create: `apps/inboxos/src/app/(clinic)/updates/page.tsx`
- Modify: `apps/inboxos/src/app/(clinic)/layout.tsx`
- Modify: `apps/inboxos/src/app/(admin)/layout.tsx`
- Modify: `apps/inboxos/src/shared/i18n.ts`
- Modify: `apps/inboxos/src/shared/i18n.server.ts`

**Interfaces:**
- Consumes: role-filtered release and feature catalogs.
- Produces: `/updates` with “What’s new” and “All features” tabs plus shell navigation entries.

- [ ] Implement the authenticated role-aware page and navigation entries.
- [ ] Add matching English and Spanish navigation/update labels.
- [ ] Run i18n validation and focused tests.

### Task 4: Full verification

**Files:**
- Verify only.

- [ ] Run InboxOS tests, typecheck, lint, i18n check, and production build.
- [ ] Review the final diff and confirm unrelated dirty files remain untouched.
- [ ] Record execution evidence and remaining deployment/owner-review gates.
