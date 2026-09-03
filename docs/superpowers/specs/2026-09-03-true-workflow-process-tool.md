# True Workflow Process Tool

## Objective contract

- **Objective:** Evolve DOCMEE's workflow editor into a process-diagram tool that remains comprehensible to clinic operators and safe to execute as workflows grow beyond 100 nodes.
- **Scope:** Workflow canvas interaction, workflow document schema, validation/compiler boundary, revision lifecycle, durable execution state, simulation/inspection, and operator review surfaces.
- **Non-goals:** Replacing the existing queue, adding a general-purpose BPMN engine, changing clinical messaging behavior, or sending real provider messages during development.
- **Constraints and dependencies:** Existing active workflow revisions and paused executions must remain executable. The current queue, effect-idempotency ledger, and clinic authorization boundaries remain authoritative. No new graph-layout dependency is adopted until the current heuristic demonstrably cannot meet the large-graph acceptance checks.
- **Acceptance evidence:** A presentation-only edit cannot alter an execution revision; incompatible connections fail before save and at compile time; active changes are published through a revisioned lifecycle; a seeded 100-node graph remains navigable and has no node/edge collision regressions; an operator can simulate and inspect a run without sending external messages.
- **Gates and decision owner:** The product owner approves each production deployment and any provider-facing test. The current owner-approved design authorizes local implementation planning only.
- **Stop condition:** Stop a phase when its listed acceptance checks pass, a compatibility risk to active or paused executions is found, or a required product decision is unresolved.

## Decision

Adopt a single execution contract with an independent presentation layer. The diagram is a projection of the execution graph, never a second workflow system. The current canvas and executor are retained as the migration base; new behavior is introduced incrementally and remains backward-compatible with existing V1 graph rows.

## Current baseline

- The React Flow canvas supports LTR layout, 90-degree route metadata, minimap, snap grid, undo/redo, import/export, and selected-path emphasis.
- Edges currently identify only a source, target, and optional source branch handle.
- Node coordinates are stored with executable node definitions.
- Server validation enforces graph reachability, branch completeness, and pause-aware cycle safety.
- Executions pin active graph revisions and protect external effects with durable idempotency records.

## Delivery sequence

### Phase A — Interaction correctness and large-graph readability

1. Promote a hovered workflow edge above sibling edges and render it with an animated tracing treatment; restore stacking on pointer exit.
2. Keep routes orthogonal, preserve branch labels, and make edge promotion deterministic when multiple routes overlap.
3. Add a seeded large-graph canvas fixture and interaction test that confirms hover, keyboard deletion, panning, minimap navigation, and selected-path visibility.
4. Retain the existing dependency-free layout while measuring its crossing count, route clearance, and layout time at 100 nodes.

**Acceptance:** Hovering any edge brings that exact edge to the foreground without mutating workflow data; edges retain their labels/markers; no visual change alters saved nodes or transitions.

### Phase B — Canonical workflow document and compiler boundary

1. Add V2 execution graph and presentation layout types.
2. Persist execution nodes/transitions separately from positions, viewport, groups, and per-user presentation preferences.
3. Add a compatibility adapter that reads V1 nodes with `x`/`y` and projects them into V2 until each workflow is saved through the new editor.
4. Define node port contracts: inputs, outputs, branch outcomes, configuration schema, and produced context fields.
5. Add a compiler that produces structured diagnostics rather than parsing human-readable validator strings.

**Acceptance:** Removing presentation data leaves a compilable execution graph; an invalid port/data connection fails in the editor and API; the worker can run both V1 and V2 definitions during migration.

### Phase C — Authoring lifecycle and safe publication

1. Replace the active checkbox with explicit Draft, Validate, Ready for review, Published, Superseded, and Archived lifecycle states.
2. Add optimistic concurrency with a workflow ETag/revision token; reject stale saves with a diff/reload option.
3. Add execution revision comparison, publish notes, rollback to a prior revision, and deletion guards for revisions referenced by runs.
4. Keep layout-only edits out of executable revision history.

**Acceptance:** Two concurrent editors cannot silently overwrite each other; a published revision is immutable; rollback creates a new published pointer without rewriting execution history.

### Phase D — Durable runtime state and operations

1. Make run state explicit: `running`, `waiting`, `retry_scheduled`, `cancelled`, `compensating`, `failed`, and `completed`.
2. Persist resume reasons, selected transition, attempt number, timeout, cancellation reason, and idempotency/effect references.
3. Add bounded retry policies, cancellation, timeout escalation, and explicit compensation behavior for node types that need it.
4. Keep the current queue and effect ledger; do not introduce a separate orchestration platform unless acceptance evidence proves them insufficient.

**Acceptance:** A delayed, approval, or reply-waiting run survives worker restart; cancellation stops later transitions; uncertain provider outcomes remain manually reconcilable rather than being resent automatically.

### Phase E — Simulation, observability, and scalable UX

1. Add a test-event simulator with fixture context, mocked side effects, breakpoints, and branch coverage.
2. Add a run inspector that overlays actual node/edge traversal, durations, outcomes, and redacted context on the diagram.
3. Add subflows with explicit input/output interfaces, collapsible groups, and owner/system swimlanes.
4. Evaluate ELK layered layout and orthogonal routing against the 100-node fixture. Adopt it only if the existing heuristic fails the defined readability or routing checks.

**Acceptance:** An operator can test and diagnose a workflow without sending a provider message; a 100-node workflow is navigable through hierarchy, filtering, minimap, and canonical layout.

## Data model blueprint

```ts
type WorkflowDocumentV2 = {
  execution: ExecutionGraph
  presentation: WorkflowPresentation
}

type ExecutionGraph = {
  schemaVersion: 2
  nodes: Record<NodeId, ExecutableNode>
  transitions: Transition[]
}

type Transition = {
  id: string
  from: { nodeId: NodeId; port: string }
  to: { nodeId: NodeId; port: string }
  guard?: GuardExpression
}

type WorkflowPresentation = {
  layoutVersion: 1
  positions: Record<NodeId, { x: number; y: number }>
  groups: DiagramGroup[]
  viewport?: { x: number; y: number; zoom: number }
}
```

## Primary risks and mitigations

- **Migration risk:** Existing active and paused workflows contain V1 coordinate-bearing definitions. Use read compatibility and dual validation before writing V2; do not bulk rewrite live definitions.
- **UI complexity risk:** Subflows and typed ports can overwhelm novice operators. Stage them behind the existing guided editor and expose advanced graph controls progressively.
- **Runtime risk:** More lifecycle states can create inconsistent transitions. Centralize them in one tested transition reducer and preserve the current effect ledger as the external-effect boundary.
- **Layout dependency risk:** A new engine adds bundle size and behavioral change. Benchmark the existing heuristic first and adopt ELK only for measured insufficiency.

## Verification matrix

| Phase | Automated evidence | Human/product evidence |
|---|---|---|
| A | Canvas interaction and route-render tests; 100-node fixture | Visual readability review |
| B | V1/V2 compiler and migration tests | Schema/audit review |
| C | API concurrency, publish, rollback tests | Release workflow approval |
| D | Worker restart, retry, timeout, and cancellation tests | Operational runbook review |
| E | Simulation and trace-overlay tests | Operator task-based usability test |
