# Governed Shared KB Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give J.zel, workflow AI Agent, and teaching preview one clinic-bound retrieval and answer-safety path with measurable accuracy.

**Architecture:** Add a shared pure retrieval pipeline to `@docmee/agents`, extend the existing PostgreSQL repository for governed metadata and fused inputs, and inject repository/embedding/currentness callbacks from API and worker consumers. Keep fail-closed answer delivery and existing approval/indexing boundaries.

**Tech Stack:** TypeScript, Vitest, PostgreSQL, pgvector, PostgreSQL full-text search, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-25-governed-shared-kb-retrieval.md`

## Global Constraints

- Do not add an external retrieval service or dependency.
- Do not automatically publish learned knowledge or weaken staff approval.
- Do not send real patient or WhatsApp messages during verification.
- Do not modify or deploy `docmee.ai`.
- All patient-facing unsupported, stale, conflicting, or safety-sensitive facts must hand off.
- All retrieval/cache operations must be clinic scoped and revision aware.

---

### Task 1: Shared query plan, ranking, and cache primitives

**Files:**
- Create: `packages/agents/src/botbase/kb-query-plan.ts`
- Create: `packages/agents/src/botbase/kb-retrieval-cache.ts`
- Modify: `packages/agents/src/botbase/kb-retriever.ts`
- Modify: `packages/agents/src/botbase/index.ts`
- Test: `packages/agents/src/__tests__/kb-query-plan.test.ts`
- Test: `packages/agents/src/__tests__/kb-hybrid-evaluation.test.ts`

**Interfaces:**
- Produces `planKbQuery(question, scope): KbQueryPlan`, `fuseKbCandidates(candidates, plan, limit)`, and `createKbRetrievalCache(options)`.
- `KbQueryPlan` includes normalized query, expanded query, language, intent, risk class, doctor ID, and time sensitivity.

- [ ] Write failing tests for deterministic language/intent/risk planning, reciprocal-rank fusion, deduplication, authority/freshness boosts, weak-evidence rejection, and revision-aware cache isolation.
- [ ] Run `pnpm --filter @docmee/agents test -- kb-query-plan.test.ts kb-hybrid-evaluation.test.ts` and confirm failures identify missing interfaces/behavior.
- [ ] Implement the minimal pure functions and bounded cache.
- [ ] Re-run focused tests and refactor only while green.

### Task 2: Governed repository filters, canonical facts, and telemetry

**Files:**
- Modify: `packages/db/src/repositories/knowledge.repository.ts`
- Modify: `packages/db/src/types/knowledge.ts` if present, otherwise the repository-local exported types
- Create: `packages/db/supabase/migrations/20260925000001_kb_retrieval_governance.sql`
- Test: `packages/db/src/__tests__/knowledge.repository.test.ts`

**Interfaces:**
- Extends search rows with semantic rank, lexical rank, authority, canonical fact key, content hash, and conflict state.
- Produces repository methods for retrieval telemetry and canonical-owner conflict inspection.

- [ ] Write failing repository tests asserting approved/current/clinic/doctor/effective-date filters, superseded exclusion, conflicting-owner exclusion, rank fields, and redacted telemetry inserts.
- [ ] Run `pnpm --filter @docmee/db test -- knowledge.repository.test.ts` and confirm expected failures.
- [ ] Add the additive migration and minimal repository implementation.
- [ ] Re-run database tests and typecheck.

### Task 3: Shared evidence-pack retrieval service

**Files:**
- Create: `packages/agents/src/botbase/kb-retrieval-service.ts`
- Modify: `packages/agents/src/botbase/index.ts`
- Test: `packages/agents/src/__tests__/kb-retrieval-service.test.ts`

**Interfaces:**
- Produces `retrieveKbEvidence(request, dependencies): Promise<KbEvidencePack>`.
- Status is `ready | insufficient_evidence | conflicting_sources | stale_sources`; a ready pack contains at most five current citations.

- [ ] Write failing tests for clinic/scope propagation, embedding fallback, cache hits, currentness revalidation, conflicting/weak evidence, telemetry redaction, and bounded results.
- [ ] Run the focused test and confirm it fails for missing service behavior.
- [ ] Implement the service using Task 1 primitives and injected Task 2 repository callbacks.
- [ ] Re-run focused and all agent tests.

### Task 4: J.zel, workflow, and teaching-preview parity

**Files:**
- Modify: `apps/api/src/routes/jzel.ts`
- Modify: `apps/api/src/lib/teaching-preview.ts`
- Modify: `apps/workers/src/workflow-runner.worker.ts`
- Modify: `packages/agents/src/workflows/ai-agent-answer.ts`
- Test: `apps/api/src/routes/jzel.test.ts`
- Test: `apps/api/src/lib/teaching-preview.test.ts`
- Test: `apps/workers/src/__tests__/workflow-runner-safety.test.ts`

**Interfaces:**
- All three consumers call `retrieveKbEvidence` and use its citations/status.
- J.zel uses `aiAgentHandoffReason`-equivalent grounding, source-current, contradiction, confidence, medical, prompt, and privacy gates before returning factual content.

- [ ] Add failing tests proving identical retrieval scope, handoff on stale/conflicting/weak evidence, J.zel post-generation gating, and no factual fallback from model knowledge.
- [ ] Run the three focused suites and observe the expected behavior failures.
- [ ] Replace duplicated retrieval assembly with the shared service and add J.zel parity gates.
- [ ] Re-run focused suites and affected typechecks.

### Task 5: Markdown-aware chunk metadata and incremental reuse

**Files:**
- Modify: `packages/agents/src/botbase/document-trainer.ts` or the active Markdown chunker it delegates to
- Modify: `apps/workers/src/kb-embed.worker.ts`
- Test: `packages/agents/src/__tests__/document-trainer.test.ts`
- Test: `apps/workers/src/__tests__/kb-embed.worker.test.ts`

**Interfaces:**
- Chunks expose heading path, token estimate, content hash, and source span in provenance.
- Re-indexing may reuse a current chunk with the same document version/content hash without changing answer semantics.

- [ ] Write failing tests for heading/table boundaries, 250–600-token target behavior, metadata, stable hashes, and unchanged-content reuse.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the smallest compatible chunking and worker changes.
- [ ] Re-run focused tests and typechecks.

### Task 6: Held-out retrieval and safety evaluation

**Files:**
- Create: `packages/agents/src/__tests__/fixtures/kb-retrieval-eval.ts`
- Create: `packages/agents/src/__tests__/kb-retrieval-eval.test.ts`
- Modify: `packages/agents/package.json` only if a dedicated eval script is needed

**Interfaces:**
- Produces deterministic Recall@5, Precision@5, isolation, stale/conflict, and safety-handoff assertions.

- [ ] Add the fixture corpus and failing threshold tests before tuning.
- [ ] Run `pnpm --filter @docmee/agents test -- kb-retrieval-eval.test.ts` and record the baseline failure.
- [ ] Tune only deterministic planner/ranker constants needed to pass the declared thresholds.
- [ ] Run all agent, DB, API, and worker tests; then typecheck, lint affected packages, and build.

### Task 7: Commit, push, deploy, and verify

**Files:**
- Modify: release/update documentation only when it truthfully describes the completed implementation.

**Interfaces:**
- Produces a pushed Git commit and an AWS `app.docmeedevelopment.dev` build identity matching that commit.

- [ ] Review `git diff`, scan for secrets, and confirm `docmee.ai` is untouched.
- [ ] Commit the verified implementation with a scoped message and push the current branch.
- [ ] Run the repository's AWS deployment workflow for the exact pushed commit.
- [ ] Verify health, login rendering, J.zel/KB route smoke behavior without patient delivery, and live build identity.
- [ ] Report tests, commit, push, deployment identity, limits, execution state, and owner-review state separately.
