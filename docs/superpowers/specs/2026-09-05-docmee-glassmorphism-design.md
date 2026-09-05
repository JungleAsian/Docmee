# Docmee shared glassmorphism standard

Date: 2026-09-05
Status: Written specification approved by the user; implementation planning authorized.

## Objective contract

Objective: make restrained glassmorphism the consistent presentation standard across Docmee web pages, including login, without reducing readability or changing business behavior.

Scope: shared theme tokens, application shells, cards, navigation, dialogs, floating panels, and route-specific styling that bypasses shared surfaces. Support existing light and dark themes.

Non-goals: backend changes, workflow execution changes, Drive permissions, navigation redesign, new UI dependencies, provider calls, and deployment. Existing uncommitted simulation, Drive, and integration-layout work must remain intact.

Owner and gates: user approves the written specification before implementation planning. Implementation must pass relevant automated checks and visual review before being described as verified. Publishing requires a separate release instruction.

Stop conditions: overlapping edits cannot be preserved safely; a required change alters application behavior; or verification requires credentials or real external actions. Report the narrow blocker rather than broadening scope.

## Chosen approach

Extend the existing semantic CSS variables in `apps/inboxos/src/app/globals.css`. Keep the existing theme initialization, brand teal, typography, and layout structure. Do not introduce a second theme provider or an independent page-by-page styling system.

This is preferred over decorative blur on every component, which risks readability and rendering cost, and over separate route themes, which drift over time. Confidence is high in the shared-token approach; final opacity and blur values require browser verification.

## Surface architecture

Use three semantic surface levels with separate light and dark values:

1. Outer glass: sidebar, header, large cards, and top-level panels. Subtle translucent fill, thin border, restrained shadow, and modest background blur.
2. Strong glass: dialogs, menus, and floating panels. Higher opacity so background content cannot compete with controls.
3. Dense surface: inputs, tables, chat messages, code/content editors, workflow nodes, and the workflow canvas. Opaque or nearly opaque fill; no per-row or per-node blur.

Map current card, panel, elevated, input, and shell variables to these roles. Add only the missing semantic variables for glass border, shadow, blur, and fallback fill. Apply styles to known shared component classes rather than broad selectors targeting every `div` or utility class.

Never apply container opacity to achieve translucency: text, icons, focus outlines, and status colors remain fully opaque. Keep existing selected, disabled, warning, and error semantics. Preserve the approved horizontal integration-card order.

Use a subtle static shell background to make glass perceptible. Avoid animated gradients, animated blur, large decorative overlays, and nested backdrop filters. Login receives the same surface and control vocabulary, not a separate visual identity.

## Coverage

| Area | Required coverage |
| --- | --- |
| Entry | Login and root page |
| Clinic workspace | Inbox, patient profile, calendar, waitlist, alerts |
| Reporting | Analytics, metrics, reports, quality of service |
| Studio | Overview, clinics, users, doctors, channels, integrations |
| Automation | Workflows, simulation, custom flows, automations, templates, quick replies |
| Administration | Knowledge, AI settings, activities, audit, errors, compliance, usage, license, credential health, costs, governance |
| Shared UI | Help pages, dialogs, dropdowns, floating chat, media rail, footer |

Implementation must inventory live route files and their surfaces, excluding backup files. Shared inheritance counts as coverage only after checking for local opaque overrides. Page structure and responsive layout remain unchanged except for fixes directly necessary to prevent the new styling from clipping or obscuring content.

## Accessibility and performance

Provide a solid usable baseline. Enable backdrop blur as progressive enhancement using feature support detection. Reduced-transparency preferences, forced colors, and print use solid surfaces without decorative blur or shadows. Existing reduced-motion behavior remains intact; add no necessary motion.

Target at least 4.5:1 contrast for normal text, 3:1 for large text and meaningful control boundaries. Validate against actual composited backgrounds in both themes. Preserve visible keyboard focus, error text, and accessible control names. Do not rely on translucency or color alone to indicate state.

Avoid filters on repeated workflow nodes, edges, chat messages, and table rows. Check scrolling and canvas interaction with representative dense content. Keep overlays above application content without introducing stacking contexts that hide menus or dialogs.

## Verification and acceptance

- Both themes use the same semantic surface hierarchy across the route inventory.
- Review representative login, inbox, calendar, analytics, Studio channels, workflow editor/simulator, and dialog states at 390, 768, and 1440 CSS-pixel viewport widths.
- Check 200 percent zoom, long labels, table overflow, keyboard focus, dropdowns, and dialog stacking. No newly clipped controls or inaccessible content.
- Verify solid fallback and reduced-transparency/forced-colors behavior; unsupported blur must not produce transparent unreadable panels.
- Run relevant styling/component regression checks, package typecheck, lint, and diff whitespace checks. Add targeted tests where token contracts or component classes change.
- Use local fixtures for visual checks; do not send messages, create appointments, upload files, or invoke providers.
- Record pre-existing full-suite failures separately from regressions introduced here. Do not claim a full green suite from focused checks.
- Report implementation, automated checks, visual acceptance, and deployed state separately. No live deployment is part of this specification.

## Delivery structure

Implement in dependency order: shared tokens and fallbacks; shared shells and surfaces; route-specific exceptions; responsive and accessibility verification. Keep changes restricted to presentation and its tests. Review the final diff against existing dirty work before any release action.

## Specification self-review

Reviewed for placeholders, contradictory scope, and ambiguous surface behavior. Dense content is explicitly exempt from blur but not from the shared color/border vocabulary. All-page coverage includes login. The scope is one shared presentation system, not a functional rewrite.
