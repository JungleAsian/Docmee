# Workflow process tool — Phase C: Lifecycle, revisions, and collaboration safety

> **Owner:** Codex | **Status:** approved for implementation by the user on 2026-09-03

## Objective contract

Promote workflows through an explicit lifecycle and prevent silent overwrites. Graph changes create immutable execution revisions; layout-only changes do not. Existing `draft`/`active` records map safely to the expanded lifecycle.

## Acceptance evidence

- Lifecycle transition tests reject invalid transitions and accept valid ones.
- A stale `If-Match` revision produces HTTP 409 with the current revision/version.
- Graph-changing publish creates a revision; a layout-only update does not.
- Repository/API test suites and migration checks pass.

## Tasks

1. Expand `WorkflowStatus` to `draft | validated | ready | published | superseded | archived`, with a normalizer that maps legacy `active` to `published` and legacy `draft` to `draft`.
2. Add `revision_number`, `document_version`, `lifecycle_changed_at`, and `archived_at` through an additive migration. Backfill published legacy workflows with their existing `active_revision_id` and version 1.
3. Extend `WorkflowRevision` with revision number, author, reason, and immutable compiled definition. Update `activateRevision` so graph/config edits on a published workflow snapshot once, then mark the prior snapshot superseded; presentation-only mutations increment `document_version` only.
4. Require an optional `If-Match`/`expectedVersion` on PATCH. Have repository updates condition on `document_version`; return a typed conflict rather than last-writer-wins.
5. Add lifecycle actions: validate, mark ready, publish, archive, restore revision. Expose them as explicit API routes rather than overloading a status toggle.
6. Update `apps/inboxos/src/app/(admin)/studio/workflows/page.tsx` with a lifecycle badge, publish control, conflict recovery notice, revision history drawer, and a separate “Save layout” affordance.
7. Add repository/API/UI tests before each implementation: lifecycle table, revision immutability, ETag conflict, layout-only edit, archive, and restore.

## Compatibility / rollback

Existing active runs retain their pinned `workflow_revision_id`. Legacy API status values remain accepted during a deprecation window. The new lifecycle API is additive; old toggle clients map to publish/draft behavior until removed in a later deliberate breaking release.
