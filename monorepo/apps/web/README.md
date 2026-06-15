# @docmee/web — Next.js 14 panel

**OWNER: Alpha (FE).** Imports only `@docmee/contracts` (types/seam) and `@docmee/ui` (design system). Never imports backend internals (enforced by `pnpm lint:boundaries`).

## Stack
- Next.js 14 (App Router) · React 18 · TypeScript (strict)
- `@docmee/ui` — Tailwind + shadcn-style design system
- `@tanstack/react-query` — server state / caching
- `next-intl` — i18n (ES default, EN), locale resolved from the session
- `msw` — in-process mock generated from the contract (mock-first workflow)

## Develop
```bash
pnpm install                 # from repo root
pnpm contract:types          # generate contract TS types (BE-owned step)
pnpm --filter @docmee/web msw:init   # writes public/mockServiceWorker.js (once)
pnpm dev:web                 # http://localhost:3000  (MSW on by default in dev)
```

Sign in with any email + password (Sprint-0 mock issues a local bearer token), then
the dashboard round-trips `GET /auth/session` through MSW.

## Environment
Defaults live in `src/config/env.ts`; no env file is required for dev.
- `NEXT_PUBLIC_API_MOCKING` — `enabled` | `disabled`. Defaults to on in dev, off in prod.
  Flip to `disabled` to hit a real API at a phase's integration checkpoint.
- `NEXT_PUBLIC_API_URL` — API base URL (default `https://api.docmee.example/v1`).

## Layout
```
src/
  app/            routes (login, dashboard), layout, providers
  components/      shared app components (grows per phase)
  config/         env / runtime flags
  i18n/           next-intl request config + locale helpers
  lib/
    auth.ts       bearer-token cookie helpers
    api/          typed client + query hooks (types from @docmee/contracts)
  mocks/          MSW handlers + seed data (mirror the contract)
messages/         es.json · en.json
```

## Contract workflow
FE never hand-writes a backend shape — all types come from `@docmee/contracts`.
Build each phase's screens against the MSW mock, then flip mock → real at the
integration checkpoint (see `docs/docmee-dev-plan.md` §3).
