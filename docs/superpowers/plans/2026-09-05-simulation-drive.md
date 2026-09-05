# Simulation and Drive Implementation Plan

> Execute approved tasks in this session with subagent-driven-development and focused review.

**Goal:** Let clinic users safely test workflow paths and browse/select/upload Drive media through clear integration settings.
**Architecture:** Reuse workflow engine with isolated simulation adapters. Extend existing Drive client/routes and Google OAuth, not a second credential store.
**Tech Stack:** Existing TypeScript, Fastify, React/Next, pnpm, Vitest.
**Spec:** User-approved scope in this conversation, recorded below.

## Global Constraints

- No real messages, patient writes, scheduling jobs, or provider calls during simulation.
- Drive supports browse, select/import, upload. No source-file deletion or overwrite API.
- Preserve clinic authorization, encrypted credentials, existing consent flow and feature flags.
- No deployment, OAuth consent, or real provider upload during implementation.
- Acceptance: focused regression tests, type checks, independent diff review. Report live-provider and visual checks separately.
- Stop on unsafe external effects or missing authority; continue safe local implementation.

## Task 1: Workflow simulator

Own packages/agents/src/workflows/workflow-simulator.ts and tests, apps/api/src/routes/workflows.ts and tests, workflow page and focused simulation components/canvas simulation props.

- [ ] Add failing tests for conversation reply pause/resume, virtual delay, approval outcomes, controlled provider failures, trace/coverage, bounds, zero side effects.
- [ ] Extend simulateWorkflow using runWorkflowWithOutcome and isolated adapters; expose typed simulation inputs/results. Use deterministic replay if needed, bounded steps; no persistent simulation sessions required. Capture messages, context snapshots, node/edge IDs, errors with remediation; unsupported nodes must be explicit, not success.
- [ ] Extend authorized endpoint to validate input and support editor scenarios without mutating stored workflow. Retain graph validation.
- [ ] Build interactive panel with Run/Step/Pause/Reset, reply/menu entry, virtual-time advance, scenario outcomes, clickable errors, current path highlighting and tested/untested coverage. Clearly label mocked providers. Reset stale results on graph changes.
- [ ] Verify node categories and failure paths with Vitest plus affected typecheck/lint; report exact coverage limits.

## Task 2: Drive and integration rows

Own Drive client/tests, google-drive-media routes/tests, Google OAuth scope wiring, Channels page, media repository component and tests.

- [ ] Add failing tests for upload permission, multipart size/type validation, clinic isolation, provider errors and no delete endpoint.
- [ ] Extend existing Drive ops with create-only upload; use scoped Google consent (read-only browse plus drive.file write), refresh tokens through existing encrypted storage. Reject missing write consent with reconnect instruction.
- [ ] Add bounded multipart upload endpoint and media repository upload UI with progress/pending/error/result states. Never delete or overwrite Drive sources.
- [ ] Add Drive integration card with truthful authorization status, connect/reconnect and repository navigation.
- [ ] Convert integration cards to full-width rows: Facebook, Instagram, Calendar, Sheets, Drive. Identity left, actions right, expanded configuration below; stack at narrow widths.
- [ ] Run focused tests/typechecks/lint and review permission/size/error cases. Live consent and upload acceptance remain unobserved until authorized test.

## Review ledger

Base: 80ca352. Both tasks touch independent UI/routes; agents index exports may overlap, preserve prior exports. Task 1 owns simulation contracts, Task 2 uses existing Drive contracts. No contradictory scope found. Implementers run sequentially; controller may inspect later surfaces while implementation runs. No commits/push/deploy in this request; leave reviewed local diff.
