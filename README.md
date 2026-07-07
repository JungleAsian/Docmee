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
