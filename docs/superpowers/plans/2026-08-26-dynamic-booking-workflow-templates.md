# Dynamic WhatsApp Booking Workflow Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver two validated booking workflow templates backed by dynamic doctors, enabled services, five-day live availability, AI inquiry routing, and real secretary handoff.

**Architecture:** Extend the existing interactive-menu node with worker-owned dynamic data sources and structured selection outcomes. Reuse the existing availability, slot-menu, AI-agent, booking, Google Calendar, and handoff infrastructure. Keep static menus backward-compatible and enforce doctor/service validity again at booking creation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Next.js InboxOS, BullMQ worker, PostgreSQL repositories, Meta WhatsApp Cloud API, Google Calendar.

**Spec:** `docs/superpowers/specs/2026-08-26-dynamic-booking-workflow-templates.md`

## Global Constraints

- Follow test-driven development: add one focused failing test, observe the expected failure, then implement the smallest passing change.
- Preserve existing static interactive-menu behavior.
- Use stable database IDs for routing and booking; labels are display-only.
- Do not deploy to production without a separate explicit approval.

---

### Task 1: Define dynamic interactive-menu contracts

**Files:**
- Modify: `packages/agents/src/workflows/workflow-engine.ts`
- Modify: `packages/agents/src/workflows/workflow-validator.ts`
- Test: `packages/agents/src/__tests__/workflow-engine.test.ts`
- Test: `packages/agents/src/__tests__/workflow-validator.test.ts`

1. Add failing engine tests for page-aware re-entry, structured selection, stable ID storage, label storage, pagination, and unmatched-reply resend.
2. Add failing validator tests for fixed dynamic-menu handles and no static-option requirement.
3. Add the minimal types and engine/validator behavior.
4. Run the focused agent tests.

### Task 2: Load and send live doctor/service menus

**Files:**
- Modify: `apps/workers/src/workflow-runner.worker.ts`
- Test: `apps/workers/src/__tests__/workflow-runner-dynamic-menu.test.ts`

1. Add failing pure-helper tests for pagination and reply matching.
2. Add failing executor tests for active clinic doctors, enabled doctor services, unique-doctor resolution, and empty-state behavior.
3. Implement repository-backed menu item loading and Meta payload generation.
4. Run focused worker tests.

### Task 3: Add a real secretary-handoff node

**Files:**
- Modify: `packages/agents/src/workflows/workflow-engine.ts`
- Modify: `packages/agents/src/workflows/workflow-validator.ts`
- Modify: `apps/workers/src/workflow-runner.worker.ts`
- Modify: `apps/inboxos/src/shared/workflowNodes.ts`
- Test: `packages/agents/src/__tests__/workflow-engine.test.ts`
- Test: `apps/workers/src/__tests__/workflow-runner-ai-agent.test.ts`

1. Add a failing engine test proving the action executes and ends or continues as wired.
2. Add a failing worker test proving it pauses the bot and notifies staff.
3. Implement the smallest executor boundary using existing handoff utilities.
4. Run focused tests.

### Task 4: Enforce selected doctor/service compatibility

**Files:**
- Modify: `apps/workers/src/workflow-runner.worker.ts`
- Test: `apps/workers/src/__tests__/workflow-runner-booking.test.ts`

1. Add a failing test for a disabled or unassigned service.
2. Validate the service through the doctor-services repository immediately before appointment creation.
3. Preserve current live-slot revalidation.
4. Run focused booking tests.

### Task 5: Expose dynamic menu configuration in Studio

**Files:**
- Modify: `apps/inboxos/src/shared/workflowNodes.ts`
- Modify: relevant workflow editor configuration component(s)
- Modify: relevant InboxOS translation dictionaries
- Test: `apps/inboxos/src/shared/workflowCatalog.test.ts`

1. Add failing catalog/UI helper tests for new enum values, branch rows, and issue detection.
2. Add option-source, source-field, and page-size fields with clear labels and hints.
3. Hide static option editing when a dynamic source is selected if supported by the existing panel structure.
4. Run focused InboxOS tests.

### Task 6: Add the two approved templates

**Files:**
- Modify: `apps/inboxos/src/shared/workflowTemplates.ts`
- Modify: InboxOS translation dictionaries
- Test: `apps/inboxos/src/shared/workflowCatalog.test.ts`

1. Add failing tests asserting both templates exist, validate, and contain the required booking/AI/handoff graph.
2. Implement the single-doctor template.
3. Implement the multiple-doctor template.
4. Assert five-day availability, dynamic enabled services, stable ID fields, interactive date/time menus, AI scenario routes, and real handoff nodes.
5. Run focused template tests.

### Task 7: Verify, review, commit, and push

**Files:**
- Review all changed files.

1. Run focused tests after each task.
2. Run package typechecks, full relevant test suites, and builds.
3. Review the diff for secrets, accidental scope expansion, and backward compatibility.
4. Commit atomically and push the feature branch.
5. Report GitHub evidence and request explicit production deployment approval.
