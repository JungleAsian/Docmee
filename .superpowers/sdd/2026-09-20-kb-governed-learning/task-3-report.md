# Task 3 — clinic-scoped staff review UI

Date: 2026-09-20. Source commit: **`c05d5868eabe0d26f5e5fd22e8a1773ddad4af23`** (`feat(kb): add clinic-scoped governed learning review workspace`).

## Scope and implemented behavior

- Added `KbLearningPanel.tsx` within the existing Admin Studio KB page, plus typed EN/ES copy, API records and review helpers in `shared/kbLearning.ts`. Candidates, observed answer feedback, knowledge gaps and settings each use an explicit clinic-scoped endpoint/query key. Recent lists are bounded to the API limits (50 candidates; 100 events/gaps/history rows), with scrollable text/evidence. React text rendering is used throughout; generated content is not injected as HTML.
- The KB page now permits only `ia_studio_admin` or a `clinic_admin` assigned to the selected clinic. Its existing layout already permits those roles, and the server independently authorizes every endpoint. Removed only the clinic-admin KB navigation disabled flag; did not alter backend authorization or unrelated navigation. The clinic selector remains studio-admin-only under the existing active-clinic hook.
- The workspace is keyed by user identity, role and clinic, resetting form/selection/confirmation state when those change. Review command values capture clinic, current candidate ID and expected revision. Query/mutation caches for temporary learning evidence are not persisted, use zero garbage-collection delay, and learning writes have no automatic retry. Failed/stale/expired actions close/reset review forms, invalidate scoped records and require another deliberate review. Poll/focus refresh and click-time expiry checks add freshness; the server remains authoritative.
- Candidate inspection separately presents retrieval relevance, answer confidence, grounding, contradiction result, safety risk flags, recorded medical/prompt checks, observed feedback, consistency and automatic gate reasons. Missing/invalid measurements are not rendered as measured zero. Citations identify chunk/document/version/retrieval revision and scope; matching current document text can be inspected. Unavailable/current-version-mismatched sources prevent ordinary approval in the UI, with server revalidation still mandatory.
- Approval requires explicit exact-content/source-version confirmation, including resolution of conflicts, privacy removal and clinical/pricing/policy verification where applicable. A staff correction can be drafted from a gap only after explicit independent confirmation. Feedback must be deliberately selected; silence is not represented as acceptance. No client-side medical or contradiction bypass was added.
- Approved-content edit responses select/refetch the **returned new draft candidate ID**, not the original publication. Rejected/superseded records are read-only; pending drafts without valid unexpired deadlines fail closed. Current-candidate history is bounded and restore actions submit an approved/rollback history ID against the **current candidate ID and expected revision**. The UI deliberately does **not** load or claim multi-generation ancestor rollback; its copy states this limitation.
- Settings display the actual server value; automatic publication is off when the server says off and is never enabled by loading the screen. Saving is explicit. Copy describes the narrow eligible office-opening facts, confidence >=80%, full grounding, repeated consistency/current sources and safety gates; medical/pricing/policy/conflicts/corrections/unknown content require staff review. The configurable grounding setting does not relax the server's hard 100% automatic-publication grounding gate. Retention is bounded to 1–24 hours.
- Publication responses distinguish committed content with queued indexing, committed content with failed indexing, and non-publication edits. KB document rows separate current approved lexical eligibility from vector indexing, including failed/withdrawn states, version/approval time and governed-learning provenance. Pending vector indexing is not shown as trained merely because old counts appear complete. Added only optional document freshness/indexing fields and provenance typing to `KnowledgeDocument`.

No automatic-publication default, provider calls, database schema, live records, credentials, deployment or pushes were changed. Unrelated untracked artifacts were preserved. The offline build created an untracked `apps/inboxos/.next-build/` output directory; it is not part of either commit.

## Local verification

Focused regression sequence:

1. Initial new helper tests at 11:57:44 produced **2 failed / 19 passed**: mutation of rejected/superseded candidates and pending-vector state incorrectly labeled trained. Both were corrected.
2. A rollback snapshot-filter test at 12:02:45 failed before the helper existed (**1 failed / 24 passed**); implementing bounded current-candidate approved/rollback snapshot filtering made it pass.
3. Additional lifecycle/deadline tests at 12:09:18 produced **2 failed / 6 passed** in the helper file: missing pending expiry and action/status mismatch. Both were corrected.
4. Final focused run at **12:09:36**: **3 files / 28 tests passed**, exit 0. Coverage includes permitted roles/clinics, captured candidate/revision, stale/expired/missing deadlines, confirmation, lifecycle restrictions, measured-vs-unknown scores, bounded rollback snapshots, lexical eligibility while vector indexing is pending/failed, source provenance, EN/ES static rendering, generated-text escaping, separate clinic query caches, bounded candidate rendering and default-off settings.

Command from `apps/inboxos`:

```powershell
node ../../node_modules/vitest/vitest.mjs run src/shared/kbLearning.test.ts src/shared/kbTraining.test.ts 'src/app/(admin)/studio/kb/KbLearningPanel.test.tsx'
```

The first sandboxed test invocation could not traverse an ancestor directory used by esbuild; the local-only test command ran successfully with the approved filesystem escalation. No provider/network calls were made by these tests.

Final checks, all exit 0:

```powershell
# Repository root
node node_modules/typescript/bin/tsc -p apps/inboxos/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js 'apps/inboxos/src/app/(admin)/studio/kb/KbLearningPanel.tsx' 'apps/inboxos/src/app/(admin)/studio/kb/KbLearningPanel.test.tsx' 'apps/inboxos/src/app/(admin)/studio/kb/page.tsx' apps/inboxos/src/shared/kbLearning.ts apps/inboxos/src/shared/kbLearning.test.ts apps/inboxos/src/shared/kbTraining.ts apps/inboxos/src/shared/kbTraining.test.ts apps/inboxos/src/shared/types.ts 'apps/inboxos/src/app/(admin)/layout.tsx'
git diff --check
# apps/inboxos
node scripts/check-i18n-keys.mjs
```

The existing i18n checker verified **2,143 ES / 2,143 EN keys** and direct usages; new bounded UI copy is a typed local EN/ES object, additionally covered by static rendering. A compiler run started while the snapshot helper was absent reported missing-export errors; subsequent full compiler checks after implementation passed.

Direct hook equivalents from `tools`, both exit 0:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
node node_modules/tsx/dist/cli.mjs ./node_modules/eslint/bin/eslint.js .
```

The ordinary source commit then reproduced the existing Windows hook-wrapper failure: missing `sed`, `dirname`, `uname`, and Corepack module under `C:\Program Files\Git`, ending `Typecheck failed. Commit aborted.` After the direct checks, the parent-authorized ephemeral `git -c core.hooksPath=<new empty temporary directory> commit ...` succeeded. No persistent hook setting changed.

## Offline build limitation

The parent authorized only an offline/sandboxed build, consistent with the no-network boundary. From `apps/inboxos`:

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:NEXT_DIST_DIR='.next-build'
$env:HTTP_PROXY='http://127.0.0.1:9'
$env:HTTPS_PROXY='http://127.0.0.1:9'
$env:ALL_PROXY='http://127.0.0.1:9'
$env:NO_PROXY=''
node node_modules/next/dist/bin/next build
```

Next.js 15.5.19 reached production compilation, then exited 1: `next/font` in the existing `src/app/layout.tsx` could not fetch **Inter** and **Manrope** from Google Fonts (`ECONNREFUSED 127.0.0.1:9`). No font download, package installation or network enablement was attempted. An initial invocation using the root Next path failed `MODULE_NOT_FOUND`; the corrected app-local path produced the font result above. **Production build is not verified.** The project build configuration skips TypeScript errors, so the separately passing compiler is the actual type-check evidence.

## Remaining acceptance gates

- Fresh independent source review is required. These deterministic helper/static-render checks do not prove browser interactions, hydration, accessibility, responsive layout, authenticated role behavior or in-flight request races.
- In an authorized authenticated local/test environment, verify clinic switch and identity switch during loading/mutations; expired/source-edited/409 candidate handling; explicit feedback/corrections; default-off settings save; approved edit returning a new ID; current-candidate rollback; and committed publication with failed indexing. Verify old forms/confirmations never carry across clinics and server errors require re-review. Full ancestor-history rollback remains outside this UI's claimed support.
- Complete a build with an approved offline font cache/local-font setup or separately authorized dependency access. No live build/deployment readiness is claimed here.
- Task 2's real PostgreSQL migration, concurrency/locking/RLS/cleanup/indexing acceptance gates remain open. Retrieval/provider quality, clinical accuracy, retention scheduling/backups/privacy and clinic-owner acceptance are not established by this UI work.

This report asserts bounded source and local-test readiness only, not production readiness or publication.
