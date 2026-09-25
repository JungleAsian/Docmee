# Governed shared KB retrieval

## Objective contract

Objective: make J.zel, the workflow AI Agent, and the teaching preview retrieve clinic knowledge through one accurate, efficient, clinic-bound, fail-closed path so patients receive only current, supported answers.

Scope: shared retrieval contract; deterministic query planning; semantic and lexical candidate fusion; authority, scope, freshness, and language ranking; revision-aware bounded caching; canonical fact ownership and conflict exclusion; source-current and answer-grounding gates for J.zel; retrieval telemetry; Markdown-aware chunk metadata; and a held-out evaluation suite.

Non-goals: no external vector database, no new network service, no model fine-tuning, no automatic publication of learned knowledge, no weakening of staff approval, no live patient messages during verification, and no changes to `docmee.ai`.

Constraints and dependencies: retain PostgreSQL, pgvector, full-text search, current clinic AI settings, existing approval/indexing flows, and existing provider selection. Patient-facing medical, pricing, policy, privacy-sensitive, stale, conflicting, low-confidence, or unsupported answers must hand off. All cache keys must include clinic and retrieval revision. Imported source files remain normalized to Markdown under the existing ingestion policy.

Acceptance evidence: focused agent, database, API, and worker tests pass; cross-clinic and wrong-doctor results are impossible through the shared contract; superseded, expired, excluded, unapproved, or conflicted knowledge is not returned; J.zel and workflow AI use the same retrieval result and safety decision types; evaluation fixtures meet the checked-in thresholds; type checks and builds pass; the published AWS build reports the exact pushed commit.

Gates and decision owner: Patrick authorized implementation, commit, push, and publication to `app.docmeedevelopment.dev`. Automatic KB approval remains default-off and separately governed. `docmee.ai` and real patient/WhatsApp testing are outside this authorization.

Stop condition: complete when source, tests, push, AWS deployment, build identity, and safe smoke checks are verified; otherwise report the exact partial or blocked criterion.

## Design

### Shared retrieval contract

Add a focused retrieval module in `@docmee/agents`. It accepts a clinic-scoped request plus repository callbacks and returns a structured evidence pack: planned query, ranked matches, citations, revision, latency, conflict/currentness state, and a bounded status (`ready`, `insufficient_evidence`, `conflicting_sources`, or `stale_sources`). J.zel, the workflow runner, and teaching preview must consume this contract rather than assembling retrieval independently.

The module remains infrastructure-agnostic: the API and worker provide embedding, repository search, currentness, and optional telemetry callbacks. This avoids a new service while eliminating policy drift.

### Query planning and ranking

The deterministic planner normalizes the question and derives language, intent, risk class, doctor scope, and time sensitivity without using an LLM. The repository continues to enforce clinic, approval, active version, effective dates, doctor scope, and governance state.

Ranking uses reciprocal-rank fusion over semantic and lexical rank positions, then small bounded boosts for scope match, preferred language, authority, freshness, and current document version. Weak candidates remain excluded. Results are deduplicated by normalized content/source identity and limited to five evidence chunks.

### Canonical facts and conflicts

Knowledge metadata may carry `canonicalFactKey`, `authority`, and `contentHash`. When a new approved entry owns the same clinic/scope/fact key, older owners become superseded and their chunks cannot be retrieved. Multiple current owners with materially different content are marked conflicted and excluded from patient answers until staff resolves them. Existing entries without a key continue to work; this is an additive migration.

### Chunking and indexing

Markdown ingestion preserves heading paths and table rows, targets 250–600-token chunks, avoids splitting a heading from its content, and stores heading path, content hash, token estimate, and source span in chunk metadata. Unchanged content hashes can be reused during re-indexing. The implementation must not retain the original non-Markdown upload.

### Cache and telemetry

Use a bounded in-process cache shared by each runtime. Keys include clinic ID, retrieval revision, normalized query, language, doctor ID, and relevant planner filters. Revision changes make old entries unreachable without broad invalidation. Cache TTL remains short (30 seconds) and size bounded.

Telemetry records retrieval status, candidate/match counts, latency, cache hit, filters, and cited IDs without storing raw patient questions or answer text in retrieval logs. Existing governed learning records continue to store the authorized evidence needed for review.

### Patient-answer gates

J.zel receives the same pre/post-generation checks as the workflow AI Agent: current sources before and after generation, complete grounding, clear contradiction state, confidence at least 0.80, prompt/privacy screening, and medical safety screening. Failure produces a bounded staff-handoff response and never a best-effort factual answer.

### Evaluation

Check in a deterministic retrieval corpus covering English/Spanish, doctor scope, exact keyword, paraphrase, stale versions, expiration, canonical replacement, conflict, weak evidence, prompt injection, and cross-clinic isolation. Required thresholds are Recall@5 at least 0.90, Precision@5 at least 0.85, zero cross-clinic leakage, zero superseded/expired retrieval, zero unsupported safety-sensitive delivery, and 100% handoff for insufficient/conflicting evidence. Latency is instrumented; the production target is p95 under 300 ms excluding the LLM, but a local fixture cannot claim production latency.

## Failure behavior

Repository, embedding, cache, telemetry, or provider errors never expose exception details to patients. Embedding failure may use bounded lexical retrieval; repository/currentness failure hands off. Telemetry failure does not permit an otherwise blocked answer. No result, weak evidence, stale sources, or conflicts all fail closed.

