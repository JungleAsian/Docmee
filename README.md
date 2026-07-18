# Creascent-Development

This repository contains both the **Docmee product monorepo** and the **DevTools harness** used for development automation.

---

## Product Development (Docmee)

Run from the **repo root**:

```bash
# Install all product + DevTools dependencies
pnpm install

# Start the API in development mode
pnpm dev

# Type-check all product apps and packages
pnpm typecheck

# Lint all product apps and packages
pnpm lint

# Run all product tests
pnpm test

# Build all product apps and packages
pnpm build

# Start local services (Postgres + Redis)
docker compose up -d
```

Copy `.env.example` to `.env` and fill in values for your local environment.

> **Requirements:** Node 20+ and **Redis ≥ 5.0** — BullMQ refuses to connect to
> older servers. The bundled `docker compose` provides `redis:7-alpine`, so prefer
> `docker compose up -d redis` over a host‑installed Redis. A legacy native Redis
> (e.g. the old Windows 3.x build) fails the queue→worker integration test with
> `Redis version needs to be greater or equal than 5.0.0`. On Windows without
> Docker, use Memurai or WSL2 Redis 5+.

## DevTools

The DevTools harness lives in `/tools`. Run from the **repo root**:

```bash
# Use the CLI tool
pnpm tool <command>

# Or enter the tools directory for DevTools-specific commands
cd tools
pnpm dev          # Launch DevTools dashboard
pnpm tauri dev    # Launch DevTools desktop app
```

## Structure

```
/apps
  /api          - Fastify API (port 3001)
  /inboxos      - Next.js clinic inbox UI (port 3000)
  /licensekit   - License service (port 3002)
/packages
  /config       - Shared env parsing
  /shared       - Common types (Result, ID, etc.)
  /db           - Database boundary (Supabase)
  /queue        - Queue boundary (BullMQ / Redis)
  /llm          - LLM provider boundary (Anthropic, OpenAI, DeepSeek)
  /channels     - Messaging channel boundary (WhatsApp, Messenger, Instagram)
  /notifications - Notification boundary (Email, Discord)
  /agents       - Agent orchestration + Google Calendar boundary
  /kb           - Knowledge base boundary
/tools          - DevTools harness (do not modify from product code)
```

## Meta WhatsApp Embedded Signup

The Admin Studio Channels page uses Meta Embedded Signup (ES v4 with session-info v3). Configure these values in the API environment or secret manager; never commit their values:

- `META_APP_ID`: production Meta app ID.
- `META_APP_SECRET`: production Meta app secret used only by the API for code exchange and webhook signature verification.
- `META_EMBEDDED_SIGNUP_CONFIG_ID`: Facebook Login for Business configuration ID (`META_LOGIN_CONFIG_ID` is accepted as a compatibility alias).
- `META_GRAPH_API_VERSION`: Graph API version configured for the Meta app; defaults to `v24.0`.
- `APP_URL` (or `PUBLIC_APP_URL` / `WEBHOOK_BASE_URL`): public HTTPS API base used to derive the webhook URL.
- `META_VERIFY_TOKEN`: webhook verification token configured in both Docmee and the Meta dashboard.
- `ENCRYPTION_KEY`: server-side encryption key for stored provider tokens.

Meta dashboard checklist:

1. Add the production web origin to the app's allowed domains and Facebook Login for Business allowed domains.
2. Set the Embedded Signup configuration ID above and enable the WhatsApp permissions required by that configuration.
3. Configure the WhatsApp webhook callback as `<APP_URL>/api/webhook/whatsapp`, use the same `META_VERIFY_TOKEN`, and subscribe to message and status fields.
4. Complete Embedded Signup from **Admin Studio > Channels** using a Meta Business admin. Docmee exchanges the returned code on the server, stores the token encrypted, discovers the selected WABA/phone, and subscribes the app to the WABA.

Live Meta completion, business verification, number ownership, PIN/2FA, and production webhook delivery remain dashboard/external checks and cannot be established by local tests.

## Calendar-native workflow nodes

The Workflow builder includes three booking actions backed by the clinic or selected doctor's connected Google Calendar:

- **Check availability** reads `preferred_date` and optional `doctor_id` from the workflow context, checks up to 14 days, and stores results in `available_slots`. The field names are configurable with `dateField`, `doctorIdField`, and `slotsField`.
- **Offer slots** sends the next `count` slots through the existing WhatsApp channel and stores the offered subset in `offered_slots`.
- **Create / reschedule booking** reads the configured doctor, service, date, time, and appointment fields; writes Google Calendar first; then creates or updates the Docmee appointment. Set `mode` to `reschedule` for an existing appointment, otherwise it creates a booking.

Google Calendar OAuth must be connected at the doctor or clinic level. Tokens remain encrypted at rest, and refreshed tokens are persisted through the existing Calendar integration.
