# DOCMEE approved UI, calendar, and workflow release plan

## Objective

Complete the remaining user-approved InboxOS, Calendar, Alerts, Studio, and workflow-builder changes in the existing DOCMEE application, then verify and deploy the resulting commit to the existing AWS environment.

## Global constraints

- Preserve the existing application, routes, APIs, clinic data, and backwards compatibility.
- Do not send patient messages or create appointments during verification.
- Keep manual overbooking restricted to authorized secretary/admin operators and revalidate capacity server-side.
- Use accessible buttons and disclosure state for all Show/Hide controls.
- Prefer dependency-free workflow layout/routing changes unless an existing dependency already solves the need.
- All implementation tasks must include focused tests, a production build check, and an independent read-only review.
- Deployment is controller-owned: push only the verified commit, deploy through the existing AWS SSM/service path, verify the exact deployed build, and roll back on failed health or smoke checks.

## Task 1: Studio surfaces, Alerts table, and cost card

Implement the following changes:

1. In Studio Channels, make the Google workspace sync group a disclosure that starts collapsed. Keep Google Calendar and Google Sheets inside the group as vertically stacked, full-width cards.
2. In Studio AI Settings, make the Docmee AI providers group a disclosure that starts collapsed. Keep Claude, Codex/ChatGPT, Google Gemini, and Custom/OpenAI-compatible inside the group as vertically stacked, full-width cards.
3. In Automation Center, add accessible Show/Hide disclosures that start collapsed for Automatic follow-ups, Review requests, and Automation workflows. Keep essential summary/status and management controls available in the collapsed header.
4. Remove only the Cost assumptions card from Cost Monitoring.
5. Convert the Alerts list to a horizontally scrollable data table with columns: Read status, Priority, Alert, Details, Channel/mode, Date/time, Conversation, Actions. Preserve filters, counts, acknowledge actions, links, priority styling, and readable empty/loading states.

Expected verification:

- Add or update component/page tests for disclosure defaults and Alerts table behavior.
- Run focused tests and TypeScript checks for the touched surfaces.

## Task 2: Inbox tag manager and Calendar manual scheduling UX

Implement the following changes:

1. Move the Custom conversation tags manager from Studio Channels to the Inbox context rail directly below the booking calendar. Preserve clinic-scoped create, color edit, reorder, archive, delete, persistence, and the conversation tag assignment behavior. Keep the Studio InboxOS display setting for whether conversation tags are visible, but remove the manager UI from that page.
2. On the main Calendar page, always render the doctor's configured working-hour slots, including occupied slots. Add a `+` action to each slot for authorized manual operators. Free slots create a normal booking; occupied slots create a parallel booking only when capacity allows.
3. Parallel booking requires patient name, clinic service, and appointment reason. Reuse the existing role-enforced backend contract and revalidate capacity immediately before submission.
4. Add adjustable HH/MM controls: hours are limited to the selected doctor's schedule and minute values follow the clinic booking interval. Keep occupancy/capacity visible.
5. Remove the AI booking activity subtitle, add an accessible Show/Hide disclosure for the activity panel, compact the command-center metric and next-action/next-visit cards, and move the booking legend above the calendar schedule.

Expected verification:

- Add/update focused component tests for tag CRUD placement, disclosure behavior, interval-driven time selection, occupied/free slot actions, required parallel patient fields, and role restrictions.
- Run focused API tests covering manual overbooking authorization and capacity rejection.

## Task 3: Workflow graph routing and layout

Improve the existing dependency-free workflow builder:

1. Preserve left-to-right flow. Place the primary input handle at the logical left-center and output handles adjacent to their logical branch rows on the right.
2. Route forward edges through rounded orthogonal corridors. Route loop/back edges outside the main graph using top/bottom lanes.
3. Calculate horizontal and vertical spacing from node dimensions and branch count; keep children near their parent while preventing collisions.
4. Add deterministic multi-pass crossing reduction and keep edge labels near their source branch.
5. Highlight a selected path and dim unrelated nodes/edges without hiding them.
6. Keep Layout all and add Layout selected branch. After relevant manual movement, provide a non-blocking crossing warning and a one-click reduction action.
7. Preserve import/export, undo/redo, save, validation, selection, and existing node rendering.

Expected verification:

- Extend workflow layout unit tests for deterministic positions, no overlap, branch locality, back-edge lanes, selection, and crossing reduction.
- Add/update canvas tests for handle placement, path emphasis, and selected-branch layout.

## Task 4: Release verification and AWS deployment

Controller-only release steps:

1. Review all task commits together and resolve release-blocking findings through a delegated fix/re-review loop.
2. Run focused tests, full typecheck, production build, applicable lint/preflight, secret scan, and migration safety checks.
3. Push the verified commit to the existing GitHub branch.
4. Verify live AWS account, region, instance, service, application path, currently deployed commit/build identifier, and rollback commit.
5. Deploy the exact verified commit through AWS SSM to the existing DOCMEE service.
6. Verify service health, static asset availability, deployed build identity, live regression script, and read-only browser smoke checks for Inbox, Calendar, Alerts, Studio Channels, Studio AI Settings, Automation Center, Cost Monitoring, and Workflow Builder.
7. Roll back immediately if health, assets, auth shell, or critical route smoke checks fail.
