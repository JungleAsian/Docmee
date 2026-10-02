# Workflow Builder Cleanliness and Operability Design

## Objective

Make the Admin Studio workflow experience easier to read, arrange, test, and maintain for every existing and future workflow without changing what a workflow executes.

The upgrade is presentation-first. Executable `definition.nodes` and `definition.edges` remain authoritative. Existing saved coordinates remain unchanged until an administrator deliberately uses an arrange action. New workflows receive cleaner presentation defaults when they are created.

## Scope

- Simplify the editor toolbar while preserving every current command.
- Reduce connector noise in collapsed groups.
- Add a focused-route view for tracing one branch through a large workflow.
- Improve deterministic left-to-right layout and group packing.
- Add safe naming guidance without silently renaming workflow data.
- Improve workflow-list navigation for active, draft, and archived workflows.
- Apply the behavior through shared builder components so it covers current and future workflows.
- Preserve bilingual English and Spanish UI, keyboard access, diagnostics, simulation, import/export, undo/redo, and save validation.

## Non-goals

- No change to the workflow runner, node semantics, provider selection, booking logic, or patient-facing messages.
- No automatic publication, activation, archival, deletion, or mutation of existing workflows.
- No forced coordinate migration when an existing workflow is opened.
- No new workflow-document version unless implementation proves the existing `presentation` fields cannot represent an optional user preference.
- No attempt to automatically translate or rewrite administrator-authored node names.

## Approaches considered

### Shared presentation adapter (recommended)

Derive collapsed-group proxies, route emphasis, and clean layout from the existing graph and presentation metadata. Keep the executable graph untouched and persist only user-initiated presentation changes.

This is the safest release approach because it improves all workflows without a database migration or runtime coupling. It also keeps the existing preview route and focused unit-test boundary.

### Persisted graph migration

Rewrite saved workflows into a new visual schema with explicit proxy nodes and layout lanes. This could make rendering simpler later, but it introduces migration, rollback, and compatibility risk shortly before release. It is rejected for this release.

### Styling-only cleanup

Reduce spacing and hide labels with CSS. This is low effort but does not solve duplicated group ports, edge crossings, route comprehension, or command density. It is rejected as insufficient.

## Architecture

The implementation remains split into four presentation responsibilities:

1. `LayoutUtils.ts` owns pure graph projection, collapsed-group boundary aggregation, focus-route derivation, and deterministic layout helpers.
2. `CustomGroupNode.tsx` renders an accessible group summary with aggregated boundary ports and connection counts.
3. `WorkflowCanvas.tsx` owns local canvas interaction state, including focus mode, edge emphasis, arrange actions, and selection behavior.
4. `studio/workflows/page.tsx` owns editor-level commands and workflow-list filtering. It does not duplicate graph algorithms.

Pure helpers must not read browser state or mutate their inputs. React components derive rendering from props and local UI state. Any saved presentation change continues through the existing `WorkflowCanvasGraph` and history contract.

## Collapsed-group boundary aggregation

The current projection redirects each external edge to a collapsed group while retaining a separate handle for every connector. That preserves graph fidelity but creates stacked labels and dense crossings.

The new projection groups boundary connections by:

- direction: incoming or outgoing;
- branch class: success/default, conditional branch, error, or other named output;
- external endpoint when separate destinations are necessary to avoid ambiguous interaction.

Each bucket produces one visible proxy port. Its accessible label includes direction, branch label, and connection count. The rendered edge represents the bucket, while its presentation data retains the underlying edge IDs. Expanding the group restores every original internal node and edge. Saving or exporting never replaces executable edges with proxy edges.

Parallel edges sharing the same visible route use a count badge instead of repeated labels. A single edge remains visually unchanged.

## Focused-route view

Selecting a node or visible edge offers a `Focus route` action. Focus mode derives the connected upstream and downstream path from the executable graph, constrained to the selected branch when an edge is the origin.

In focus mode:

- route nodes and edges retain normal contrast;
- unrelated nodes and edges remain visible at reduced contrast;
- groups containing route nodes remain visible and show a route indicator;
- a clear `Show all` control exits focus mode;
- editing, saving, simulation, and diagnostics continue to operate normally.

Focus is local editor state. It is not saved in the workflow document and resets when the editor closes or the graph is replaced by import.

## Layout behavior

`Arrange workflow` remains explicit for existing workflows. It performs a deterministic left-to-right layout using topological depth and stable node IDs as tie-breakers. Trigger nodes occupy the first lane, actions and terminal nodes progress rightward, and branch siblings receive stable vertical ordering.

Groups are laid out internally first, then packed as containers. Collapsed and expanded groups use the same logical lane anchor so toggling a group does not create cumulative drift. Obstacles and routes are recalculated after measurement, with a stable fallback size for nodes not yet measured.

`Arrange selected route` affects only the selected connected route and leaves unrelated saved coordinates unchanged. Both arrange actions participate in undo/redo and mark the editor dirty.

New workflows created from templates or the guided wizard receive the deterministic arrangement before first display. A completely blank workflow is unaffected.

## Edge presentation

Edges continue to use orthogonal routing. Presentation changes are limited to:

- shared visual trunks for route-identical projected edges;
- one label near the decision source instead of repeated midpoint labels;
- stronger hover and selection emphasis;
- reduced contrast for unrelated routes while focusing;
- count badges for aggregated collapsed-group connections;
- casing and obstacle avoidance retained for readable crossings.

Underlying edge IDs remain individually addressable for validation, diagnostics, editing, import/export, and execution.

## Toolbar and editor controls

The first row retains the workflow name, builder mode, publication status, and primary Save action. Secondary actions move into two labeled menus:

- `Arrange`: undo, redo, arrange workflow, arrange selected route, group selection, and expand/collapse all groups.
- `Test`: simulator and superuser-only diagnostics.

Import and export move to a `More` menu. All menu actions remain keyboard reachable and expose their disabled reason when unavailable. Undo and redo keep their keyboard shortcuts. Narrow layouts wrap or collapse menus without hiding Save or Back.

The simulator remains hidden by default and opens only after the user requests it. Diagnostics authorization remains unchanged and must not become visible to non-superusers.

## Naming guidance

The editor provides non-blocking guidance for unclear or mixed naming. Guidance covers blank names, duplicated visible names, default placeholders, and mixed-language system labels. It never rewrites administrator-authored content automatically.

Built-in labels and generated defaults use the active UI language consistently. Existing custom names remain exactly as saved unless the administrator edits them.

## Workflow list cleanup

The list adds search and explicit status filters for Published, Draft, and Archived workflows. Archived workflows are hidden by default but remain available through the filter. The list preserves all lifecycle actions and never archives or deletes records automatically.

The list displays a concise node count, last-updated time, and status. Search is client-side over the currently loaded clinic-scoped records and does not alter API contracts.

## Data flow and persistence

1. The API returns a workflow document containing executable definition and presentation metadata.
2. The editor initializes history with executable nodes/edges and cleaned presentation groups.
3. Pure projection helpers derive group proxies, aggregated ports, routes, and focus visibility for rendering only.
4. UI-only state such as menus, focus mode, and filters remains local and is never serialized.
5. User-initiated coordinate, grouping, or collapse changes flow through existing history and `workflowDocument` serialization.
6. Save continues to submit the unchanged executable graph plus presentation metadata through the existing version check.

## Error handling and safe fallbacks

- Invalid or stale group membership is removed by the existing normalization boundary.
- If boundary aggregation cannot classify an edge, it uses a visible `Other` bucket and retains the underlying edge ID.
- If layout encounters a cycle, cyclic nodes stay in a stable lane ordered by current position and ID; no node is dropped.
- If routing cannot find a clean corridor, the existing finite orthogonal fallback is used.
- If a menu action is unavailable because nothing is selected or no workflow has been saved, it is disabled with an explanatory label.
- Import continues to fail closed on invalid workflow documents. Focus state and transient menus reset after a successful import.

## Accessibility and responsive behavior

- Controls use native buttons, menus, inputs, and labels with visible keyboard focus.
- Aggregated ports expose branch and count information without relying on color.
- Focus mode uses opacity in addition to persistent geometry; unrelated content is never removed solely for visual emphasis.
- Reduced-motion preferences disable nonessential layout transitions.
- The toolbar keeps Back and Save visible at narrow widths and allows secondary groups to collapse into menus.
- English and Spanish strings are added to the existing translation catalogs and checked by the repository i18n validation.

## Performance boundaries

- Projection, aggregation, route derivation, and layout stay memoized pure computations.
- Focus changes must not rewrite graph history or trigger API calls.
- Boundary aggregation reduces rendered handles and labels for collapsed groups.
- The existing dynamic canvas bundle, semantic zoom, offscreen culling, and memoized node/edge components remain intact.
- No new runtime dependency is required.

## Test strategy

Implementation follows test-first red-green-refactor cycles.

### Pure layout and projection tests

- Collapsed groups aggregate repeated incoming and outgoing edges without changing executable edges.
- Proxy buckets retain all underlying edge IDs and expand back to the original graph.
- Deterministic layout produces stable lanes across repeated runs and handles cycles without dropping nodes.
- Selected-route layout leaves unrelated coordinates unchanged.
- Focus-route derivation includes the expected upstream/downstream branch and handles collapsed membership.

### Component tests

- Group summaries expose accessible connection counts and unique proxy handles.
- Focus route and Show all controls apply the correct visible state.
- Arrange, Test, and More menus preserve all commands, disabled states, and authorization boundaries.
- New naming guidance is advisory and does not mutate values.
- Workflow-list search/status filters hide archived records by default and can reveal them.
- English and Spanish labels render from translation keys.

### Regression checks

- Existing workflow history, import/export, publish, simulation, diagnostics, validation, and document serialization tests remain green.
- InboxOS lint, typecheck, focused tests, i18n check, and production build pass.
- Browser verification covers a current large workflow, a newly created template workflow, collapsed/expanded groups, route focus, narrow toolbar, keyboard navigation, and save/reload without execution-graph changes.
- A before/after serialized definition comparison proves that presentation-only actions do not modify executable nodes or edges.

## Release and rollback

This design does not authorize deployment. Implementation and publication are separate gates.

The release must target only `https://app.docmeedevelopment.dev`; `docmee.ai` remains out of scope. The deployment must use the existing safe release path, preserve rollback artifacts, and prove the public build ID. Owner acceptance remains separate from automated verification.

If browser acceptance reveals unreadable routes or command loss, rollback is the previous application build. No data rollback is expected because the release introduces no required workflow-document migration.

## Acceptance criteria

1. Every current workflow opens without automatic coordinate or execution-graph changes.
2. Every new template or wizard workflow opens in the deterministic clean layout.
3. Collapsed groups show aggregated boundary ports and counts instead of one visible port per internal edge.
4. Administrators can focus one route and return to the complete graph without saving transient state.
5. All existing editor commands remain available through a smaller, keyboard-accessible toolbar.
6. Archived workflows are hidden by default but discoverable through filters; no record changes automatically.
7. English and Spanish interfaces remain complete.
8. Simulation, superuser diagnostics, save validation, import/export, publish lifecycle, and runtime execution remain functionally unchanged.
9. Focused automated checks, typecheck, lint, i18n validation, production build, and browser acceptance provide fresh evidence before release.
