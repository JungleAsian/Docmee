# Docmee Operations Runbook

Production runs on AWS EC2 (see `DOCMEE CONNECTION.md` for the verified host,
instance id, and SSH/SSM access details — reverify before use, these are
time-sensitive). The legacy Hostinger VPS + GitHub Actions deploy workflow
this runbook used to describe has been retired.

## What's verified so far

- Instance is reached via AWS SSM (EC2 Instance Connect / direct SSH may be
  blocked by the security group depending on your current egress IP).
- The app runs from a git checkout at `/var/www/docmee`.
- A systemd service (`docmee.service`) wraps `pm2-runtime start
  ecosystem.config.cjs` and restarts on failure.
- API health: `curl -fsS http://127.0.0.1:3001/health` (run on the instance,
  or via SSM Run Command).

## Local dev infrastructure

Postgres + Redis via Docker, for local development only:

```
pnpm tool deploy local                   # docker compose up -d
docker compose up -d                     # equivalent, from the repo root
```

## Deploys

There is no automated CI/CD path to the AWS instance today. Treat any
production deploy as a manual, reviewed operation:

1. Confirm the currently deployed commit on the instance (`git log --oneline
   -1` in `/var/www/docmee`) and compare against what you intend to ship.
2. Get the reviewed code onto the instance (e.g. `git fetch` + checkout the
   approved commit) via SSM Run Command.
3. Rebuild (`pnpm install --frozen-lockfile && pnpm build`) and reload
   (`pm2 reload ecosystem.config.cjs --update-env`, or restart the
   `docmee.service` systemd unit).
4. Verify the health endpoint and watch logs (`pm2 logs`, or
   `journalctl -u docmee.service`) for new errors.

Fill in the exact commands here once the full process manager / build
pipeline on the instance is confirmed end-to-end.

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
4. Sync the updated secret to the instance's `.env.production` if a shared
   secret changed.

## Incident checklist

1. Is the instance reachable and is `docmee.service` active? (`systemctl
   status docmee.service` via SSM, or `pm2 status` on the box.)
2. Check logs for the failing process (`pm2 logs`, or `journalctl -u
   docmee.service`).
3. Redis/Postgres reachable? (`redis-cli ping`, `pg_isready`).
4. If a bad deploy: check out the previous known-good commit, rebuild, reload.
5. Post status to the Discord critical channel.
