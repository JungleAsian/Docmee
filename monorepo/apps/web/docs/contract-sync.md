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
