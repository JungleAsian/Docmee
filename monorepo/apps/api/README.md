# @docmee/api (Fastify backend) — OWNER: Prime. Never import apps/web or packages/ui.

Fastify API. JWT auth, RBAC, and RLS clinic context. The clinic id is read **only**
from the verified token — never from the client.

## Run

```bash
cp .env.example .env          # then edit
pnpm --filter @docmee/api dev # tsx watch (or: pnpm dev:api from the repo root)
```

Build + serve:

```bash
pnpm --filter @docmee/api build
node apps/api/dist/index.js
```

## Endpoints (Sprint 0)

| Method | Path             | Auth | Notes                                            |
|--------|------------------|------|--------------------------------------------------|
| GET    | `/health`        | no   | Liveness — always 200 while the process is up.   |
| GET    | `/health/ready`  | no   | Readiness (G4): Postgres + Redis + key/Vault. 503 if any down. External providers excluded. |
| GET    | `/auth/session`  | yes  | Current user + clinic context from the JWT. The FE/BE seam. |

## Layout

```
src/
  app.ts              buildApp() factory (pure; tests drive it via app.inject)
  index.ts            process entry (loadEnv → buildApp → listen, graceful shutdown)
  auth/token.ts       JWT sign/verify + claims→Session projection
  plugins/auth.ts     `authenticate` preHandler; decorates request.session
  health/readiness.ts ReadinessRegistry (cached dependency checks)
  routes/             health.ts, auth.ts
```

## Conventions

- All errors map to the contract `Error` envelope via `@docmee/core`'s `toErrorEnvelope`.
- Never log message bodies / PHI (SEC16) — use the redacting logger from `@docmee/core`.
- Phase-0 wiring (DB chokepoint, webhook, outbound primitive) registers its
  readiness checks onto the `ReadinessRegistry` passed to `buildApp`.
