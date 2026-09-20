# Task 2: governed KB learning, evidence and runtime integration

Status: DONE_WITH_CONCERNS — local source and focused verification; not deployment readiness.

## Scope and outcome

- Clinic-scoped settings, temporary learning events/gaps, deduplicated pending candidates, explicit staff feedback/correction, review/edit/reject/approve/history/rollback APIs.
- Independent retrieval relevance, model answer confidence, extractive grounding, contradiction state, risk flags and patient-feedback fields. Confidence is not copied from similarity. Missing/invalid confidence cannot authorize an answer or publication.
- Runtime auto-approval defaults off and is read/rechecked by the actual worker and publication transaction. Automatic publication requires confidence >= .8, grounding exactly 1, clear evidence, two distinct events, no negative feedback, current sources, and no medical/pricing/policy/injection/privacy risk. Staff-edited candidates cannot auto-publish.
- Reranking preserves the selected chunk/document/version fields, excludes malformed relevance, uses version and timestamp tie-breaking, and caps final evidence at five chunks. Small audited EN/ES vocabulary expands synonyms and one-edit misspellings using PostgreSQL websearch OR semantics. No new provider or dependency.
- Worker query cache includes the Task 1 clinic revision and language/doctor scope; sources are revalidated before provider use and after generation. Staff assistant/J.zel retrieval now also uses bounded current PostgreSQL candidates rather than loading every clinic chunk.
- Publication uses the Task 1 authoritative writer inside the same review transaction; new version/chunks/retrieval revision/audit are atomic. Source clinic/doctor/language scope is preserved, mixed scopes are rejected. Index queue data always identifies the committed version.
- No deploy, push, real database/provider calls, credentials, patient messages, or docmee.ai changes.

## RED to GREEN evidence

Commands use the existing local Node dependencies because `pnpm exec vitest` was not executable in this shell. All paths below are relative to `docmee-live-runtime-fix`.

1. `node node_modules/vitest/vitest.mjs run packages/agents/src/__tests__/kb-governance.test.ts`
   - 10:08:59 RED: 15 failures, 1 passing, proving missing independent evidence/gates.
   - 10:09:53 GREEN: 16 passing.
   - 10:33:40 RED: added OR-expansion and NaN/timestamp checks failed (2 failures, 16 passing).
   - 10:34:38 GREEN: 18 passing after retrieval fixes.
   - 10:38:17 RED: partial grounding at a configured .8 threshold incorrectly allowed automatic approval.
   - 10:39:02 GREEN: all 18 passing; automatic publication always requires full grounding even when candidate creation uses a lower configured threshold.
2. `node node_modules/vitest/vitest.mjs run packages/db/src/__tests__/knowledge-learning.repository.test.ts`
   - 10:12:21 RED: missing implementation module.
   - 10:14:11 GREEN: initial seven tests passing.
   - 10:23:52 RED: three new transaction/gate/feedback checks failed; 10:24:53 GREEN: 11 passing.
   - 10:28:12 RED: scoped gap correction and approved-edit history tests failed; 10:28:53 GREEN: 13 passing.
   - Expanded publication matrix/rollback/serialized concurrency coverage: 23 passing in final run.
3. `node node_modules/vitest/vitest.mjs run packages/db/src/__tests__/sensitive-retention.repository.test.ts`
   - 10:16:25 RED: cleanup queries absent; 10:17:50 GREEN after retention integration.
4. `node node_modules/vitest/vitest.mjs run apps/api/src/routes/assistant.test.ts apps/api/src/routes/jzel.test.ts`
   - 10:29:27 RED: 4 failures, 8 passing after mocks removed legacy whole-clinic loaders.
   - 10:32:46 GREEN: 12 passing using current bounded retrieval.
5. `node node_modules/vitest/vitest.mjs run apps/workers/src/__tests__/workflow-runner-safety.test.ts -t 'separate inbound'`
   - 10:38:45 RED: different patient messages reused one learning evidence key.
   - 10:38:59 GREEN: distinct inbound WhatsApp IDs differ; retried message retains its key.

Final focused command (10:39:59):

```powershell
node node_modules/vitest/vitest.mjs run packages/db/src/__tests__/knowledge-learning.repository.test.ts packages/db/src/__tests__/knowledge.repository.test.ts packages/db/src/__tests__/sensitive-retention.repository.test.ts packages/agents/src/__tests__/kb-governance.test.ts packages/agents/src/__tests__/kb-retriever.test.ts packages/agents/src/__tests__/kb-hybrid-evaluation.test.ts apps/api/src/routes/kb-learning.test.ts apps/api/src/routes/assistant.test.ts apps/api/src/routes/jzel.test.ts apps/workers/src/__tests__/workflow-runner-ai-agent.test.ts apps/workers/src/__tests__/workflow-runner-safety.test.ts --silent
```

Result: **11 files, 139 tests passed**. The SQL tests use an in-memory tagged-SQL fake, not live PostgreSQL. Serialized concurrency is a contract test, not proof of PostgreSQL locking behavior. Provider/queue calls are mocked. The worker's existing timeout test intentionally exercises/logs its error path. Its pre-existing September 15 booking fixtures now use a deterministic September 10 clock; no booking behavior was changed for that fixture repair.

Typechecks: `node node_modules/typescript/bin/tsc -p <path>/tsconfig.json --noEmit` passed for `apps/api`, `apps/workers`, `packages/agents`, and `packages/db`. API typecheck initially caught two optional doctor-ID nulls and one test header type; these were corrected before the passing run. Scoped ESLint using `node node_modules/eslint/bin/eslint.js` over the 20 owned TypeScript files passed. `git diff --check` passed. No full-repository build, browser acceptance, or live integration test is claimed.

The repository pre-commit hook initially failed before running its checks (a process-local PATH repair also failed):

```text
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 2: sed: command not found
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 2: dirname: command not found
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 4: uname: command not found
Error: Cannot find module 'C:\Program Files\Git\node_modules\corepack\dist\pnpm.js'
Typecheck failed. Commit aborted.
```

Its exact checks were then run from `tools/` using the existing local executables: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and `node node_modules/tsx/dist/cli.mjs ./node_modules/eslint/bin/eslint.js .`; both exited 0. With explicit parent approval, the scoped local commits used a one-command `git -c core.hooksPath=<empty temporary directory> commit` override. No persistent Git configuration was changed and no check was omitted.

## Exact Task 3 API contract

All endpoints use the existing API prefix plus `/clinics/:id/kb/learning`. Authentication and role authorization are server-side: **clinic_admin or ia_studio_admin only**, with `resolveClinicScope(request, id)`. Secretaries/doctors cannot review via this first release. Actor identity is always the authenticated user; bodies cannot supply `actorId` or `automatic`.

| Method / suffix | Request | Response |
| --- | --- | --- |
| GET `/candidates?status=pending_review` | status: pending_review, approved, rejected, superseded | `GovernedCandidate[]`, default 50, bounded 100, unexpired |
| GET `/settings` | none | `LearningSettings` |
| PUT `/settings` | exact `LearningSettings` | saved settings |
| GET `/events` | none | most recent 100 unexpired events |
| GET `/gaps` | none | up to 100 unexpired gaps |
| POST `/gaps/:gapId/resolve` | none | `{ok:true}` |
| POST `/gaps/:gapId/candidate` | `{content:string, staffConfirmed:true}` | pending `GovernedCandidate`; never publishes directly |
| POST `/events/:eventId/feedback` | `{feedback:'accepted'|'corrected'|'escalated'}` | `{ok:true}` |
| GET `/candidates/:candidateId/history` | none | `LearningHistory[]`, newest revision first, max 100 |
| POST `/candidates/:candidateId/review` | exact review body below | `{candidate:GovernedCandidate, indexing:'queued'|'failed'|'unchanged'}` |

```ts
type LearningSettings = {
  autoApprove: boolean // default false
  groundingThreshold: number // .8..1, default 1; candidate admission only
  evidenceRetentionHours: number // integer 1..24, default 24
}
type LearningCitation = { chunkId: string; documentId: string; documentVersion: number }
type LearningEvidence = {
  relevance: number | null
  confidence: number | null
  grounding: number | null
  contradiction: 'unknown' | 'clear' | 'conflict'
  risks: string[]
}
type GovernedCandidate = {
  id: string; clinicId: string; retrievalEventId: string | null
  sourceQuestion: string; candidateContent: string
  status: 'pending_review' | 'approved' | 'rejected' | 'superseded'
  confidenceScore: number; groundingScore: number
  medicalSafetyOk: boolean; promptSafetyOk: boolean; contradictionFree: boolean
  consistencyCount: number; patientFeedback: 'unknown'|'accepted'|'corrected'|'escalated'
  humanEdit: string|null; approvedBy: string|null; approvedAt: string|null
  sourceDocumentId: string|null; sourceDocumentVersion: number|null; previousVersionId: string|null
  supportingChunks: LearningCitation[]; originalSource: Record<string,unknown>
  createdAt: string; updatedAt: string
  revision: number; fingerprint: string; evidence: LearningEvidence
  expiresAt: string|null; publishedDocumentId: string|null; publishedDocumentVersion: number|null
  staffConfirmed: boolean; gateReasons?: string[]
}
type ReviewBody = {
  action: 'edit'|'reject'|'approve'|'rollback'
  expectedRevision: number // positive integer from the latest candidate
  content?: string // nonempty, maximum 12000 chars
  staffConfirmed?: boolean // explicit factual correction confirmation
  historyId?: string // UUID; required with staffConfirmed:true for rollback
}
type LearningHistory = {
  id: string; candidateId: string; revision: number; action: string; actorId: string|null
  content: string; citations: LearningCitation[]; evidence: Record<string,unknown>
  documentId: string|null; documentVersion: number|null; createdAt: string
}
```

Candidate list `gateReasons` is computed against the current clinic setting/current source versions. Review/gap-correction responses may omit it; refetch the list after mutations. Event fields: `id, candidateId, question, answer, citations, evidence, feedback, handoffReason, createdAt`. Gap fields: `id, clinicId, fingerprint, question, reason, occurrences, status:'open'|'resolved', createdAt, updatedAt, expiresAt`. Database timestamp values serialize as ISO strings. Scores on candidate listings are normalized to numbers.

Gate reasons include `automatic_publication_disabled`, `stale_or_missing_sources`, `confidence_below_80_percent`, `not_fully_grounded`, `contradiction_not_clear`, `risk_unknown`, `safety_review_required`, `repeat_consistency_required`, `patient_corrected`, `patient_escalated`, `staff_review_required`, and risk values `medical`, `pricing_or_policy`, `prompt_injection`, `privacy`, `staff_correction`.

HTTP errors: 401/403 auth/scope; 400 schema/invalid_status/content_required/remove_private_information/rollback_confirmation_required/invalid_settings; 404 not_found; 409 stale_candidate/stale_sources/expired_candidate/invalid_state/automatic_gates_failed/mixed_source_scope; 500 generic learning_operation_failed. On 409 refetch candidate/history and require a new deliberate decision, not a blind retry. Approve retry at the immediately committed revision returns the existing publication and can repair an interrupted enqueue. Rollback republishes historical content as a new document version; it does not destroy history. The first release does not automatically mark another candidate `superseded`; existing superseded entries are listable, and document version withdrawal is authoritative.

## Transaction and queue boundary

New source-compatible seam in Task 1 repository, exported through DB index:

```ts
writeKnowledgeDocument(tx: TxSql, data: WriteDocumentInput): Promise<DocumentIndexWrite>
createKnowledgeRepository(sql: Sql, transaction?: TxSql): KnowledgeRepository
```

The seam uses the same writer body directly on the supplied transaction; it does not open a nested transaction. Review serializes on the clinic row, locks the candidate and cited documents, validates expected revision/current evidence, writes the approved document/chunks/retrieval revision, updates candidate and inserts history before commit. Feedback takes the same clinic lock so it cannot interleave with the approval snapshot. Queueing happens after commit:

`kbEmbedQueue.add('embed-document', {clinicId, documentId, documentVersion})`.

Queue failure marks that exact version `failed` with `queue_unavailable`. The API supports an idempotent approve retry to enqueue it again; Task 1's existing reindex/retry path is also available. A process crash after auto-approval commit and before enqueue requires that existing retry/reindex path; no transactional outbox was added.

## Privacy, retention and conservative runtime behavior

- Events retain bounded redacted question/answer text, IDs/version citations, scores, feedback and handoff reason. Obvious emails, phone strings, self-introduced names, and URLs are masked before event/candidate/gap storage. Privacy-risk evidence cannot auto-publish. Raw event keys are SHA-256 hashed; candidate fingerprints normalize answer text and source-document IDs. Distinct incoming WhatsApp IDs count separately; replayed IDs do not increment evidence during the retention window.
- This regex redaction is **not comprehensive anonymization**. Medical narratives, unlabelled names, unusual identifiers and source text need owner/privacy review before rollout. No plaintext patient conversation transcript is copied into a durable learning-history column.
- Existing sensitive cleanup invokes learning cleanup: expired events and gaps are deleted, expired pending/rejected candidates cascade their temporary history. Default 24-hour expiry can only be shortened to 1–24 hours. Retrieval lists exclude expired records even before the worker purge runs.
- Approval sets candidate expiry NULL and snapshots deidentified content, source-version citations, actor, feedback/consistency/staff confirmation and timestamp into history. Approved candidate edits keep that durable expiry and old publication until a new approval. Approved knowledge/history survives temporary event deletion. Migration preserves expiry NULL for pre-existing approved/superseded candidates. Retention does not promise immediate byte erasure from backups/WAL or RAM encryption.
- The deterministic verifier (`extractive-v1`) demands exact normalized source sentences. Distinct source texts produce contradiction `unknown`, even if a human would consider them compatible. It is not a semantic contradiction detector or proof against every unselected clinic document. Unsupported paraphrases, missing/NaN confidence, stale evidence and unknown conflicts hand off. This may reduce answer coverage; it is an intentional fail-closed release boundary requiring owner evaluation.
- Feedback is explicit staff-recorded evidence, not inferred patient sentiment. Acceptance never establishes truth; corrected/escalated feedback remains sticky for pending-candidate gates. Staff gap corrections require explicit confirmation and a separate review approval.

## Changed files and remaining gates

Source commit: **`beeb9dc`** (`feat(kb): govern learning review and grounded runtime publication`), 21 files. This report is committed separately.

Changed source files:

```text
apps/api/src/app.ts
apps/api/src/routes/assistant.ts
apps/api/src/routes/assistant.test.ts
apps/api/src/routes/jzel.ts
apps/api/src/routes/jzel.test.ts
apps/api/src/routes/kb-learning.ts
apps/api/src/routes/kb-learning.test.ts
apps/workers/src/workflow-runner.worker.ts
apps/workers/src/__tests__/workflow-runner-ai-agent.test.ts
apps/workers/src/__tests__/workflow-runner-safety.test.ts
packages/agents/src/botbase/index.ts
packages/agents/src/botbase/kb-learning.ts
packages/agents/src/botbase/kb-retriever.ts
packages/agents/src/__tests__/kb-governance.test.ts
packages/db/src/index.ts
packages/db/src/repositories/knowledge.repository.ts
packages/db/src/repositories/knowledge-learning.repository.ts
packages/db/src/repositories/sensitive-retention.repository.ts
packages/db/src/__tests__/knowledge-learning.repository.test.ts
packages/db/src/__tests__/sensitive-retention.repository.test.ts
packages/db/supabase/migrations/20260920000002_kb_learning_governance.sql
```

Before release: independent Task 2 review; real PostgreSQL migration/RLS/JSONB upsert and locking/concurrency tests; rollback/source-scope acceptance; query-plan/performance and bilingual retrieval quality evaluation; authenticated Task 3 UI tests; provider-format behavior and handoff coverage; retention-worker scheduling/backups/privacy review; clinic-owner acceptance of conservative grounding and manual review roles. Automatic publication should remain off until these gates are signed off. No deployment readiness is asserted.
