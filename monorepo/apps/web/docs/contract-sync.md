# Contract sync — FE ⇄ real backend API

Reconciliation of the frontend (mock-first) against the backend's **shipped** routes
(`apps/api/src/routes/{auth,login,panel,iastudio,webhooks}.ts`), read 2026-06-14.
This is the map for flipping each screen **mock → real** at its integration checkpoint.

Legend: ✅ contract+FE aligned · ⚠️ diverges (fix before flip) · ➕ BE built, FE not yet surfaced · ❎ FE-proposed, BE not built.

## Aligned / synced (safe to flip)
| Endpoint | Notes |
|---|---|
| `GET /auth/session` | ✅ real; FE already consumes shape |
| `POST /auth/login` → `{token, mustRotate}` | ✅ now in contract. FE login is still mock (issues local token) — swap `setToken` for a real call |
| `GET/POST /patients`, `GET /patients/{id}` | ✅ (patient detail also returns `notes[]`) |
| `GET/POST /patients/{id}/notes` | ✅ now in contract — **FE deferred this; can now build it** |
| `GET /conversations`, `GET/POST /conversations/{id}/messages`, `PUT /conversations/{id}/mode` | ✅ |
| `PUT /conversations/{id}/assignee` `{assigneeId\|null}` | ✅ now in contract — claim/assign UI can use it |
| `GET/POST /appointments`, `PUT /appointments/{id}/status` | ✅ status PUT now in contract — **reschedule/cancel deferral resolved** |
| `GET/POST /kb/entries`, `GET/POST/DELETE /quick-replies` | ✅ |

## ⚠️ FE-proposed paths that DIVERGE from BE (fix contract + FE hook + MSW together)
| FE-proposed (current) | BE real (shipped) | Action |
|---|---|---|
| `GET /messages/search?q` | `GET /search/messages?q` | rename in `lib/api/analytics.ts` + handler |
| `GET /analytics/overview` | `GET /metrics?from&to` → `{data:{...}}` | rename + add date range; reshape `AnalyticsOverview` |
| `POST /templates/{id}/submit` | `PUT /templates/{id}/status` `{status: pending\|approved\|rejected}` | no "draft"→submit; status is a PUT. `category` is free string, not enum |
| `GET/PUT /automation/settings` (object) | `PUT /automation/{type}` `{enabled}` (per-rule) | reshape automation page to per-rule toggles |
| `POST /copilot/suggest {conversationId}` | `POST /conversations/{id}/copilot {text?}` | move under conversation; optional `text` |
| `POST /flows {name, enabled}` | `POST /flows {name, definition}` | flows carry a JSON `definition`, not `enabled` |

## ➕ BE built, FE has not surfaced (future FE work)
`GET /errors` + `PUT /errors/{id}` (error-review queue) · `GET /kb-suggestions` ·
`GET/POST /invoices` + `PUT /invoices/{id}/status` (manual invoicing 2A) ·
`GET /features/{key}` + `PUT /features/{key}/toggle` (3-gate feature flags) ·
`POST /patients/{id}/merge` (cross-channel merge 2B) · `POST /patients/{id}/consent` ·
`POST /rules` (rule engine 3B) · `POST /doctors/{id}/staff` ·
IA Studio `POST /platform/login`, `GET /platform/clinics`, `GET/POST /platform/flags`, `POST /platform/impersonate` (read-only, 30-min, logged).

## ❎ FE-proposed, BE has NOT built (drop or request from BE)
- `GET /clinics` → use **`GET /platform/clinics`** (IA Studio / platform token). Clinic users have a single `clinicId`; the FE clinic switcher should reflect that (or be IA-Studio-only).
- `GET/POST /users`, `PUT /users/{id}/role` → no clinic-user CRUD endpoint exists; team/RBAC mgmt is unbuilt.
- `GET/POST /channels`, `POST /channels/{channel}/connect` → no channel-connect API; per-clinic Meta connect is an onboarding action (X16), not a panel endpoint.
- `GET/POST /documents`, `GET/POST /exports` → OCR/export run server-side (`ingestDocument`, `exportPatient` in `@docmee/agents`); no REST list/create surfaced yet.
- `POST /push/subscribe` → Web Push (3D) not built server-side yet.

## Flip order (matches pilot priority)
1. **Auth** — real `/auth/login` → store returned token; keep `/auth/session` round-trip.
2. **Inbox + CRM (1B)** — patients, notes, conversations, messages, mode, assignee.
3. **Scheduling (1C)** — appointments + `/appointments/{id}/status`.
4. Then 2A→3D, applying the ⚠️ renames/reshapes above, one phase per checkpoint.

> The ❎ items are FE-only mock surface today — keep them on MSW until BE ships (or
> remove the screens) so the app never calls a non-existent endpoint in production.

## ⚠️ BLOCKER for the 2A–3D flip: backend responses aren't contract-shaped yet
Verified 2026-06-15 (`apps/api/src/serializers.ts`): **only `Conversation` and `Appointment` are mapped to camelCase contract shapes.** The MVP slice (auth/patients/notes/conversations/messages/appointments) is contract-conformant and flips clean (proven). But the **2A–3D endpoints return raw snake_case DAL rows**, which do NOT match the contract the FE consumes:
- `/metrics` → `{ day, metric_key, value }[]` (not the FE `AnalyticsOverview`)
- `/search/messages` → hits with `conversation_id`, decrypted body
- templates / automation-rules / flows / doctors / documents → snake_case rows

**Consequence:** FE cannot flip these screens to real without either (a) BE adding serializers (`toTemplate`, `toMetricSeries`, …) so responses match the contract — the correct fix, BE lane — or (b) the FE hand-mapping snake_case, which violates the "contract is the camelCase seam" rule and would be thrown away once (a) lands.
**Path to flip 2A–3D:** BE serializes those endpoints to the (reconciled) contract shapes → then FE renames paths + flips. Until then, keep 2A–3D on MSW.

## Run the real thing locally (one machine, no cloud)
Verified 2026-06-14: real panel ↔ real backend, no Postgres/Redis/keys needed
(backend runs on in-process **PGlite**). Login now calls the real `/auth/login`
(MSW answers it in mock mode), and the API has CORS for localhost.

1. **Backend** — a tiny launcher (run via `pnpm --filter @docmee/api exec tsx <file>`)
   that: `createTestDb()` (PGlite) → seed a clinic + admin (`hashPassword`) + a
   couple patients → `buildApp({env, db, keyring})` → `app.listen({port:4555})`.
2. **Frontend** — `apps/web/.env.local`:
   ```
   NEXT_PUBLIC_API_MOCKING=disabled
   NEXT_PUBLIC_API_URL=http://127.0.0.1:4555
   ```
   then `pnpm dev:web` and log in with the seeded admin.
3. Confirmed working: login → real JWT → dashboard reads the real session
   ("Sesión activa contra API real") → patients list shows the seeded,
   encrypted-at-rest records decrypted by the backend.

> Production swaps PGlite for real Postgres/Redis and the fakes for real
> AI/WhatsApp (X5/X6) — the seam (this contract) stays identical.
