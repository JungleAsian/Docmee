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

## Frontend panel (apps/web)
The panel ships as a separate Next.js standalone container (`deploy/Dockerfile.web`,
`web` service) served by Caddy on the **same domain** as the API:
- Panel at `/` ; API at `/api/*` (Caddy strips `/api` → api). Same-origin ⇒ **no CORS**.
- `/webhooks/*` and `/health*` stay at root (Meta callback URL + probes).

The panel's API base URL is baked at **build time** (`NEXT_PUBLIC_*` are inlined), so
it's set via build args in `docker-compose.yml` (`NEXT_PUBLIC_API_URL=/api`,
`NEXT_PUBLIC_API_MOCKING=disabled`) — `docker compose build web` rebuilds it.

```bash
# Build + start everything incl. the panel:
docker compose -f deploy/docker-compose.yml up -d --build

# Seed a clinic + admin so staff can log in (prints a one-time password):
docker compose -f deploy/docker-compose.yml run --rm api node apps/api/dist/cli/seed-clinic.js \
  "Clínica Demo" admin@yourclinic.gt "Clinic Admin"
```

Prereq: a **stable domain** (replace `docmee.example` in the Caddyfile) — the panel
build hardcodes the API base, so it needs a durable host, not an ephemeral tunnel.
NOT build-verified in CI yet — run `docker compose build web` once to validate.

## Health & readiness
- `GET /health` — liveness (always 200 while up).
- `GET /health/ready` — readiness (Postgres + crypto). Gate deploys on this.

## Roles (self-hosted Postgres)
The `postgres` container's `init-db/01-roles.sh` creates the RLS-bound `docmee_app`
LOGIN role on first boot (`APP_DB_PASSWORD`). The superuser `postgres`
(`POSTGRES_SUPERPASS`) owns the schema and is used by `migrate` + the admin/platform
path (`DATABASE_ADMIN_URL`); the app connects as `docmee_app` (`DATABASE_URL`), so
RLS is enforced on every API/worker query. Migrations run as the superuser
(`DATABASE_ADMIN_URL`) because they create tables, roles, and SECURITY DEFINER
functions.

## Pre-patient checklist (pilot gate)
X3 privacy policy · X7 WhatsApp number · X12 VPS backup/recovery · X20 counsel ·
X14 deflection sign-off · SEC18 rate limiting (built-in, tune `RATE_LIMIT_*`).

## Backups (X12)
Supabase managed backups + a periodic `pg_dump` to off-box storage; verify restore
before real patient traffic (closes SEC14).
