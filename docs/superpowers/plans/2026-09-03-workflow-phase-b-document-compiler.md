# Workflow process tool — Phase B: Document model, ports, and compiler

> **Owner:** Codex | **Status:** approved for implementation by the user on 2026-09-03

## Objective contract

Separate execution semantics from presentation metadata while retaining V1 `nodes`/`edges` compatibility. Enforce typed/semantic port compatibility at the same API validation boundary that already protects active workflow writes.

## Acceptance evidence

- V1 payloads round-trip unchanged through the repository and API.
- A V2 document with `definition` and `presentation` persists and compiles to the same execution graph.
- Invalid port pairs are rejected with structured `WorkflowValidationIssue` data identifying the edge and compatible ports.
- Validator, repository, and API tests pass.

## Tasks

1. Introduce `WorkflowDocumentV2`, `WorkflowPresentation`, `WorkflowPort`, and `WorkflowCompiledDefinition` types in `packages/db/src/types/database.ts`; leave V1 `WorkflowDefinition` public and supported.
2. Add a dependency-free `packages/agents/src/workflows/workflow-compiler.ts` that normalizes V1/V2 documents to executable nodes and edges, stripping `x`, `y`, viewport, grouping, and comments from the compiled graph.
3. Model static input/output port declarations in `packages/agents/src/workflows/workflow-ports.ts`. Start with control-flow ports and branch handle semantics already defined in `workflowNodes.ts`; reject impossible source/target combinations while retaining unknown legacy handles as warnings in draft mode.
4. Extend `validateWorkflowDefinitionDetailed` to accept a document, call the compiler, and add structured `invalid_port_connection` issues. Preserve existing string details for clients that have not upgraded.
5. Add optional `document` to API create/patch schemas, normalize it on write, and return document metadata without requiring a client migration. When both legacy graph fields and document appear, reject divergent definitions.
6. Persist presentation in a dedicated `workflow_presentation` JSONB column with an additive migration. Backfill each existing row from its node x/y values. Keep `nodes`/`edges` authoritative for execution until all consumers use compiled definitions.
7. Add compiler, validator, repository, and route tests before each production implementation step; include V1 import, V2 import, layout-only edits, and incompatible ports.

## Compatibility / rollback

This is additive. V1 clients continue PATCHing `nodes`/`edges`; the repository synthesizes a V2 presentation projection. The migration keeps legacy JSON fields. Rollback means ignoring the new column and code path, not dropping stored data.
