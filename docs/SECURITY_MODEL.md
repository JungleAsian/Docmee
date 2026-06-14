# Security model

## Principles

- Least privilege for services and staff accounts.
- Tenant isolation by default.
- No secrets committed to the repository.
- Minimal collection and retention of sensitive data.
- Audit important actions.
- Prefer staff handoff when risk or uncertainty is high.

## Secrets

Store secrets in environment variables or a deployment secret manager. Never commit:

- WhatsApp access tokens
- Webhook verify tokens
- Database credentials
- AI provider keys
- Session secrets
- Clinic production data

## Tenant isolation

All tenant-owned data should include a tenant identifier. Every API handler should resolve the active tenant and enforce tenant scoping before reading or writing data.

## Access control

Recommended roles:

- Owner: manages billing, clinic profile, staff, and settings.
- Admin: manages knowledge base, handoff queue, and appointments.
- Staff: responds to assigned conversations.
- Viewer: read-only operational access.

## Audit events

Log these events:

- Login and logout
- Staff invitation and role changes
- Knowledge base changes
- Handoff assignment
- Conversation export
- Data deletion
- Integration token changes

## Data handling

- Redact sensitive values from logs.
- Avoid storing raw provider prompts when they contain sensitive user data.
- Use retention policies for old conversations.
- Encrypt production databases and backups where available.
