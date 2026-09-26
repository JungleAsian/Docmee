# Claude CLI transport implementation plan

> **Execution:** Implement in `C:\w\guardrails`, which is already an isolated linked worktree on `codex/clinic-guardrails-20260925`. Do not configure a Claude credential or activate the transport.

**Goal:** Let an `ia_studio_admin` select a disabled-by-default, shared Docmee-managed Claude CLI transport for a clinic's staff AI, while preserving tenant isolation and failing closed.

**Architecture:** Extend the existing `ChatProvider` gateway with `claude_cli`. A new process adapter receives only a staff-authorized call with a clinic ID, starts a fresh restricted `claude -p` child process, and keeps global/per-clinic quotas in memory. The API resolver marks only J.zel and workflow wizard calls as staff context; all other paths reject the CLI transport. The existing clinic JSON configuration carries the provider selection, with server and UI superuser gates.

## Task 1: Implement and test the bounded CLI adapter

**Files:**
- Create `packages/llm/src/providers/claude-cli.ts`
- Modify `packages/llm/src/chat.ts`, `packages/llm/src/gateway.ts`
- Create `packages/llm/src/__tests__/claude-cli.test.ts`

**Steps:**
1. Write failing tests for disabled runtime, missing staff context, process flags/stdin, redacted child environment, quota exhaustion, and generic failures.
2. Add `claude_cli` to `ChatProvider`, `DEFAULT_CHAT_MODEL`, and `ChatOpts`; require `clinicId` plus an explicit staff-only flag.
3. Implement the adapter with `spawn`, never a shell. Use bounded timeout/output, static flags, stdin packet, and non-sensitive error codes only.
4. Run the LLM package test suite and typecheck.

## Task 2: Bind the transport only to staff routes

**Files:**
- Modify `apps/api/src/lib/ai-assistant.ts`
- Modify `apps/api/src/routes/jzel.ts`, `apps/api/src/routes/workflows.ts`
- Modify/add tests under `apps/api/src/lib` and `apps/api/src/routes`

**Steps:**
1. Extend normal provider parsing for `claude_cli` without changing the default provider.
2. Skip API-key lookup for the CLI but check runtime availability instead.
3. Pass clinic ID and staff authorization only from J.zel/workflow route resolution.
4. Add a test that unavailable CLI configuration returns the existing safe staff-facing failure rather than using an API credential.
5. Run the API package tests and typecheck.

## Task 3: Enforce per-clinic superuser configuration

**Files:**
- Modify `apps/api/src/routes/clinics.ts` and its tests
- Modify `apps/inboxos/src/shared/aiAssistant.ts`
- Modify `apps/inboxos/src/components/studio/AiAssistantConfigSection.tsx` and tests if present

**Steps:**
1. Recognize the new provider in the shared setting reader.
2. Reject non-superuser patches that select it.
3. Display the provider to superusers and prevent a clinic administrator from modifying a retained CLI selection.
4. Validate InboxOS package tests, typecheck, and build.

## Task 4: Review and publish source safely

**Steps:**
1. Re-read the staged diff, verify no secret/session/token or patient content can be logged, and run `git diff --check`.
2. Run the full tests, lint/typecheck, and build for each touched package at the exact HEAD.
3. Commit with the configured repository identity, push the branch, and verify its upstream matches.
4. Verify AWS identity before any deployment. Deploy only from a non-root deployment role; otherwise report the precise blocker and live build state.