# Docmee — Phase 0 (Foundation): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** `docmee-risk-register.md` · `docmee-action-tracker.md` · `00-architecture.md`

Phase 0 establishes the multi-tenant foundation everything else builds on: the data model + isolation, auth (platform + clinic), the WhatsApp receive/send pipes, and the operating baseline. **No bot, agents, or LLM** — that begins in 1A.

---

## Scope

**In:** multi-tenant data model with RLS; app-layer field encryption; platform + clinic auth (JWT/RBAC/RLS); WhatsApp connectivity (Evolution interim + Meta Cloud API handshake) with token storage; inbound store + outbound send primitive; opt-out enforcement; idempotency; migrations + runner; bootstrap; health checks; single-VPS deploy.

**Explicitly out (deferred):** LLM/agents/KB + conversation state (1A) · automatic patient replies, 24h-window, templates (1A/2C) · consent ledger + retention (2C) · multi-doctor activation (3A) · elevated-impersonation *behavior* (2A) · metrics/error dashboards + unrouted-spike alerting (2D) · Redis split / second node (post-pilot).

---

## 1. Core decisions (the 10)

1. **Worker RLS context.** Workers assume clinic identity via `SET LOCAL app.clinic_id = <job.clinic_id>` inside the job transaction, under normal RLS. Genuinely cross-tenant jobs (metrics aggregation, DLQ drain, IA Studio reads) use a separate, explicitly-marked, auditable admin role. RLS is the final enforcement layer for both API and workers.
   - **Cross-tenant carve-out design (R5 de-risk):** the bypass is one narrow, guarded door, not a property of the normal path. (a) A **distinct named DB role** used by nothing but the admin path; the normal app role stays RLS-bound and cannot cross tenants even if code is buggy. (b) A separate **`withAdminContext()`** function is the only place the admin connection is used; that connection string is imported in exactly one module, enforced by lint. (c) The admin path exposes a fixed **allowlist of cross-tenant operations** (metrics read, DLQ drain, IA Studio read) — never arbitrary unscoped SQL. (d) Every admin-path call writes who/why/what to the append-only audit log. (e) Gate tests: normal role is *denied* cross-tenant reads; admin role is reachable only via `withAdminContext`.
2. **Encryption model.** App-layer encryption in `packages/db`; Postgres stores ciphertext only, key never enters the DB. One global versioned key; `key_version` column on encrypted rows (rotation / per-clinic deferrable with no migration). Companion **HMAC hash columns** for searchable identifiers (phone, channel_id) so lookups work without decryption.
   - **HMAC key independence (R4 de-risk):** the HMAC is derived from a **separate, stable key** — *not* the rotating encryption key — so rotating the encryption key never invalidates lookup hashes. Both keys live in Vault. The DAL exposes lookup methods (e.g., `findPatientByPhone`) that compute the HMAC internally and query the hash column; **ciphertext columns are never exposed for `WHERE`/sort**. Equality lookups on encrypted identifiers work; range/substring/sort do not (a future need = a deliberate purpose-built derived field, not a surprise). Gate test: insert → lookup-by-phone resolves; lint check that ciphertext columns never appear in a `WHERE`.
3. **Disjoint identities.** `platform_users` and `clinic_users` are mutually exclusive — a person is one or the other. Platform staff reach a clinic only via impersonation (read-only default, 30-min cap, logged).
4. **User ↔ clinic = one-to-one** (`clinic_users.clinic_id`); no multi-clinic membership/switcher. **User ↔ doctor = many-to-many seam** (`doctors` + `staff_doctor_assignments`) laid now, dormant, activated in 3A.
5. **Opt-out MVP.** `opted_out` + `opted_out_at` + `opted_out_scope` (default `all`) on `patients`. STOP = all-stop. Enforced at the single outbound chokepoint. Keyword (Spanish-first: STOP/BAJA/NO MOLESTAR) + native platform stop. Bot-irreversible (admin clears only). Full consent ledger → 2C.
6. **Pipes only.** Inbound: webhook → HMAC → 200 OK first → enqueue → normalize → store (clinic-scoped). Outbound: send primitive with suppression check, exercised by test/programmatic calls. **No automatic patient replies** (first auto-reply = 1A).
7. **Idempotency.** `messages.provider_message_id` (Meta `wamid`) stored with `clinic_id`, unique constraint, insert-on-conflict-ignore → process-exactly-once (covers Meta + BullMQ redelivery). Retention/pruning, duplicate logging, edited-message handling deferred.
8. **Unrouted events.** Unknown `phone_number_id` → log-and-drop to `error_log` + metric increment, no alert (spike-alerting → 2D). Never auto-provision or trust the payload.
9. **Two-track Meta split.** Track A (code) builds against Evolution/test connectivity, never blocked by Meta. Track B (compliance: transfer + legal) runs in parallel, clinic-owned.
10. **Acceptance gate.** See §4.

## 2. Final-sweep locks

- **Deployment = single VPS all-in-one** for Phase 0/pilot (API + workers + Redis + Caddy + Evolution on one box; Supabase managed/remote). Redis-split / second node = post-pilot. Backups + recovery required before real patients (R8 / X12).
- **Elevated-impersonation seam.** Reserve nullable `acted_by_platform_user_id` on audit (and message) records now — empty in Phase 0, populated in 2A; keeps platform-staff actions attributable.

## 3. Mechanism decisions (the 6 gaps)

| # | Decision | Confidence |
|---|----------|-----------|
| G1 | **Migrations:** raw numbered SQL in `packages/db/src/migrations` + minimal forward-only runner + `schema_migrations` table, transactional apply. No ORM/framework. | High |
| G2 | **RLS chokepoint:** `withClinicContext(clinicId, fn)` in `packages/db` (opens tx, `SET LOCAL`, yields tx handle). Raw pool **private** to `packages/db`, never exported. API Fastify `preHandler` + worker wrapper. Single audited admin path is the only exception. | High (load-bearing) |
| G3 | **Bootstrap:** operator-run idempotent `bootstrap` seeds first `platform_users` admin, generates a random password printed once, force-rotate on first login. Then clinics via real `create-clinic`/`invite-admin`. No public signup. | High (8.5) |
| G4 | **Health:** `/health` (liveness) + `/health/ready` (readiness: Postgres + Redis + key/Vault; external providers **excluded**; cheap + ~5s cache). Gate measured on readiness. | High (9) |
| G5 | **Secrets boot order:** env = connection secrets only (Supabase URL/service key, Redis URL); master key fetched from Vault at boot into memory; host-secret-store fallback; **fail-fast to not-ready** if no key. | High (8.5→9.5 after spikes) |
| G6 | **Webhook handshake:** Meta GET verify-challenge (constant-time token compare, echo `hub.challenge`) + HMAC on POST + Evolution adapter normalized registration. | Very high (9.5) |

## 4. Acceptance gate (definition of done — measured on `/health/ready`)

1. **Inbound isolation** — message to Clinic A's WhatsApp lands in `messages`, normalized, scoped to Clinic A.
2. **RLS proven** — querying as Clinic B returns zero of Clinic A's rows (denied at the DB).
3. **Worker RLS context** — a worker on Clinic A's job reads/writes only Clinic A's data; admin role is the only cross-tenant path.
4. **Idempotency** — redelivering the same `wamid` yields exactly one row.
5. **Outbound + suppression** — send primitive delivers; a send to an `opted_out` patient is blocked at the chokepoint.
6. **Unrouted handling** — unknown `phone_number_id` is logged + metric incremented + dropped (no crash, no row).
7. **Encryption** — `patients.phone` / `messages.content` stored as ciphertext (verified by DB inspection); HMAC hash resolves a lookup without decryption; `key_version` recorded.
8. **Auth/RBAC** — `clinic_users` login mints a clinic-scoped JWT; `platform_users` cannot read clinic data except via the logged impersonation path.
9. **Migrations** — full Phase 0 set applies cleanly forward from an empty DB; `/health/ready` green.

## 5. Phase 0 build-task list (dev — not in the external tracker)

- Migration runner + `schema_migrations` + initial migrations (RLS policies, encryption columns, HMAC columns, pgvector readiness, the reserved seams).
- `withClinicContext()` helper + private pool encapsulation + Fastify preHandler + worker wrapper + the audited admin path.
- `bootstrap` seed + `create-clinic` / `invite-admin` paths.
- `/health` + `/health/ready` with cached dependency checks.
- Webhook GET verify-challenge + HMAC POST + Evolution adapter registration/validation.
- **Spike (a):** verify Supabase Vault fetch API on the real stack. **Spike (b):** test no-Vault → host-secret-store fallback reaches ready.
- Outbound send primitive with suppression check; inbound normalize + idempotent store.

## 6. Schema seams reserved in Phase 0 (laid, mostly dormant)

- `staff_doctor_assignments` (+ `doctors`) — many-to-many, activated 3A.
- `acted_by_platform_user_id` on audit/message — elevated impersonation, populated 2A.
- `opted_out` / `opted_out_at` / `opted_out_scope` — opt-out now; consent ledger subsumes in 2C.
- `key_version` on encrypted rows — rotation / per-clinic / KMS-envelope upgrade later.
- `provider_message_id` (+ `clinic_id`, unique) — idempotency now; policy knobs later.

## 7. Tracker cross-references

- **Risks:** R4 (encryption↔SQL filtering), R5 (RLS carve-out), R6 (single-clinic-per-user), R7 (Evolution), R8 (single-VPS SPOF).
- **Actions:** X2/X9/X10 (Evolution), X5/X6 (infra/creds), X8 (encryption key — closed), X12 (VPS backup/recovery).

---

*Phase 0 is sealed. Next: Phase 1A — Core Inbox + Bot Engine.*
