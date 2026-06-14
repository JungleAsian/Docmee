# Product specification

## Summary

Docmee is a self-hosted, multi-tenant WhatsApp assistant platform for clinics in Guatemala.

It should help clinics answer common questions, collect intake information, guide appointment requests, and hand conversations to staff when the assistant is uncertain or the topic is high risk.

## Primary users

- Clinic owners and administrators
- Reception staff
- Patients contacting clinics through WhatsApp
- Technical operators responsible for deployment and maintenance

## MVP scope

1. Tenant management
2. Clinic profile and business hours
3. WhatsApp webhook ingestion
4. Conversation state tracking
5. FAQ and clinic information responses
6. Appointment request intake
7. Staff handoff queue
8. Audit logs
9. Admin configuration UI or API

## Out of scope for MVP

- Diagnosis
- Prescription recommendations
- Emergency triage automation
- Insurance adjudication
- Payment processing
- EHR integrations

## Core workflows

### Patient FAQ

1. Patient sends WhatsApp message.
2. System identifies tenant from phone number or webhook metadata.
3. Assistant answers from approved clinic knowledge.
4. Uncertain answers route to staff handoff.

### Appointment request

1. Patient asks for an appointment.
2. Assistant collects name, preferred date, contact details, and reason at a high level.
3. System creates a pending appointment request.
4. Staff confirms manually.

### Staff handoff

1. Assistant detects urgency, uncertainty, sensitive topic, or user request for a person.
2. Conversation is marked for handoff.
3. Staff sees queue item with context and recommended next action.

## Non-functional requirements

- Tenant isolation by default
- Auditability for important events
- Clear escalation path
- Minimal data retention
- Environment-based configuration
- Self-hosted deployment support
