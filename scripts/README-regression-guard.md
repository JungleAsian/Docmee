# Docmee Live Regression Guard

Canonical target: `https://app.docmeedevelopment.dev/`.

Use `scripts/deploy-inboxos-safe.sh` for frontend deployment on the live server.

The guard prevents the regressions that recently hit production:

- Refuses overlapping InboxOS builds by using a build lock.
- Fails if `.env.production` points the app, public API, or Google OAuth redirect back to the root domain.
- Fails if the cyan/blue theme tokens are replaced by the previous violet tokens.
- Fails if shared mascot page-banner styles are removed.
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
