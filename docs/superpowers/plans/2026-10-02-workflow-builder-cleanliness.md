# Workflow Builder Cleanliness Implementation Plan

> **For Codex:** Execute this plan in order with test-first changes. Keep executable workflow nodes and edges authoritative and unchanged by presentation-only interactions.

**Goal:** Deliver the approved shared workflow-builder cleanup for current and future workflows, then verify, push, and publish it only to `app.docmeedevelopment.dev`.

**Architecture:** Extend the existing pure workflow presentation adapter for collapsed-group aggregation and route focus; keep transient UI state in React; keep workflow list filtering local; preserve existing serialization and runtime execution contracts.

**Tech Stack:** Next.js 15.1, React 19, TypeScript 5.5, React Flow 12.11, Vitest 2, CSS modules, pnpm.

**Design:** `docs/superpowers/specs/2026-10-02-workflow-builder-cleanliness-design.md`

**Global constraints:** Do not modify workflow-runner semantics, patient messaging, provider selection, or `docmee.ai`. Do not auto-migrate existing coordinates. Diagnostics remain superuser-only. Use the existing safe AWS release path and require a current non-root AWS identity.

---

### Task 1: Aggregate collapsed-group boundary presentation

**Files:**
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.ts`
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.test.ts`
- Modify: `apps/inboxos/src/shared/components/workflow/CustomGroupNode.tsx`
- Modify: `apps/inboxos/src/shared/components/workflow/workflow.module.css`
- Test: `apps/inboxos/src/shared/components/workflow/CustomGroupNode.test.tsx`

1. Add failing pure tests proving repeated external connections share deterministic proxy handles while projected edges retain their original IDs.
2. Add failing component tests for accessible incoming/outgoing connection counts.
3. Implement branch-class and external-endpoint buckets in `projectWorkflow`, returning typed proxy-port metadata without mutating source edges.
4. Render one handle per proxy port and a visible count badge for buckets larger than one.
5. Run focused tests and commit the passing slice.

### Task 2: Add explicit focused-route presentation

**Files:**
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.ts`
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.test.ts`
- Modify: `apps/inboxos/src/shared/components/WorkflowCanvas.tsx`
- Modify: `apps/inboxos/src/shared/components/WorkflowCanvas.test.tsx`

1. Add failing tests for deterministic upstream/downstream route derivation from a node and from a selected edge.
2. Implement a pure focus-route helper over executable edge IDs.
3. Add local focus state, `Focus route`, and `Show all` controls; preserve selection editing behavior and reset focus when the graph identity changes.
4. Apply accessible route indicators to affected groups and retain unrelated geometry at reduced contrast.
5. Run focused tests and commit the passing slice.

### Task 3: Complete deterministic arrangement and naming guidance

**Files:**
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.ts`
- Modify: `apps/inboxos/src/shared/components/workflow/LayoutUtils.test.ts`
- Modify: `apps/inboxos/src/shared/components/WorkflowCanvas.tsx`
- Modify: `apps/inboxos/src/app/(admin)/studio/workflows/page.tsx`
- Modify: relevant workflow page/component tests

1. Add failing tests proving selected-route arrangement leaves unrelated coordinates unchanged and cycles retain every node.
2. Implement the selected-route wrapper around the existing deterministic layout helper.
3. Add non-blocking workflow-name guidance for blank/default names without rewriting values.
4. Ensure template and wizard creation continue to use deterministic arrangement before first display.
5. Run focused tests and commit the passing slice.

### Task 4: Simplify toolbar and workflow-list navigation

**Files:**
- Modify: `apps/inboxos/src/app/(admin)/studio/workflows/page.tsx`
- Modify: relevant workflow page tests
- Modify: translation catalogs used by InboxOS workflows

1. Add failing tests for search, Published/Draft/Archived filters, archived-hidden default, and retained lifecycle actions.
2. Add failing tests that Arrange, Test, and More controls retain every command and keep diagnostics authorization unchanged.
3. Implement client-side list controls and accessible command menus while keeping Back and Save primary.
4. Add English and Spanish strings through the existing translation system.
5. Run focused tests and i18n validation; commit the passing slice.

### Task 5: Release verification and guarded publication

**Files:**
- Update only release-generated metadata if the existing release scripts require it.

1. Review the complete diff for scope, executable-graph preservation, accidental secrets, and unrelated files.
2. Run the complete InboxOS workflow/component tests, typecheck, lint, i18n validation, and production build.
3. Verify the worktree is clean after commits and push the exact branch to its configured upstream.
4. Verify a current non-root AWS caller identity, then run read-only SSM preflight against the DOCMEE instance.
5. Deploy the exact pushed commit using `scripts/deploy-inboxos-safe.sh` as `ubuntu`; stop on any failed SSM invocation.
6. Verify service/rollback readiness and a fresh public `/api/health` response whose build ID matches the deployed commit.
7. Report source checks, push result, deployment result, public endpoint result, `execution_complete`, and `owner_accepted` separately.
