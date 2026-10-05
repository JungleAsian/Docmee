# Docmee Live Regression Guard

Canonical target: `https://app.docmeedevelopment.dev/`.

Use `scripts/deploy-inboxos-safe.sh` for frontend deployment on the live server.

The guard prevents the regressions that recently hit production:

- Refuses overlapping InboxOS builds by using a build lock.
- Fails if `.env.production` points the app, public API, or Google OAuth redirect back to the root domain.
- Fails if the cyan/blue theme tokens are replaced by the previous violet tokens.
- Fails if shared compact page-header styles are removed or the old mascot
  page-header background hook is reintroduced.
- Verifies the login page, API health endpoint, Caddy, `docmee.service`, and PM2 processes after deployment.

Manual live check:

```bash
cd /var/www/docmee
export PATH=/home/ubuntu/.nvm/versions/node/v22.23.1/bin:$PATH
scripts/live-regression-check.sh
```

Safe frontend deploy:

```bash
cd /var/www/docmee
export PATH=/home/ubuntu/.nvm/versions/node/v22.23.1/bin:$PATH
scripts/deploy-inboxos-safe.sh
```

## Pre-deploy gate (read-only)

Run on the server, as the runtime user (never root), **before** `deploy-inboxos-safe.sh`:

```bash
cd /var/www/docmee
scripts/predeploy-check.sh <target-commit-sha> --fetch
```

It changes nothing (no checkout, build, migration or restart) and prints only commit ids,
file names, counts and the health response's `ok` / `buildId`. It exits non-zero on any
FAIL; a WARN needs a human decision. It checks:

- the checkout is clean and the target is a clean fast-forward (not older, not diverged);
- whether the update changes deployment/runtime files or dependencies (the safe deploy
  does **not** run `pnpm install`);
- pending database migrations, via `packages/db/scripts/pending-migrations.ts` in a
  **read-only** session: which would apply, whether any is destructive, and whether the
  database is already ahead of the target revision;
- services and health (local API, public API, login page);
- rollback readiness: the current commit is printed as the rollback point, the current
  InboxOS build exists, no build is running, enough disk for a second build.

What it does not cover: `deploy-inboxos-safe.sh` rolls back only the InboxOS front end.
The API and workers are rebuilt in place and applied migrations are not undone. Apply
migrations **before** the code, after an RDS snapshot, and only when none is destructive.
