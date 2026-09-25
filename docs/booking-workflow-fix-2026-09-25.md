# Booking capture and appointment management

Local implementation for the reviewed **Flujo_Daniel_Secretaria (TRASTEAR guiado con Chatgpt)** workflow. No deployment, workflow publication, patient messages, or real appointments were performed.

## Behavior

- Capture destinations use stable patient name, phone, email, and reason keys. Selecting a contact destination also selects its validation rule. Publishing a capture without a destination is blocked.
- Consultation reasons are saved in appointment notes, so Google Calendar retries retain them. The DOCMEE appointment detail view shows phone, email, and notes.
- Dedicated Create booking, Reschedule booking, and Cancel booking nodes start with separate completed, calendar-pending, and error routes. Existing nodes retain their single-successor behavior unless explicitly upgraded. Incomplete result routes cannot be published.
- Rescheduling availability can use the selected appointment ID. It checks patient ownership, keeps the original doctor/service, and only offers starts that fit the original duration. Rescheduling preserves the appointment's reason instead of copying stale conversation context.
- Cancellation and rescheduling expose pending Google synchronization without falsely reporting a Google update as complete. Uncertain replay results go to review; human-only automation suppression still stops execution.
- Calendar retries convert stored instants to clinic-local date/time.
- The appointment-management template selects an existing appointment and asks for confirmation before rescheduling or cancelling. Pending sync notifies the secretary; operation errors lead to a handoff.

This extends the existing workflow engine, appointment repository, and Google adapter. No new service or database migration is required by this change. The earlier patient phone/email schema migration remains a prerequisite.

## Repairing the saved Daniel workflow

Static templates do not rewrite saved workflows. The guarded repair is prepared in `scripts/prepare-daniel-booking-repair.ts`:

```powershell
pnpm exec tsx scripts/prepare-daniel-booking-repair.ts original-daniel.json repaired-daniel.json
```

It reads a fresh Studio export, checks the exact workflow name and reviewed node/edge anchors, validates the resulting graph, and writes a new import file without overwriting an existing file. It never calls an API. Preserve the original export as the configuration rollback.

The repair:

1. Corrects name/phone/reason destinations and adds an optional email question.
2. Upgrades the existing create-booking node while retaining its doctor/service/date/time settings and success destination.
3. Routes the existing Change and Cancel menu options through separate appointment selectors and confirmed lifecycle actions.
4. Preserves the existing Confirm-appointment/secretary route and unrelated nodes.

The repair is covered against a synthetic reconstruction of the reviewed connections. It has **not** been applied to a newly exported live graph; the exact workflow ID and current version must be rechecked at release.

## Release and acceptance

Release the engine/API, worker, and Studio changes together with the saved-workflow repair. Temporarily pause the affected workflow while coordinating release and publication: older workers do not understand the new result routes, and the stricter validator rejects its original empty name destination. In-flight executions tied to old revisions need explicit review before resuming; do not blindly replay booking writes.

Apply the validated graph to the exact existing workflow with version checking, or import as a draft and replace the active workflow deliberately. Preserve its trigger and unrelated configuration. Do not leave both versions active.

Before clinic acceptance, verify with an authorized test patient:

- Create: name, phone, optional email, and reason appear in DOCMEE and the Google event.
- Reschedule: the same appointment/event moves, preserving contact details, reason, doctor, service, and duration.
- Cancel: DOCMEE is cancelled and the linked Google event is removed.
- Multiple appointments, another patient's ID, unavailable slots, double delivery, and Google failures take the correct safe path.
- Pending synchronization retries preserve the clinic-local time and details.

Old bookings with missing data are not automatically reconstructed or backfilled. Source tests and a local build do not prove provider delivery or live workflow acceptance.

## Local verification

Worker, agents, and Studio test suites, TypeScript checks, ESLint, the bilingual key check, and a production Studio build were run. Targeted tests cover missing capture destinations, reason persistence, timezone retries, appointment ownership/duration, result routing, confirmation paths, and bounded offline repair. The build uses an isolated output directory; generated config changes are excluded from the source change.
