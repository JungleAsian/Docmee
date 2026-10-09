# Any words workflow trigger verification

Date: 2026-10-08

## Scope and behavior

- Message Keyword token `any words` matches any non-empty inbound text, after existing keyword normalization.
- Blank or missing text does not match this explicit token.
- Other keywords retain literal substring matching; legacy empty keyword lists retain their previous behavior.
- The engine follows the trigger's outgoing edge to the connected menu.
- Pending replies retain their pinned workflow revision and resume node instead of restarting a fresh workflow.
- Existing clinic scope, opt-out, staff and business-hours gates remain unchanged.

## Task-owned source

- `apps/workers/src/workflow-run.ts`
- `apps/workers/src/__tests__/workflow-run.test.ts`

Local base: `32e2989f6a8ad4097e2f5d3a5ab5ce44626569a3`, branch `codex/sidebar-overflow-20261002`.
The checkout contains unrelated dirty work. Do not include that work implicitly in this release.

## Verification

1. RED: temporarily removed only the wildcard implementation line. The workflow-run suite reported six expected failures out of 33 tests. Restored the line immediately.
2. GREEN: installed Vitest ran workflow-run, conversation-processor.worker, workflow-runner-safety, workflow-runner-dynamic-menu, and agent workflow-engine suites. All five files and 171 tests passed.
3. The enqueue test invokes the actual workflow engine, with external executors mocked: trace `t -> m`, one menu send, then pause.
4. `tsc --noEmit -p apps/workers/tsconfig.json` passed with no diagnostics.
5. `git diff --check` passed.

Some worker tests emitted localhost Redis connection warnings. These tests are not proof of a working live Redis service or WhatsApp delivery.

## Release and acceptance state

- Local source checks: passed.
- Commit / push: not performed for this fix.
- Deployment: not performed.
- Live workflow proof: pending.
- AWS profile configuration points to `DocmeeDeployOperator`, source `support-profile`, region `mx-central-1`. The fresh STS identity check produced no result and was stopped; no deployment identity has been verified.
- Execution complete: local implementation and verification only; live resolution pending.
- Owner accepted: pending.

## Safe continuation

Verify a fresh non-root deployment identity without exposing credentials. Read the safe release procedure, isolate this fix from unrelated changes, compare against the currently serving release, then publish the worker through the existing safe release path. Verify the running worker contains the change; a frontend health build ID alone is insufficient. Do not alter production workflow records, reset pending runs, contact patients, change AI/KB settings, or change `docmee.ai` without separate authorization. An older pinned conversation revision may still differ from the currently displayed workflow.
