# Task 1 report: KB freshness, scoped retrieval, and index integrity

Status: **DONE_WITH_CONCERNS** (source and local automated verification complete; real PostgreSQL migration/query execution remains unverified).

## Outcome

- Added a clinic-scoped retrieval revision and current-version/effective-window/index-status schema in `packages/db/supabase/migrations/20260920000001_kb_freshness.sql`.
- Added the transactional `writeDocument` contract. A content write locks the document, increments its version, deactivates every prior chunk, clears prior vectors, creates lexical chunks for the new version, marks vector indexing `pending`, and increments the clinic retrieval revision in one transaction.
- Manual create/edit and upload now use the same writer and enqueue exactly one versioned `embed-document` job. Activation, approve-all, and retry/reindex enqueue current versions. Queue and embedding failures leave an explicit retryable `failed` state.
- The embedding worker only writes to an active chunk whose clinic, document, and document version still match the current document. A stale job therefore cannot reactivate or update superseded evidence.
- Hybrid search and both legacy list methods now exclude unapproved, ineffective, withdrawn, inactive, superseded, cross-clinic, and inapplicable doctor-scoped evidence. Lexical retrieval runs without a vector; language is a preference rather than a hard filter. Search results expose document/version/revision/provenance/effective-window fields.
- Scope, status, content, delete, approve, and reindex retrieval mutations invalidate the clinic revision. The KB listing exposes the revision and persisted indexing status/error for Task 3.

## RED evidence

1. `pnpm --filter @docmee/db test -- src/__tests__/knowledge.repository.test.ts`
   - RED: 3 failures proved missing lexical-without-vector execution, current/effective/approved/doctorless filters, and language fallback.
2. `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts`
   - RED: stale write guard missing; later failure-path test proved an embedding error was not persisted/rethrown.
3. `pnpm --filter @docmee/api test -- src/routes/kb.test.ts src/routes/kb-upload.test.ts`
   - RED: create/upload did not use the atomic writer and edit did not queue a versioned reindex.
4. Hardening REDs:
   - DB focused test: 3 failures proved doctor-scope/delete revision invalidation and qualified grouped SQL were absent.
   - API focused test: activation produced zero `embed-document` calls.

## GREEN verification

- `pnpm --filter @docmee/db test` -> **16 files, 63 tests passed**.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` -> **1 file, 4 tests passed**.
- `pnpm --filter @docmee/api test -- src/routes/kb.test.ts src/routes/kb-upload.test.ts src/routes/assistant.test.ts src/routes/jzel.test.ts` -> **4 files, 31 tests passed**.
- `pnpm --filter @docmee/db typecheck`, `pnpm --filter @docmee/workers typecheck`, `pnpm --filter @docmee/api typecheck` -> **passed**.
- `pnpm --filter @docmee/db lint`, `pnpm --filter @docmee/workers lint`, `pnpm --filter @docmee/api lint` -> **passed**.
- `git diff --check` -> **passed**.
- Full worker regression: **385 tests passed, 5 failed** in pre-existing workflow-booking cases whose fixed 2026 appointment fixtures are now in the past; the run also reported local Redis `ECONNREFUSED`. Focused owned worker tests pass.

## Exact contract for Task 2 candidate approval/publication

Task 2 must not create a document and chunks separately. Inside its approved-candidate transition, call:

```ts
const published = await knowledge.writeDocument({
  clinicId,
  title,
  content: approvedContent,
  documentType,
  status: 'active',
  doctorId,
  metadata: {
    source: 'governed_learning',
    candidateId,
    retrievalEventId,
    approvedBy,
    approvedAt,
    language,
    provenance,
  },
  chunks: chunkText(approvedContent).map((content, chunkIndex) => ({ content, chunkIndex })),
})
```

`writeDocument` returns `{ document, chunks, retrievalRevision }`. Persist the returned `document.id` and `document.version` on the approved candidate in the same higher-level approval transaction when Task 2 introduces that transaction-capable API. Enqueue only:

```ts
await kbEmbedQueue.add('embed-document', {
  clinicId,
  documentId: published.document.id,
  documentVersion: published.document.version ?? 1,
})
```

If enqueueing fails, call `markDocumentIndexFailed(clinicId, documentId, documentVersion, 'queue_unavailable')`; do not report vector readiness. The approved content is immediately eligible for lexical retrieval because it is approved/current/effective, while `indexingStatus: 'pending'` explicitly signals that vector indexing is incomplete. Worker success changes only that exact current version to `ready`; worker failure changes only that exact current version to `failed` and rethrows for queue retry.

Important boundary: `writeDocument` owns its own DB transaction. For truly atomic candidate-status + document publication, Task 2 should add a repository method that accepts a transaction-scoped `Sql` (or move the approval update and this writer body behind one repository transaction); it must not import from `@docmee/agents` into `@docmee/db`.

## Exact downstream cache contract

1. Read `revision = await knowledge.getClinicRetrievalRevision(clinicId)` before cache lookup.
2. Include it in every retrieval cache key, for example `kb:${clinicId}:r${revision}:${doctorId ?? 'clinic'}:${language ?? 'any'}:<query-hash>`.
3. Cached search rows must retain `documentId`, `documentVersion`, `retrievalRevision`, `source`, `provenance`, `effectiveFrom`, and `effectiveUntil`.
4. Reject a hit if its key revision differs from the current clinic revision. Before publishing a consequential answer, revalidate that each source is still the current approved/effective version; never fall back to a stale revision after a miss/error.
5. `searchChunks(query, [], filters)` is the supported lexical-only form. No doctor selected intentionally excludes doctor-scoped content; a selected doctor includes clinic-wide plus that doctor's content. Requested language changes rank, not eligibility.

## Files

- `packages/db/supabase/migrations/20260920000001_kb_freshness.sql`
- `packages/db/src/repositories/knowledge.repository.ts`
- `packages/db/src/repositories/index.ts`
- `packages/db/src/index.ts`
- `packages/db/src/types/database.ts`
- `packages/db/src/__tests__/knowledge.repository.test.ts`
- `apps/workers/src/kb-embed.worker.ts`
- `apps/workers/src/__tests__/kb-embed.worker.test.ts`
- `apps/api/src/routes/kb.ts`
- `apps/api/src/routes/kb.test.ts`
- `apps/api/src/routes/kb-upload.ts`
- `apps/api/src/routes/kb-upload.test.ts`

## Limitations and operational verification

- Per instruction, no live DB, patient/provider call, push, deployment, or new dependency was used. Docker was unavailable and `psql` was not on `PATH`; migration execution, PostgreSQL/pgvector syntax, planner behavior, and transactional concurrency still require an isolated real PostgreSQL run before deployment.
- GitHub sync now builds the complete source snapshot first, then `replaceSourceDocuments` deletes and recreates the source rows plus bumps one clinic revision inside one transaction. An empty source snapshot removes old evidence and still bumps the revision; a transaction failure leaves the prior snapshot/revision intact. Only current-version document jobs are queued, and queue failures persist `failed` status.
- The legacy `reembed-clinic` worker branch remains compatible, but the governed API retry route now fans out versioned document jobs so readiness/failure is document-visible.
- Full worker-suite date fixtures and Redis availability are environment/baseline concerns, not owned-code failures.
- Execution followed the canonical engineering rule's evidence-first, smallest-compatible-change, and verification boundaries in `Projects/11- RULES/ARTEMIS - Engineering and Code Adoption Rules.md`.

## Commit

Implementation commit: `8a45f21` (`feat(kb): enforce current-version retrieval integrity`). This report is committed separately so it can record that immutable implementation SHA.

## Independent review round 1 fixes

Fix commit: `1b11944` (`fix(kb): close retrieval integrity review gaps`).

- Legacy `listEmbeddedChunks` and `listActiveChunks` now take an optional doctor scope with fail-closed `null` behavior. Assistant conversation grounding passes `metadata.doctorId` only when selected; both J.zel embedded and lexical paths pass explicit `null` or the selected doctor.
- `replaceSourceDocuments` makes GitHub source deletion/replacement/revision invalidation atomic and eliminates direct unversioned chunk jobs.
- Draft/archived writes create inactive chunks with `withdrawn` index state. Draft upload waits for approval instead of embedding inactive chunks. A combined content+archive patch does not enqueue the withdrawn version.
- Worker readiness now additionally requires an active, approved, currently effective document and at least one current active chunk.
- Title/document-type edits increment the clinic retrieval revision transactionally without re-embedding unchanged content.

Round 1 RED evidence:

- DB focused: 3 initial failures for legacy doctor scope, metadata-edit revision, and withdrawn non-active writes; an additional RED proved source replacement was absent.
- Worker focused: 1 failure proved readiness lacked document eligibility/positive chunk existence.
- API focused: 6 failures proved assistant/J.zel omitted scope, draft upload queued, and archived content queued.

Round 1 GREEN evidence:

- `pnpm --filter @docmee/db test` -> **16 files, 67 tests passed**.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` -> **1 file, 5 tests passed**.
- `pnpm --filter @docmee/api test -- src/routes/kb.test.ts src/routes/kb-upload.test.ts src/routes/assistant.test.ts src/routes/jzel.test.ts` -> **4 files, 34 tests passed**.
- DB, workers, and API package typechecks and lints passed; root pre-commit typecheck/lint passed.
- Real PostgreSQL/pgvector execution remains the same explicit environment limitation; the pre-existing full-worker date/Redis caveat is unchanged.

## Independent review round 2 fixes

Fix commit: `e3b068f` (`fix(kb): harden migration and index readiness`).

- The freshness migration no longer relabels uncertain pre-migration chunks with the document's current version or manufactures approval. Every legacy chunk is made inactive; only an authoritative current-content write may create eligible versioned chunks. The SQL fixture assertion specifically protects the document-v2/current-text plus legacy-v1/old-chunk case.
- Migration and worker readiness predicates now use `NOT COALESCE((metadata -> 'embedding') ? 'v', false)`, so absent metadata is missing, a mixed set remains unready, and only a set with no missing current active chunk can become ready.
- `replaceSourceDocuments` now locks the stable owning clinic row before reading/deleting source documents. This serializes concurrent same-clinic replacements even when the first source snapshot is empty; the local mock proves query and transaction ordering, not live database concurrency.

Round 2 RED evidence:

- DB focused: 3 failures proved the migration promoted uncertain legacy chunks, used NULL-unsafe readiness, and lacked a stable lock for an empty first source import.
- Worker focused: 1 failure proved the readiness predicate remained NULL-unsafe for absent embedding metadata.

Round 2 GREEN evidence:

- `pnpm --filter @docmee/db test` -> **17 files, 70 tests passed**.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` -> **1 file, 6 tests passed**.
- `pnpm --filter @docmee/api test -- src/routes/kb.test.ts src/routes/kb-upload.test.ts src/routes/assistant.test.ts src/routes/jzel.test.ts` -> **4 files, 34 tests passed**.
- DB, workers, and API package typechecks and lints passed; root pre-commit typecheck/lint passed.
- PostgreSQL/pgvector migration execution and true concurrent replacement remain unverified because Docker/`psql` were unavailable. The migration test is an explicit SQL artifact assertion, not a claim of database execution. The pre-existing full-worker date/Redis caveat is unchanged.

## Independent review round 3 fixes

Fix commit: `5280a04` (`fix(kb): rebuild current chunks during reindex`).

- `prepareClinicReindex` now locks each eligible approved/current document, withdraws all of its existing chunks, deletes any uncertain same-version rows, and creates new lexical chunks only from the authoritative `knowledge_documents.content`. It sets the rebuilt version to `pending`, returns only queueable `{ id, version }` pairs, and bumps the clinic retrieval revision in the same transaction. Legacy text is never reactivated or relabelled.
- An authoritative document with no indexable content is set to `failed` with `no_indexable_content` and is not returned for queueing. Independently, an `embed-document` job that finds zero current active chunks sets `no_current_active_chunks`, throws, and cannot mark the document ready.
- Retrieval now orders by the existing combined relevance score first and uses requested language only as a tie-break. A bounded candidate pool plus repository-side ordering preserves a relevant cross-language result even when more than 40 irrelevant preferred-language rows exist.
- The API retry regression proves `/kb/reembed` enqueues only the versioned documents returned by the transactional rebuild operation; the route already had the correct boundary and required no production route change.

Round 3 RED evidence:

- `pnpm --filter @docmee/db test -- --run src/__tests__/knowledge.repository.test.ts` initially had **3 failures**: no authoritative chunk rebuild, whitespace-only content was still queueable, and 41 preferred-language irrelevant rows displaced the relevant cross-language answer.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` initially had **1 failure**: a zero-current-chunk document job resolved successfully instead of persisting failure and throwing.
- The focused API route regression was green immediately, characterizing the already-correct queue boundary rather than claiming a RED production defect.

Round 3 GREEN evidence:

- `pnpm --filter @docmee/db test` -> **17 files, 73 tests passed**.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` -> **1 file, 7 tests passed**.
- `pnpm --filter @docmee/api test -- src/routes/kb.test.ts src/routes/kb-upload.test.ts src/routes/assistant.test.ts src/routes/jzel.test.ts` -> **4 files, 35 tests passed**.
- DB, workers, and API package typechecks and lints passed; the implementation commit's root pre-commit typecheck/lint passed; `git diff --check` passed.
- The stateful local repository test simulates an active legacy-v1 old-text chunk, performs the retry rebuild from authoritative v2 content, and then retrieves only v2 text while the legacy row remains inactive. This is mocked transaction/retrieval behavior, not live PostgreSQL proof.

Round 3 operational limit: Docker/`psql` remain unavailable, so PostgreSQL/pgvector execution, planner behavior, and true lock/concurrency semantics remain a deployment gate. The pre-existing full-worker fixed-date and Redis caveat remains unchanged.

## Independent review round 4 fixes

Fix commit: `45cccd1` (`fix(kb): rebuild chunks on activation`).

- `updateDocumentStatus(..., 'active')` no longer reactivates stored rows. Inside the status transaction it withdraws every prior chunk, deletes any uncertain row carrying the current version, and creates new active lexical chunks solely from authoritative `knowledge_documents.content`. Empty authoritative content becomes `failed/no_indexable_content`.
- `approveDraftDocuments` applies the same authoritative rebuild only to documents returned by the `status = 'draft'` update. It no longer runs a clinic-wide update over every active document, so an unrelated active document's withdrawn migration chunk cannot revive.
- The shared transaction-scoped rebuild helper is also used by `prepareClinicReindex`, keeping activation, approval, and retry on one fail-closed origin rule: stored legacy chunk text is never trusted as rebuild input.
- Error Review Add-to-KB now calls `writeDocument` with authoritative lexical chunks, enqueues `{ clinicId, documentId, documentVersion }`, and persists `failed/queue_unavailable` on the exact version if enqueueing fails. The response exposes that failed index state.
- Producer audit: the seven API `embed-document` call sites are GitHub replacement, normal KB create, KB content/status edit, approve-all, reembed, upload, and Error Review Add-to-KB; every emitted job now includes `documentVersion`. The worker's required-version schema therefore receives a source-compatible payload from every repository producer found by `rg -n "embed-document" apps/api/src packages apps/workers/src --glob "*.ts"`.

Round 4 RED evidence:

- `pnpm --filter @docmee/db test -- src/__tests__/knowledge.repository.test.ts` -> **2 expected failures**: direct activation surfaced `legacy old text`, and approve-all surfaced both the intended draft legacy text and an unrelated active document's legacy text.
- `pnpm --filter @docmee/api test -- src/routes/admin.test.ts` -> **2 expected failures**: Add-to-KB returned 500 because the route still called `createDocument`; both the current-version job contract and persisted queue-failure path were absent.

Round 4 GREEN evidence:

- `pnpm --filter @docmee/db test` -> **17 files, 75 tests passed**.
- `pnpm --filter @docmee/workers test -- src/__tests__/kb-embed.worker.test.ts` -> **1 file, 7 tests passed**.
- `pnpm --filter @docmee/api test -- src/routes/admin.test.ts src/routes/kb.test.ts src/routes/kb-upload.test.ts src/routes/assistant.test.ts src/routes/jzel.test.ts` -> **5 files, 47 tests passed**.
- DB, workers, and API package typechecks and lints passed; root pre-commit typecheck/lint passed; `git diff --check` passed.

Round 4 operational limit: the stateful repository regressions model transaction effects but do not execute PostgreSQL. Docker/`psql` remain unavailable, so real PostgreSQL/pgvector migration execution and lock/concurrency behavior remain an isolated pre-deployment gate. The pre-existing full-worker fixed-date and Redis caveat remains unchanged.
