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

## Independent-review remediation — 2026-09-20

Source commit: **`be2583dc053423a991ee15b91b0e5bebefd97c07`** (`fix(kb): close scoped learning evidence and retention gaps`), based on `d145f83`, 12 owned source/test/migration files. This section supersedes the earlier evidence, fingerprint, contradiction, retention, and terminal-outcome descriptions where they differ. No Task 3 UI, dependency, provider, database, browser, push or deployment operations were performed.

### Six corrected boundaries

1. **Current scoped evidence.** `LearningCitation` retains document/chunk/version plus retrieval revision, doctor, language and governance-review state. `LearningEvidence` retains the query doctor/language/revision. Old evidence without these fields fails closed. Source validation repeats the authoritative active/approved/effective/current-chunk/governance/doctor predicate and compares the captured source scope. It runs before generation and before sending a factual answer, and again during publication. Doctor reassignment, exclusion, version/revision change or missing evidence causes handoff/stale-source rejection, including staff-confirmed approval with stale citations. Language fallback remains permitted; all eligible languages are considered for the consistency check.
2. **No singleton truth inference.** A single retrieved source body never establishes `contradiction='clear'`. The repository loads at most 101 current scoped chunks, requiring a complete scope of 1–100 chunks and unchanged revision. A deterministic consistency helper recognizes only atomic opening-time assertions and requires every assertion to agree; intra-chunk disagreement or another current conflicting document blocks publication. Unknown prose, mixed facts or an over-limit scope returns `unknown`, never `clear`.
3. **Positive safe class.** Automatic publication requires `safeContentClass='office_hours'`, verified again from the actual proposed fact rather than trusting the stored class or absence of regex matches. The intentionally narrow grammar accepts only `We open at 9 AM.`, `The clinic opens at 9 AM.`, `Abrimos a las 9 AM.`, or `La clínica abre a las 9 AM.` forms, with a valid 12-hour time and optional minutes. Unknown wording—including English/Spanish medicine instructions and accompaniment/ID policies missed by the older regexes—requires staff review. Other existing gates still apply; confidence must be at least 80%, grounding exactly 1, repeated consistency, current sources, no negative feedback/risk, and the setting enabled. **Automatic publication remains default-off.** This grammar substantially reduces automatic answer coverage: a scope containing normal mixed clinic prose cannot be declared clear by this first conservative verifier. It is not a broad semantic contradiction classifier.
4. **Ephemeral questions versus durable facts.** New migration `20260920000003_kb_learning_evidence_remediation.sql` gives `source_question` an independent maximum 24-hour expiry, scrubs approved/superseded legacy questions, and removes content from their unapproved history snapshots. Approval clears `source_question` immediately and retains only the reviewed generalized `candidateContent` and approve/rollback history content. Pending/edit snapshots retain audit metadata but their content is cleared on publication. General prose requires explicit staff-confirmed edited content (otherwise HTTP 400 `generalized_fact_review_required`); a narrow verified opening-time fact can use the existing review flow. The missed-name/identifier regression demonstrates that question removal does not depend on regex recognition. Existing events/gaps remain temporary and deidentified on a best-effort basis, not comprehensively anonymous. No claim is made about backup/WAL erasure. Task 3 must render `candidateContent` as the durable fact, never repurpose the ephemeral `sourceQuestion`; approved responses have an empty source question.
5. **Version/scope-aware dedupe.** The candidate fingerprint now includes the normalized answer and full sorted citations plus query revision/doctor/language. An unchanged answer from a different source version/scope creates independent evidence rather than incrementing consistency against stale citations. Event-key replay dedupe remains unchanged.
6. **One terminal outcome recorder.** Every AI-agent terminal path converges through a single `finally` recorder: emergency, provider failure, no match, routing, handoff, retrieval/transport failure, and reply. Records remain idempotent by hashed inbound-event/workflow/node key. Provider exceptions are neither logged nor stored as raw text; only fixed reason codes are retained, with empty answers for failure/no-match paths. Publication does not repeat for replayed attempts. Storage outage handling remains best-effort; this is not a transactional outbox or a guarantee of durable telemetry during database failure.

Publication now also locks the existing clinic retrieval-revision row after cited-document locks. Task 1's authoritative writer increments that row before committing, so unrelated edits/new documents cannot commit between a complete-scope consistency check and publication. The writer itself and version-aware embedding queue behavior are unchanged. The candidate carries forward the revision produced by its own approved write so later staff edits/rollback are not invalidated merely by that write; history preserves the original evidence snapshot. Other revision changes still fail closed. PostgreSQL lock ordering/deadlock behavior must be validated with a real database; local tests exercise the SQL contract only.

### RED → GREEN evidence

All commands were run locally from `docmee-live-runtime-fix`; tests use deterministic mocks/fakes, not live PostgreSQL or providers.

| Regression command | RED evidence | GREEN evidence |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run packages/agents/src/__tests__/kb-governance.test.ts --silent` | 10:53:47: 8 failed / 18 passed, including singleton inference and missing positive safe classification | 26/26 passed in final run |
| `node node_modules/vitest/vitest.mjs run packages/db/src/__tests__/knowledge-learning.repository.test.ts --silent` | 10:57:11: 3 failed / 26 passed, exposing missing governance predicate, lost evidence scope and independent question expiry; later 11:06:07 revision-lock regression: 1 failed / 36 passed | 37/37 passed at 11:06:26 and in final run |
| `node node_modules/vitest/vitest.mjs run apps/workers/src/__tests__/workflow-runner-safety.test.ts --silent` | 10:59:08: 10 failed / 28 passed; provider/no-match had zero outcome records and generation checks lacked scope. This run also contained an emergency-notification mock omission and old generic-answer fixtures incompatible with the intentionally stricter verifier; those fixture issues were corrected. | 38/38 passed in final run |

The early agents run also exposed a stale local DB build (new exported helper unavailable); rebuilding DB resolved that environment issue. An initial worker typecheck exposed overly generic `ReturnType` inference for retrieved chunks; explicit `KnowledgeSearchRow` typing resolved it. These are not counted as functional regression demonstrations. Doctor/governance approval cases were additionally exercised in the final SQL contract suite; no live mutation-race proof is claimed.

Final full command, 11:07:31, exit 0, **11 files / 167 tests passed**, 18.26 seconds:

```powershell
node node_modules/vitest/vitest.mjs run packages/db/src/__tests__/knowledge-learning.repository.test.ts packages/db/src/__tests__/knowledge.repository.test.ts packages/db/src/__tests__/sensitive-retention.repository.test.ts packages/agents/src/__tests__/kb-governance.test.ts packages/agents/src/__tests__/kb-retriever.test.ts packages/agents/src/__tests__/kb-hybrid-evaluation.test.ts apps/api/src/routes/kb-learning.test.ts apps/api/src/routes/assistant.test.ts apps/api/src/routes/jzel.test.ts apps/workers/src/__tests__/workflow-runner-ai-agent.test.ts apps/workers/src/__tests__/workflow-runner-safety.test.ts --silent
```

Final compiler checks all exited 0 (completed 11:09):

```powershell
node node_modules/typescript/bin/tsc -p packages/db/tsconfig.json
node node_modules/typescript/bin/tsc -p packages/agents/tsconfig.json
node node_modules/typescript/bin/tsc -p apps/workers/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
```

Scoped ESLint on the eleven changed TypeScript files and `git diff --check` both exited 0. The direct equivalents of the repository pre-commit hook also passed from `tools`:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/tsx/dist/cli.mjs ./node_modules/eslint/bin/eslint.js .
```

The normal commit hook nevertheless failed in its shell wrapper before checks ran, exactly:

```text
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 2: sed: command not found
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 2: dirname: command not found
/c/Users/Mikazuki/nodejs/node-v24.16.0-win-x64/pnpm: line 4: uname: command not found
Error: Cannot find module 'C:\Program Files\Git\node_modules\corepack\dist\pnpm.js'
Typecheck failed. Commit aborted.
```

After the direct equivalent checks passed, the authorized single-command `git -c core.hooksPath=<new empty temporary directory> commit ...` override was used. No persistent hook/configuration change was made, and unrelated untracked artifacts were preserved.

### Remaining gates

Fresh independent remediation review; real PostgreSQL migration and legacy-row scrubbing, RLS/JSONB and transaction/concurrency tests; rollout privacy/retention scheduling and backup policy review; provider-format and bilingual owner evaluations of the deliberately narrow coverage; authenticated Task 3 UI and rollback acceptance; version-aware queue retry/reindex verification. No deployment readiness, model learning, live provider behavior or production database validation is asserted.
