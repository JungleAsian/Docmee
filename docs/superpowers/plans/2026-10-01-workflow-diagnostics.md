# Superuser Workflow Diagnostics Implementation Plan

> **For Codex:** Execute this plan with `superpowers-executing-plans`, following strict red-green-refactor TDD and fresh verification before completion.

**Goal:** Add a clinic-scoped, platform-superuser-only workflow diagnostics action that combines existing validation, deterministic simulation, safe dependency readiness, and redacted recent-run evidence without production side effects.

**Architecture:** Keep the existing workflow validator, simulator, execution repository, and redaction function as the sources of truth. Add one small API aggregation module for deterministic report/status construction, one authorized route that orchestrates existing components, and one accessible InboxOS drawer wired into the existing workflow editor. Do not add providers, dependencies, background work, or persistence beyond an audit metadata event.

**Tech Stack:** TypeScript, Fastify, Zod, Vitest, React 19, Next.js 15, TanStack Query, Zustand, pnpm workspace.

**Governing design:** `docs/superpowers/specs/2026-10-01-workflow-diagnostics-design.md`

---

## Task 1: Create the deterministic diagnostics report model

**Files:**
- Create: `apps/api/src/lib/workflow-diagnostics.ts`
- Test: `apps/api/src/lib/workflow-diagnostics.test.ts`

### Step 1: Write failing status-calculation tests

Cover these observable rules:

- a report with no errors, warnings, failed simulations, or unresolved dependencies is `ready`;
- validator errors, required simulation failures, or required integration failures are `not_ready`;
- warnings, unknown readiness, timeouts, or optional-path failures are `needs_attention`;
- the report preserves the requested source (`saved_graph` or `unsaved_graph`) and section evidence.

Run:

```powershell
pnpm.cmd --filter @docmee/api test -- src/lib/workflow-diagnostics.test.ts
```

Expected: FAIL because the aggregation module does not exist.

### Step 2: Implement the smallest pure aggregation module

Add explicit report types and a pure `buildWorkflowDiagnosticReport` function. It must accept already-produced validator findings, simulations, integrations, and recent runs; calculate status deterministically; and add timestamps/source without performing I/O.

Integration result states are `ready | warning | failed | unknown`. A timeout is represented as `unknown`, never success.

### Step 3: Re-run focused tests

Run the same command and require PASS.

### Step 4: Commit

```powershell
git add apps/api/src/lib/workflow-diagnostics.ts apps/api/src/lib/workflow-diagnostics.test.ts
git commit -m "feat(workflows): add diagnostic report model"
```

## Task 2: Add the superuser-only diagnostics API

**Files:**
- Modify: `apps/api/src/routes/workflows.ts`
- Modify: `apps/api/src/routes/workflows.test.ts`
- Reuse: `packages/agents/src/workflows/workflow-validator.ts`
- Reuse: `packages/agents/src/workflows/workflow-simulator.ts`
- Reuse: `packages/db/src/repositories/workflow-executions.repository.ts`

### Step 1: Write failing route tests

Add tests proving:

- anonymous, clinic admin, secretary, and doctor requests return `403` before workflow/run repositories or readiness checks are touched;
- an `ia_studio_admin` can diagnose the saved graph;
- an optional editor graph is diagnosed as `unsaved_graph` and is not persisted;
- a workflow from another clinic is not disclosed;
- invalid graphs return structured node/edge findings, suppress simulation, and still return readiness/run sections;
- recent traces are passed through the existing recursive redactor;
- the audit event contains actor/clinic/workflow/source/section/result-count metadata but no graph values, messages, credentials, or provider payloads.

Run:

```powershell
pnpm.cmd --filter @docmee/api test -- src/routes/workflows.test.ts
```

Expected: FAIL with `404` for the new endpoint or missing response fields.

### Step 2: Add the request schema and authorized route

Add `POST /clinics/:id/workflows/:workflowId/diagnostics` with `requireRole('ia_studio_admin')` as its route pre-handler. Use the existing workflow lookup by both clinic ID and workflow ID. Parse an optional graph with limits no looser than the simulation endpoint, optional simulation/readiness flags, and a bounded recent-run limit.

The route must:

1. resolve the saved workflow within the selected clinic;
2. use the submitted graph only in memory;
3. call `validateWorkflowDefinitionDetailed`;
4. run the existing deterministic simulator only when the graph has no blocking validation error and simulation is enabled;
5. derive only safe, read-only dependency evidence for referenced graph capabilities, returning `unknown` where no established non-mutating health check exists rather than guessing success;
6. fetch recent runs and redact traces using `redactWorkflowDiagnostic`;
7. aggregate the report with `buildWorkflowDiagnosticReport`;
8. write one metadata-only audit event.

No provider call, message send, appointment write, patient write, queue operation, workflow save, or publish operation is permitted.

### Step 3: Re-run focused API tests

Run the route test, then the pure aggregation test. Require PASS.

### Step 4: Commit

```powershell
git add apps/api/src/routes/workflows.ts apps/api/src/routes/workflows.test.ts
git commit -m "feat(workflows): add superuser diagnostic endpoint"
```

## Task 3: Build the accessible diagnostics drawer

**Files:**
- Create: `apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.tsx`
- Create: `apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.test.tsx`

### Step 1: Write failing component tests

Test that the component:

- renders loading, error, empty, partial, and completed states;
- displays `Ready`, `Needs attention`, and `Not ready` faithfully;
- labels saved versus unsaved editor content;
- separates workflow checks, mocked safe tests, integration readiness, and recent runs;
- invokes `onFocusIssue` with the affected node or edge when **Go to step** is used;
- exposes appropriate drawer/dialog semantics and a keyboard-accessible close button;
- renders the diagnostics launcher only for `ia_studio_admin`;
- explains that a never-saved workflow must be saved once before diagnosis.

Run:

```powershell
pnpm.cmd --filter @docmee/inboxos test -- src/shared/components/WorkflowDiagnosticsPanel.test.tsx
```

Expected: FAIL because the component does not exist.

### Step 2: Implement the component

Create a focused presentational drawer and launcher using existing InboxOS visual patterns. Keep API/domain types local and explicit. Do not add a UI library or change shared theme behavior.

### Step 3: Re-run component tests

Run the same focused command and require PASS.

### Step 4: Commit

```powershell
git add apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.tsx apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.test.tsx
git commit -m "feat(workflows): add diagnostic report drawer"
```

## Task 4: Wire diagnostics into the existing workflow editor

**Files:**
- Modify: `apps/inboxos/src/app/(admin)/studio/workflows/page.tsx`
- Modify: `apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.test.tsx`

### Step 1: Add failing integration-oriented component tests

Extend the launcher tests to verify its click behavior and payload helper. The payload must include the current unsaved nodes/edges, enable the requested safe sections, and never include unrelated patient or credential data.

### Step 2: Connect the editor

In `WorkflowEditor`:

- read the authenticated role from the established auth store;
- render **Diagnose workflow** beside **Simulate** only for `ia_studio_admin`;
- for a saved workflow, POST the current in-memory graph to the diagnostics endpoint;
- for a never-saved workflow, open the panel with the save-once explanation and make no request;
- keep the canvas visible;
- pass a finding back to the existing focus/highlight state;
- show a factual reminder that diagnostics are not proof of future provider delivery.

### Step 3: Run focused frontend tests and type check

```powershell
pnpm.cmd --filter @docmee/inboxos test -- src/shared/components/WorkflowDiagnosticsPanel.test.tsx src/shared/components/WorkflowSimulationPanel.test.tsx
pnpm.cmd --filter @docmee/inboxos typecheck
```

Require PASS.

### Step 4: Commit

```powershell
git add apps/inboxos/src/app/(admin)/studio/workflows/page.tsx apps/inboxos/src/shared/components/WorkflowDiagnosticsPanel.test.tsx
git commit -m "feat(workflows): connect superuser diagnostics"
```

## Task 5: Verify the complete local release candidate

**Files:**
- Review all files changed since `6ebd7be`

### Step 1: Run focused and full relevant checks

```powershell
pnpm.cmd --filter @docmee/api test -- src/lib/workflow-diagnostics.test.ts src/routes/workflows.test.ts
pnpm.cmd --filter @docmee/inboxos test -- src/shared/components/WorkflowDiagnosticsPanel.test.tsx src/shared/components/WorkflowSimulationPanel.test.tsx
pnpm.cmd --filter @docmee/api typecheck
pnpm.cmd --filter @docmee/inboxos typecheck
pnpm.cmd --filter @docmee/api lint
pnpm.cmd --filter @docmee/inboxos lint
pnpm.cmd --filter @docmee/api test
pnpm.cmd --filter @docmee/inboxos test
pnpm.cmd --filter @docmee/api build
pnpm.cmd --filter @docmee/inboxos build
```

### Step 2: Review safety and scope

- inspect the diff for accidental workflow mutation, provider calls, patient data, credentials, or queue usage;
- confirm the API enforces `ia_studio_admin` independently of UI hiding;
- confirm cross-clinic lookup uses both clinic ID and workflow ID;
- confirm traces and audit metadata are redacted/minimal;
- run `git diff --check`.

### Step 3: Final corrective commit if required

Commit only verified corrections with a narrowly scoped message. Do not push or deploy in this implementation task unless the owner separately authorizes publication.

### Step 4: Report distinct evidence

Report source changes, test/type/lint/build evidence, deployment state (`not deployed`), `execution_complete`, and `owner_accepted` separately.
