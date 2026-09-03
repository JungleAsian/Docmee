# Workflow process tool — Phase E: Simulation, observability, and composition

> **Owner:** Codex | **Status:** approved for implementation by the user on 2026-09-03

## Objective contract

Give operators a safe way to understand a workflow before publishing and diagnose a specific run after it executes. Add progressive-disclosure composition aids without making ELK.js a speculative dependency.

## Acceptance evidence

- Simulation never invokes providers or enqueues jobs, and produces a deterministic trace.
- Run inspection is clinic-scoped and redacts sensitive context.
- Groups/swimlanes are presentation-only and do not alter compiled execution.
- A reproducible 100-node layout benchmark decides whether the current router warrants an ELK spike.

## Tasks

1. Add a dry-run executor adapter that records intended node actions and branch decisions without side effects. Expose a rate-limited `POST /simulate` endpoint requiring operator role.
2. Add read-only execution inspection routes that return trace, current state, revision metadata, and sanitized diagnostics; never return message bodies, secrets, or raw provider payloads.
3. Add InboxOS simulation control, a trace panel, and a run inspector view. Make error focus reuse existing `focusIssue`/fit-view behavior.
4. Add presentation-only group and swimlane types to `WorkflowPresentation`; render collapsed groups as a single summary card and expand on demand. Preserve node positions relative to the group.
5. Add a benchmark fixture in `workflowLayout.test.ts` measuring 100-node routing/crossings with a deterministic upper bound. Add an engineering decision record only if the benchmark or visual acceptance fails; do not add ELK.js beforehand.
6. Add tests for simulator side-effect prohibition, response redaction, group serialization, and benchmark determinism. Complete package typechecks, all affected test suites, and an independent visual QA pass at desktop and narrow widths.

## Compatibility / rollback

Simulation and inspection are read-only additions. Groups/swimlanes are stored in presentation metadata and ignored by compiler/runtime. If a UI feature regresses, hide it while preserving graph execution and audit data.
