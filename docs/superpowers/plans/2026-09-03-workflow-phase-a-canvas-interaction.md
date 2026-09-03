# Workflow process tool — Phase A: Canvas interaction and routing

> **Owner:** Codex | **Status:** approved for implementation by the user on 2026-09-03

## Objective contract

Make dense workflow graphs legible without changing the persisted workflow definition. Hovering an edge must promote only that edge above overlapping routes and trace its full path. The implementation must retain the existing left-to-right orthogonal router and work for a 100-node fixture.

## Acceptance evidence

- A focused unit test proves an idle, selected, and hovered edge receive deterministic visual priorities.
- Canvas interaction tests prove hover state is local-only and does not call `onChange`.
- Routing/layout tests run against a 100-node deterministic fixture and report no invalid coordinates.
- InboxOS typecheck and targeted Vitest suites pass.

## Tasks

1. Add a pure `workflowEdgeAppearance` helper in `apps/inboxos/src/shared/components/WorkflowCanvas.tsx` that derives opacity, width, z-index, animation, and dash styling from selection and hover state. Keep `workflowPathAppearance` as the node/selected-path compatibility helper.
2. Extend `RoutedEdgeData` with a `hovered` flag. Render route labels with a higher stack order only for the hovered edge; retain pointer-events on the SVG edge so the edge remains hoverable.
3. Store one `hoveredEdgeId` in `WorkflowCanvasInner`; derive React Flow edges from source props plus this local id. Delete the current imperative `setEdges` hover mutation so a prop sync cannot erase a hover before leave.
4. Give all routes deterministic base z-indexes based on edge order and give the hovered route a reserved foreground z-index. Add an accessible `ariaLabel` describing source, branch label, and target.
5. Extend `WorkflowCanvas.test.tsx` before implementation for pure appearance states and add a test that asserts hover is not persisted. Add a 100-node fixture to `workflowLayout.test.ts` and assert every node coordinate and route point is finite.
6. Run `pnpm --filter @docmee/inboxos test -- --run src/shared/components/WorkflowCanvas.test.tsx src/shared/workflowLayout.test.ts src/shared/workflowLinearEdges.test.ts`, then `pnpm --filter @docmee/inboxos typecheck`.

## Compatibility / rollback

The change is presentation-only: `WorkflowNode`, `WorkflowEdge`, API payloads, and persisted revisions remain byte-compatible. Revert the Phase A commit to return to the existing routing interaction.
