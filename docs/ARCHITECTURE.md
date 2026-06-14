# Architecture

Docmee should be built as a small service-oriented application.

## Core services

- API service: receives WhatsApp webhooks, resolves tenants, stores messages, and creates responses.
- Admin service: manages clinics, FAQs, staff queue, and configuration.
- Worker service: handles retries, status checks, cleanup, and notifications.

## Core flow

1. Receive WhatsApp webhook.
2. Verify request authenticity.
3. Resolve clinic tenant.
4. Store inbound message.
5. Load conversation state.
6. Run safety checks.
7. Choose FAQ, intake, appointment, or staff handoff flow.
8. Store decision and outbound message.
9. Send response through WhatsApp Business API.

## Storage

PostgreSQL is recommended as the system of record. Every tenant-owned table should include `tenant_id` and indexes for tenant-scoped queries.

## Deployment baseline

- API container
- Worker container
- PostgreSQL
- Queue or cache service
- HTTPS reverse proxy
- Environment-based secrets

## Observability

Track webhook receipt, tenant resolution failures, message status, staff handoff events, blocked responses, and staff response latency.
