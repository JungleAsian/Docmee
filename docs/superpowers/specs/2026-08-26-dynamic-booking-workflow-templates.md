# Dynamic WhatsApp Booking Workflow Templates

**Status:** Approved on 2026-08-26

## Goal

Add two production-ready workflow templates for WhatsApp appointment booking:

1. Single-doctor clinic booking.
2. Multiple-doctor clinic booking.

Both workflows must use Meta interactive menus, current clinic data, live Google Calendar availability for the next five days, AI-assisted inquiry handling, and a real secretary handoff.

## Product behavior

The opening menu offers three intents: book an appointment, ask a clinic question, or speak with a secretary.

The single-doctor template resolves the clinic's only active doctor automatically. It then offers only that doctor's enabled services, loads current calendar availability, lets the patient choose a date and time, confirms the choice, and creates the appointment.

The multiple-doctor template first offers active doctors. It then offers only the selected doctor's enabled services, followed by the same live five-day date, time, confirmation, and booking sequence.

Dynamic menu replies store stable entity IDs in workflow context. Human-readable labels are stored separately for messages and confirmation. Menus paginate within WhatsApp limits and refresh from current clinic data when sent.

The AI agent answers only clinic-grounded questions, does not provide medical diagnosis or advice, and returns the patient to the appropriate booking stage after a successful answer. Explicit human requests, emergencies, safety concerns, or insufficient confidence route to a durable secretary handoff that pauses the bot and notifies staff.

## Runtime design

Extend `action.interactive_menu` with dynamic option sources rather than introduce another booking engine:

- `static`: existing authored options and per-option handles.
- `clinic_doctors`: active doctors for the current clinic.
- `doctor_services`: active services assigned to the selected doctor; a blank doctor field resolves the clinic's unique active doctor.

Dynamic menus expose fixed outcomes: `selected`, `empty`, `restart`, and `livechat`. Pagination and unmatched replies re-send the node. Selection writes the stable ID to the configured field and the visible label to `<field>_label`.

Add a dedicated handoff action because `action.notify_secretary` sends an alert but does not pause automation. The new action uses the existing durable handoff boundary and staff notification behavior.

Booking creation revalidates that the selected service is currently enabled for the selected doctor. Availability and booking already reject past slots; the templates set the availability horizon to five days.

## Acceptance criteria

- Both templates pass structural workflow validation.
- The single-doctor template has no doctor-choice step and fails safely when there is not exactly one active doctor.
- The multiple-doctor template uses dynamic doctor and doctor-filtered service menus.
- Dynamic menus paginate, resolve tapped IDs or typed labels, and persist stable IDs plus labels.
- Both workflows offer only live future slots from the next five days.
- Booking creation refuses a disabled or unassigned doctor/service combination.
- Inquiry AI uses clinic knowledge and routes uncertainty, safety, and human requests to handoff.
- Secretary handoff pauses the bot and notifies staff.
- Existing static menus and existing workflow templates remain valid.
- No production deployment occurs without a separate explicit approval.
