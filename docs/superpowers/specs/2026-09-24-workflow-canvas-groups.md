# Workflow canvas groups and semantic zoom

## Scope

The studio editor supports flat, collapsible presentation groups. Grouping does not introduce executable workflow nodes or change booking behavior. The existing version 2 workflow document stores group membership, names, and collapsed state in `presentation.groups`; execution nodes and edges remain in `definition`.

## Components

- `WorkflowCanvas.tsx`: editor integration, selection, dragging, projection, and group controls.
- `workflow/CustomGroupNode.tsx`: accessible parent container with toggle, title, count, rename, and ungroup controls.
- `workflow/SemanticZoom.ts`: subscribes to a primitive detail tier instead of continuous viewport coordinates. Full detail above 0.75; title/icon from 0.4 through 0.75; geometric color blocks below 0.4.
- `workflow/LayoutUtils.ts`: group normalization, document serialization, projection, collision packing, and group-aware auto-layout. Display offsets are derived from saved coordinates on each change to avoid cumulative drift. Collapsed parents proxy external connections while hiding internal nodes and edges.
- `workflow/OrthogonalEdge.tsx`: sharp Manhattan paths with 16px routing corridors. Short endpoint stubs retain exact handle coordinates; a background-colored casing separates crossing lines.
- `workflow/MockData.ts`: 36 synthetic nodes in three groups, with nine branching conditions and repeated split/rejoin paths.
- `workflow/WorkflowCanvasDemo.tsx`: isolated interactive preview with undo, redo, and reset.

Groups support moving, renaming, ungrouping, undo/redo, JSON import/export, and normal workflow saves. Expanded parents are excluded from routing obstacles so child connections remain inside their container. Expanding and collapsing reflows neighboring containers horizontally; group size transitions respect reduced-motion preferences. Nodes and edges are memoized, offscreen elements are culled, and routing is memoized independently of viewport movement.

## Preview and validation

Preview route: `/dev/workflow-canvas`. It is disabled in production unless `DOCMEE_CANVAS_PREVIEW=1` is explicitly supplied to the local preview process. The mock does not run workflow actions or create appointments.

Local optimized preview uses `NEXT_DIST_DIR=.next-workflow-build`, then starts on loopback port 3014 with the preview flag. An optimized build avoids the application's existing development-mode CSP restriction without weakening CSP.

Validation commands:

```text
pnpm --filter @docmee/inboxos test src/shared/components/workflow src/shared/components/WorkflowCanvas.test.tsx src/shared/workflowImport.test.ts src/shared/workflowLayout.test.ts src/shared/workflowHistory.test.ts
pnpm --filter @docmee/inboxos typecheck
pnpm --filter @docmee/inboxos build
```

The focused suite covers all eight collapse combinations, overlap prevention, collapse-space reclamation, routing within expanded parents, import/export preservation, invalid membership rejection, unchanged execution definitions, zoom boundaries, rendered tier contents, and orthogonal paths. Browser checks use synthetic data only. No production workflow migration is required.

Verified locally: 68 tests across seven files, standalone TypeScript checking, targeted ESLint, and the optimized Next build pass. Browser checks confirm full/balanced/macro rendering, expansion with internal orthogonal connections, two-node Shift-click grouping, group undo/redo, and group dragging with undo. No errors were recorded by the optimized preview. Production save/reload and clinic acceptance have not been exercised against live data.

## Publication

The user authorized publishing this implementation to `https://app.docmeedevelopment.dev/studio/workflows`. Release target: the existing DOCMEE service in AWS `mx-central-1`, instance `i-0c86fadeec6758b91`, checkout `/var/www/docmee`. Preserve the current booking and product-updates commits, retain the previous runtime artifacts for rollback, stage the Next build separately, and verify the serving build identity and application health after restart. Production workflows are not modified as part of release verification.
