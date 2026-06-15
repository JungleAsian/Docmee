# Docmee deployment (single-VPS, architecture §14)

API + worker + Redis + Caddy on one box; Supabase (Postgres + pgvector) is managed/
remote. This is the Phase-0/pilot target (Redis-split / second node = post-pilot).

## First deploy

```bash
cp deploy/.env.example deploy/.env     # fill DATABASE_URL, JWT_SECRET, MASTER_KEY, HMAC_KEY, …
docker compose -f deploy/docker-compose.yml up -d --build

# Apply migrations (forward-only) against DATABASE_URL:
docker compose -f deploy/docker-compose.yml run --rm api node apps/api/dist/cli/migrate.js

# Seed the first platform admin (prints a one-time password):
docker compose -f deploy/docker-compose.yml run --rm api node apps/api/dist/cli/bootstrap.js admin@yourclinic.gt "Platform Admin"
```

Point DNS for your domain at the VPS; Caddy obtains TLS automatically. Update the
host in `deploy/Caddyfile`.

## Health & readiness
- `GET /health` — liveness (always 200 while up).
- `GET /health/ready` — readiness (Postgres + crypto). Gate deploys on this.

## Roles (production)
Create two Postgres roles in Supabase: the RLS-bound app role (`DATABASE_URL`) and a
`BYPASSRLS` admin role (`DATABASE_ADMIN_URL`) used only by the audited cross-tenant
carve-out and the worker's scheduled jobs. The app role must be the non-superuser
`docmee_app` (migrations grant it the needed table privileges).

## Pre-patient checklist (pilot gate)
X3 privacy policy · X7 WhatsApp number · X12 VPS backup/recovery · X20 counsel ·
X14 deflection sign-off · SEC18 rate limiting (built-in, tune `RATE_LIMIT_*`).

## Backups (X12)
Supabase managed backups + a periodic `pg_dump` to off-box storage; verify restore
before real patient traffic (closes SEC14).
