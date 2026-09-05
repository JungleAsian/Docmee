# Docmee Glassmorphism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Apply the approved restrained glass standard across Docmee without changing application behavior.

**Architecture:** Extend existing semantic CSS tokens and known surface selectors. Keep dense content opaque and enable blur only as progressive enhancement on outer surfaces; retain the existing theme provider and DOM behavior.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 3, CSS custom properties, Vitest 2, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-09-05-docmee-glassmorphism-design.md`

## Global Constraints

- Support existing light and dark themes.
- Existing uncommitted simulation, Drive, and integration-layout work must remain intact.
- Never apply container opacity to achieve translucency: text, icons, focus outlines, and status colors remain fully opaque.
- No live deployment is part of this specification.
- Do not add dependencies or change API, authentication, workflow, or provider behavior.
- Follow the objective contract in the spec. Stop on unsafe overlap or a need for credentials/external actions.
- Commit only scoped changes if separately authorized; never stage the whole dirty checkout. This follows the canonical Engineering and Code Adoption Rules requirement to use commits when in scope.

## File responsibilities and baseline

- Modify `apps/inboxos/src/app/globals.css`: token values, surface roles, fallback media rules. It already owns all-page styling; avoid adding another cascade file.
- Create `apps/inboxos/src/shared/glassTheme.test.ts`: source-level contract regression tests, explicitly not visual proof.
- Modify route/component class names only where the route inventory proves shared styling is bypassed. First inspect `apps/inboxos/src/app/login/page.tsx`, `(clinic)/layout.tsx`, `(admin)/layout.tsx`, and `shared/components/ConfirmDialog.tsx`.
- Append route and visual evidence to this plan; do not create a new UI subsystem or persistent test route.

Existing globals include repeated theme token blocks near lines 1338–1455 and shell `!important` surface overrides near line 3223. Update their actual owning declarations; an early token change alone is insufficient. Login already has `docmee-auth-shell` and `docmee-auth-card` hooks.

## Task 1: Shared tokens and fallback contract

**Interfaces:** Consumes existing `--crm-*` colors. Produces `--crm-glass-fill`, `--crm-glass-strong-fill`, `--crm-glass-solid`, `--crm-glass-border`, `--crm-glass-shadow`, and `--crm-glass-blur` in both themes.

- [ ] Capture `git status --short` and `git diff --stat` before edits; preserve all existing modifications.
- [ ] Add the following initial source contract test in `apps/inboxos/src/shared/glassTheme.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8')
describe('glass theme contract', () => {
  it('defines shared roles and accessibility fallbacks', () => {
    for (const name of ['fill', 'strong-fill', 'solid', 'border', 'shadow', 'blur']) {
      expect(css).toContain(`--crm-glass-${name}:`)
    }
    expect(css).toContain('prefers-reduced-transparency: reduce')
    expect(css).toContain('forced-colors: active')
    expect(css).toContain('@supports')
  })
})
```

- [ ] Run `pnpm --filter @docmee/inboxos test src/shared/glassTheme.test.ts`; confirm failure for missing tokens before editing CSS.
- [ ] Add initial light tokens to the authoritative light block and corresponding dark tokens to its dark block. Keep solid card/input variables solid, not universally translucent:

```css
/* light */
--crm-glass-solid: #ffffff;
--crm-glass-fill: rgba(255, 255, 255, .88);
--crm-glass-strong-fill: rgba(255, 255, 255, .96);
--crm-glass-border: rgba(15, 58, 74, .18);
--crm-glass-shadow: 0 8px 24px rgba(10, 40, 55, .08);
--crm-glass-blur: 12px;
/* dark overrides */
--crm-glass-solid: #1a2437;
--crm-glass-fill: rgba(26, 36, 55, .88);
--crm-glass-strong-fill: rgba(26, 36, 55, .97);
--crm-glass-border: rgba(180, 222, 237, .20);
--crm-glass-shadow: 0 8px 24px rgba(0, 0, 0, .18);
```

- [ ] Rerun the focused test after adding fallback rules in Task 2. Initial values are starting points; contrast verification can increase opacity without changing the architecture.

## Task 2: Shared surface application

**Files:** `apps/inboxos/src/app/globals.css`, `apps/inboxos/src/shared/glassTheme.test.ts`.
**Interfaces:** Consumes Task 1 tokens. Produces an explicit `data-docmee-glass="outer|strong|dense"` hook for exceptional components plus styles on existing shared surface owners.

- [ ] Add failing tests asserting the three data-attribute selectors and prefixed backdrop support exist.
- [ ] Apply this pattern to the explicit hook and existing `.clinic-card` and `.docmee-auth-card` owners; reconcile existing stronger selectors rather than accumulating `!important` overrides:

```css
[data-docmee-glass="outer"] {
  background: var(--crm-glass-solid);
  border-color: var(--crm-glass-border);
  box-shadow: var(--crm-glass-shadow);
}
[data-docmee-glass="strong"] { background: var(--crm-glass-solid); }
[data-docmee-glass="dense"] { background: var(--crm-card-bg); backdrop-filter: none; }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  [data-docmee-glass="outer"] {
    background: var(--crm-glass-fill);
    -webkit-backdrop-filter: blur(var(--crm-glass-blur));
    backdrop-filter: blur(var(--crm-glass-blur));
  }
  [data-docmee-glass="strong"] {
    background: var(--crm-glass-strong-fill);
    -webkit-backdrop-filter: blur(var(--crm-glass-blur));
    backdrop-filter: blur(var(--crm-glass-blur));
  }
}
```

- [ ] Give known header/sidebar owners theme-compatible tinted glass; retain their contrast and sticky positioning. Use static, low-alpha teal radial gradients on the shell only, not fixed overlay elements.
- [ ] Place fallback rules after enhancement rules, covering the same complete selector list, including existing shared owners:

```css
@media (prefers-reduced-transparency: reduce), print {
  [data-docmee-glass="outer"], [data-docmee-glass="strong"] {
    background: var(--crm-glass-solid);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
}
@media (forced-colors: active) {
  [data-docmee-glass="outer"], [data-docmee-glass="strong"] {
    background: Canvas;
    color: CanvasText;
    border: 1px solid CanvasText;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
    box-shadow: none;
  }
}
```

- [ ] Remove obsolete unconditional blur on nested content, not layout rules. Keep nodes/messages/rows free of blur. Never globally select `div`, `section`, or every Tailwind background utility.
- [ ] Run the focused contract test; expect pass. Inspect the diff for retained theme overrides that defeat the new values.

## Task 3: All-route coverage and exceptions

**Files:** Live `apps/inboxos/src/app/**/page.tsx` files and shared component owners identified by the following inventory; only styling changes are permitted. Record exact changed files in the result below.
**Interfaces:** Uses Task 2 roles; no new JavaScript state, callbacks, or network requests.

- [ ] Inventory `rg --files apps/inboxos/src/app -g page.tsx` and `rg -n 'bg-white|bg-gray|bg-slate|background:|backgroundColor:' apps/inboxos/src/app apps/inboxos/src/shared/components`. Exclude backup files.
- [ ] Record each spec coverage area as shared-inherited, explicitly mapped, or exception requiring repair. Inspect its owning classes before editing.
- [ ] For an exceptional outer surface, preserve all layout/semantic props and add `data-docmee-glass="outer"`; use `strong` on a dialog's content panel, never its scrim. Do not add these hooks to nodes, messages, or inputs.

```tsx
// Class lists and children remain those of the existing component.
<section data-docmee-glass="outer" className="docmee-auth-card" aria-busy={loading}>
```

- [ ] Check login notices/errors, shared confirmation dialogs, floating chat and media rail, patient profile, analytics tables, and workflow simulator. Remove only conflicting background utilities on mapped surfaces, leaving status and action colors intact.
- [ ] Run `pnpm --filter @docmee/inboxos typecheck`, `pnpm --filter @docmee/inboxos lint`, and focused existing tests for any modified component. Diff review must show no event-handler or API changes.

## Task 4: Visual acceptance and regression evidence

**Files:** This plan (evidence); CSS and focused tests only if a measured defect requires correction.
**Interfaces:** Validates Tasks 1–3 against the spec, not a new feature.

- [ ] Use an isolated local browser and existing local test fixtures. Inspect port ownership before launching a local server. Do not reuse production credentials or make real provider calls.
- [ ] Inspect login, inbox, calendar, analytics, channels, workflow/simulator, and a dialog in light/dark at 390/768/1440 CSS pixels. Record screenshot locations and actual observations, not assumed coverage.
- [ ] Test 200% zoom, long labels, scroll, keyboard focus, dialog/menu stacking, disabled/error states, reduced transparency, forced colors, and unsupported-blur fallback. Measure composited text contrast: 4.5:1 normal text, 3:1 large text/control boundaries.
- [ ] Check a dense workflow for smooth pan/zoom and that computed node/message/row backdrop filters are `none`. No visual acceptance claim if the browser or fixtures cannot be run.
- [ ] Run `pnpm --filter @docmee/inboxos test`, `pnpm --filter @docmee/inboxos build`, and `git diff --check`. Separate existing failures from introduced regressions; do not repair unrelated failures under this plan.
- [ ] Review final diff against baseline and report changed files, check results, visual limitations, and undeployed status. If later authorized to commit, stage only reviewed task paths/hunks after secret review; do not include scratch or unrelated dirty files.

## Plan self-review and handoff

Spec coverage: Task 1 tokens; Task 2 shell/fallback/dense surfaces; Task 3 all-route and login coverage; Task 4 accessibility, responsive, performance, and truthful evidence. No backend or provider changes. Exact route exceptions are determined by the explicit inventory rather than speculative blanket edits.

Recommended execution: inline, because the primary changes share one CSS cascade and the checkout contains unrelated in-progress work. Confidence: 90/100 (High) for the plan structure; visual acceptance remains unobserved. Alternative: subagent execution with sequential ownership and reviews, at additional coordination cost.

## Implementation evidence — 2026-09-05

Status: shared foundation implemented locally; Tasks 3–4 are not complete. No commit or deployment performed.

- Preserved the existing dirty workflow, Drive, and integration changes. Confirmed the checkout is already a linked worktree.
- Added glass tokens, progressive enhancement, explicit shared card/header/login/public surface mappings, and stronger floating-chat surface styling in `globals.css`.
- Matched the existing app-shell selector specificity to prevent important utility backgrounds defeating glass on clinic surfaces. Dense message and workflow-node filters remain `none`; their existing content backgrounds are unchanged.
- Replaced the proposed source-string test with parsed PostCSS declaration tests: four tests failed before implementation and passed afterwards. These are contract tests, not visual proof.
- Typecheck and lint passed. Production build passed, including 37 static pages and the i18n check. Next reports its existing ESLint-plugin configuration warning.
- Full InboxOS suite: 419 passed, 2 failed. Both failures are the previously observed `workflowCatalog.test.ts` fixtures connecting edges into trigger `t`; no workflow validation code was modified by this theme pass.
- Local built login inspected at 390/768/1440 pixels in light and dark. Computed surfaces use the intended 0.88 fill and 12px blur, without horizontal overflow. Print and forced-colors computed filters are `none` and backgrounds are solid/system colors.
- Screenshots: `.playwright-cli/glass-login-{light|dark}-{390|768|1440}.png`. Inspected the dark 390px screenshot; this is not a complete contrast or visual acceptance audit.
- An isolated DOM fixture using the actual compiled stylesheet confirmed app-shell clinic-card background precedence, stronger floating-panel fill, and no message/node blur, including print fallback. This is not authenticated-route coverage.
- `git diff --check` passed.

Remaining: sidebar and dialog owners, nested-blur audit, route-specific exceptions, authenticated page screenshots, measured contrast, keyboard/stacking checks, reduced-transparency emulation, and dense-workflow performance checks. Do not describe this foundation as an accepted all-page rollout.

### Continuation — shared sidebar and dialog owners

- Added strong surface roles to ConfirmDialog, DeleteConversationDialog, WabaTableModal, and the SlideOver content panel (not its scrim). Handlers and execution behavior are unchanged.
- Added app-shell specificity for strong surfaces so existing important utility backgrounds do not override them.
- Added tinted sidebar progressive enhancement and solid/system-color fallbacks. Nested clinic cards remain solid without another blur layer.
- Fresh checks: typecheck, lint, four existing glass contract tests, and diff whitespace check passed. These checks do not establish browser appearance or dialog stacking.
- No commit/deploy performed. Remaining acceptance work includes authenticated routes, dialog/sidebar browser inspection, contrast, keyboard/stacking, remaining nested surface owners, and workflow performance.

### Release-readiness check — 2026-09-05

Status: **NOT READY for full rollout**. Do not interpret a successful build as release acceptance.

- Removed nested backdrop filtering from header search/profile, help search, and auth loading content. The loading content now has a solid background. Page hero remains a solid surface without filtering.
- Added a fifth parsed-CSS contract regression: failed before the cleanup, passed afterwards.
- Fresh frontend checks: typecheck PASS, lint PASS, build PASS (37 static pages; 2133 matching translation keys), whitespace diff check PASS.
- Full frontend suite: **420 passed, 2 failed**. Existing workflowCatalog fixtures at lines 620 and 724 connect branches into trigger nodes, contrary to the validator's port contract. No validator behavior was weakened; repair these fixtures separately before the full release gate is green.
- Local browser fixture visited workflows, channels, analytics, calendar, and inbox at 390/768/1440 in light/dark: 30 measurements, no document horizontal overflow; header blur 12px and search blur none. Scratch script: `.playwright-cli/glass-route-check.js`; screenshots: `.playwright-cli/route-*.png`. Synthetic identity only; provider traffic intercepted. This is empty/unavailable-service-state coverage, not populated-data acceptance. The local fixture relaxes CSP only on intercepted localhost HTML responses, never source or production headers.
- Outstanding acceptance: populated inbox/calendar/analytics, workflow and simulation panels, measured contrast, 200% zoom, keyboard/dialog stacking, full route exception audit, reduced-transparency browser verification, and dense-canvas performance.
- Scope for eventual staging: theme CSS, glass contract test, four previously marked shared dialog components, and theme spec/plan. Exclude scratch directories and unrelated Drive/simulation/backend changes until independently verified.
- No commit, push, deployment, or provider configuration was performed.
