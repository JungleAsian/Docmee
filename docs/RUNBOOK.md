# Docmee Operations Runbook

Operational reference for the Docmee production stack (Hostinger VPS, PM2 + Caddy).
Pairs with `tools/deploy/ecosystem.config.cjs` and the `pnpm tool deploy …` commands.

## Services

| PM2 process        | Port | Source                         |
| ------------------ | ---- | ------------------------------ |
| `docmee-api`       | 3001 | `apps/api/dist/index.js`       |
| `docmee-workers`   | —    | `apps/workers/dist/index.js`   |
| `docmee-inboxos`   | 3000 | `apps/inboxos/server.js`       |
| `docmee-licensekit`| 3002 | `apps/licensekit/dist/index.js`|

Caddy terminates TLS and reverse-proxies `:3000` (panel) and `:3001` (API).
Postgres (Supabase) and Redis back the whole stack; both must be healthy before
the API or workers will accept traffic.

## Health checks

```
curl -fsS http://localhost:3001/health          # API liveness
pnpm tool deploy health --target vps             # remote API health
redis-cli ping                                   # Redis
pg_isready -U postgres                            # Postgres
```

## Common commands

```
pnpm tool deploy status                  # pm2 status + redis-cli ping + disk/mem
pnpm tool deploy logs                    # tail all pm2 logs (last 100 lines)
pnpm tool deploy logs --service docmee-api
pnpm tool deploy restart --service docmee-api
pnpm tool deploy rollback                # revert to the previous commit + reload
pnpm tool deploy migrate                 # run DB migrations on the VPS
```

Local dev infrastructure (Postgres + Redis via Docker):

```
pnpm tool deploy local                   # docker compose up -d
docker compose up -d                     # equivalent, from the repo root
```

## Deploys

1. Merge to `main` → the **Deploy to VPS** GitHub Action runs automatically
   (`.github/workflows/deploy.yml`): `git pull` → `pnpm install` → `pnpm build`
   → `pm2 reload ecosystem.config.cjs --update-env`.
2. Manual deploy: `pnpm tool deploy vps` (prints the plan and posts a Discord
   notice; confirm settings before running production steps).
3. Verify with the health checks above, then watch `pnpm tool deploy logs`.

### Rollback

```
pnpm tool deploy rollback                # SSH checkout previous commit, rebuild, pm2 reload, health check
```

## Alerts

All critical alerts route to the **Discord critical channel**:

- **Emergency / outage** — service down, repeated PM2 restarts.
- **Cost alerts** — AI spend over the configured budget.
- **Gate failures** — `pnpm tool gates check` failing in CI or locally.
- **Claude usage guard** — Build Control pause/resume notices (see below).

## Build Control — Claude usage guard

When Claude's usage limit is hit during an automated build, Build Control enters a
**paused** state and surfaces a reset countdown instead of failing the run:

- The pause + the reset ETA are shown in the DevTools dashboard (Build Control).
- A notice is posted to the Discord critical channel on **pause** and again on
  **resume**.
- The guard **never** cancels in-flight work; it waits for the reset window and
  resumes automatically.

## Meta token renewal

WhatsApp/Messenger/Instagram access tokens expire; the conversation worker warns
in the Discord critical channel ~7 days out (`META_TOKEN_EXPIRING`).

1. Go to the Meta Developer Portal.
2. Generate a new long-lived token.
3. Update the clinic's token via IA Studio (clinic → channel settings).
4. `pnpm tool deploy env` to sync `.env` to the VPS if a shared secret changed.

## Incident checklist

1. `pnpm tool deploy status` — are all four PM2 processes online?
2. `pnpm tool deploy logs --service <name>` — find the failing process.
3. Redis/Postgres reachable? (`redis-cli ping`, `pg_isready`).
4. If a bad deploy: `pnpm tool deploy rollback`.
5. Post status to the Discord critical channel.
