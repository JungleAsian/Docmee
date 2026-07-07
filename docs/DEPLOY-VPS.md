# VPS deploy checklist (Linux)

Pre‑deploy notes that complement the existing tooling — they don't replace it:
- One‑time host setup: `tools/deploy/setup/vps-bootstrap.sh` (Node 20 + pnpm + pm2
  + caddy + ufw on Ubuntu).
- Each deploy: `pnpm tool deploy vps` (needs `VPS_HOST`, `VPS_USER`,
  `VPS_SSH_KEY_PATH`, `VPS_DEPLOY_PATH`) → installs, builds, migrates, pm2
  `startOrReload ecosystem.config.cjs`, health‑checks.
- Process map: `ecosystem.config.cjs` runs **docmee-api** (`:3001`),
  **docmee-inboxos** (`:3000`), **docmee-workers**. `tools/` is NOT deployed.

## Linux compatibility — already verified
- Filename casing is safe (`forceConsistentCasingInFileNames` + clean typecheck) —
  no case‑mismatch imports.
- No Windows‑only code in the runtime services; no native modules.
- Shell scripts are LF; `.gitattributes` now enforces LF repo‑wide.

## Required env (`.env.production` at `VPS_DEPLOY_PATH`)
Copy `.env.example` → `.env.production` and set. The deployment‑critical, easy‑to‑miss ones:

| Var | Why it matters |
|---|---|
| `NODE_ENV=production` | A dev `NODE_ENV` breaks the inboxos `next build`. |
| `DATABASE_URL` | Postgres connection. |
| `REDIS_URL` | **Redis ≥ 5.0** (BullMQ). Use `redis:7` / apt Redis 5+. |
| `CORS_ORIGINS` | **Must** list the prod inboxos origin (e.g. `https://app.example.com`). In production the API trusts ONLY this allowlist — unset ⇒ the API blocks the panel. |
| `NEXT_PUBLIC_API_URL` | **Baked at build time.** Set it BEFORE the build if the API is not reachable at `<inboxos-host>:3001` (e.g. behind a reverse proxy / separate domain). The client falls back to `window.location.hostname:3001` otherwise. |
| JWT / encryption secrets, Meta/WhatsApp tokens, webhook verify tokens | Per `.env.example`. |

> Because `NEXT_PUBLIC_API_URL` is compile‑time, the build step must see it. With
> `pnpm tool deploy vps`, export it in the VPS shell / `.env.production` so the
> `pnpm --filter @docmee/inboxos build` picks it up, or override `VPS_BUILD_CMD`.

## TLS / reverse proxy
Neither `:3000` nor `:3001` serves HTTPS. Front them with Caddy (installed by the
bootstrap). Minimal `Caddyfile`:

```caddy
app.example.com {
    reverse_proxy 127.0.0.1:3000          # inboxos panel
}
api.example.com {
    reverse_proxy 127.0.0.1:3001          # API + /webhook/* (Meta webhooks)
}
```

If you serve the API on a subdomain like above, set
`NEXT_PUBLIC_API_URL=https://api.example.com` and
`CORS_ORIGINS=https://app.example.com` to match.

## First‑deploy order
1. `vps-bootstrap.sh` (once), grant the VPS GitHub read access.
2. Create `.env.production` (table above).
3. `pnpm tool deploy vps` → builds + `db:migrate` + pm2 reload.
4. Seed once if this is a fresh DB: `pnpm --filter @docmee/db db:seed`
   (creates demo clinics + the `studio@demo.test` IA Studio admin).
5. Point DNS at the VPS; Caddy auto‑provisions TLS.
6. Verify: `curl https://api.example.com/health` → `{status:"ok"}`, and the panel
   loads at `https://app.example.com`.

## WhatsApp activation — POST‑deploy (not a deploy blocker)
The platform deploys and boots **without** WhatsApp configured — the API env
schema doesn't require `META_*`/`WHATSAPP_*`, so the panel + other channels run
fine and WhatsApp simply stays inactive. **Meta verification is the clinic
operator's responsibility**, and the WhatsApp Business account is **transferred to
Docmee once it's ready** — so deploy first, activate WhatsApp later.

When the verified account lands, do these (no redeploy of code needed — just env
+ Meta console + a pm2 reload):
1. Set in `.env.production`: `WHATSAPP_DEFAULT_ACCESS_TOKEN`, `META_APP_SECRET`,
   `META_VERIFY_TOKEN`, and flip `LLM_STUB=false`.
2. Submit the 3 WhatsApp message templates for Meta approval.
3. In the Meta app dashboard, point the webhook to
   `https://api.example.com/webhook/whatsapp` (verify token = `META_VERIFY_TOKEN`).
4. `pnpm tool deploy restart --service docmee-api` (and workers) to pick up the env.
5. Send a test WhatsApp message → confirm it reaches the inbox.

## Don't deploy to the VPS
- The DevTools dashboard (`tools/`) — it's an unauthenticated local control plane.
- Tailscale Serve exposure — that's for the local DevTools only.
