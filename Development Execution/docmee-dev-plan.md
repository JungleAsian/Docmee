# Docmee — Development Plan (Two-Agent, Shared Monorepo)

**Setup:** one pnpm monorepo, two AI coding agents. **Cut:** Agent **BE** (Core & Contract) + Agent **FE** (Experience). Built from the sealed plan + Build Backlog.

> **The one rule that makes two agents work:** the backend agent **owns the API contract** (`packages/contracts`). The frontend agent never invents data shapes — it imports types from the contract and builds against a **mock** of it until each phase's real endpoints land. Drift between agents = the #1 failure mode; the contract is the seam that prevents it.

---

## 1. Why this cut (vs. naive FE/BE)
Your architecture is asymmetric: the safety spine (RLS, chokepoint, six-gate, deterministic rules) and two whole features (the bot, automation) live in the backend with **no UI**. A 50/50 FE/BE split would idle the FE agent in Phase 0–1A and overload it in 1B. This cut keeps both agents productive by (a) giving FE a parallel track (shell, design system, mocked screens) during backend-heavy phases, and (b) making the contract — not ad-hoc coordination — the integration point.

## 2. Monorepo layout & ownership
```
docmee/
  apps/
    api/         Fastify backend ...................... BE
    worker/      BullMQ workers (pipeline, automation)  BE
    web/         Next.js 14 panel .................... FE
  packages/
    contracts/   OpenAPI + generated TS types ........ BE owns · FE consumes  ← THE SEAM
    db/          Supabase schema, migrations, RLS .... BE
    core/        domain: pipeline, six-gate, rules ... BE
    channels/    Meta / WhatsApp / Messenger adapters  BE
    ui/          design system components ............ FE
    config/      tsconfig, eslint, prettier (shared) . both (rarely touched)
```
**Hard boundaries:**
- FE may import **only** from `packages/contracts` and `packages/ui` — never from `apps/api` or `apps/worker`.
- BE never imports from `apps/web`.
- Changes to `packages/contracts` or `packages/config` require a **contract PR** (see §5).
- Encode this as `CODEOWNERS` so each agent's PRs touch only its directories.

## 3. The contract-first workflow (the seam)
1. **Before a phase's feature code**, BE defines/extends the endpoints for that phase in `packages/contracts` (OpenAPI) and generates TS types + a mock server (Prism or MSW).
2. **FE builds against the mock** immediately — full screens, states, error handling — without waiting for BE.
3. **BE implements** the real endpoints to satisfy the contract.
4. **Integration checkpoint** (end of each phase): FE flips that phase's calls from mock → real; run the integration test pass.
A contract is "done for a phase" when both agents have signed off on its shapes — *then* parallel work begins.

## 4. Parallel sequencing (per phase: BE track ‖ FE track → checkpoint)
Phases follow the Build Backlog order; the two tracks are deliberately **not** lock-step.

| Phase | Agent BE | Agent FE | Integration checkpoint |
|---|---|---|---|
| **Sprint 0** | infra, CI, RLS test harness, **SEC06 decision**, contract v0 | app shell, auth flow, **design system**, i18n framework, mock server | auth round-trips against real API |
| **0 Foundation** | RLS, encryption, chokepoint, idempotency, deploy | login, clinic-switch, settings scaffold (mocked) | tenant-scoped session works end-to-end |
| **1A Core Bot** *(BE-heavy)* | KB, pipeline, six-gate, transcription | **KB editor UI**, inbox shell (mocked), bot-mode toggle UI | KB CRUD live; a message appears in the inbox |
| **1B Human Inbox** *(FE-heavy)* | patient/conversation/notes APIs, assignment, capture allowlist | **unified inbox, CRM, assignment, notes, tags** | full inbox operates on real data |
| **1C Scheduling** *(balanced)* | Calendar truth, intake state machine, lifecycle | **booking/calendar UI**, appointment views | book → appears on calendar + panel |
| **— PILOT LAUNCH GATE —** | rate-limiting (SEC18), backups (X12) | polish, empty/error states, a11y pass | launch-gate checklist green |
| **2A Multi-User** | RBAC, routing, notifications, invoicing | **role mgmt, IA Studio admin, panel i18n (ES/EN)**, quick replies | RBAC enforced in UI + API |
| **2B Channels** | Messenger/IG adapters, unified pipeline | channel badges, connect flow, merge UI | cross-channel message in one inbox |
| **2C Automation** | templates, six-gate jobs, reminders | template manager, automation settings UI | reminder fires through six-gate |
| **2D Analytics** | rollups, error-review, FTS | **dashboards, error-review UI, search** | charts render from real rollups |
| **3A Multi-Doctor** | doctor entity, per-doctor calendar/KB | doctor mgmt, doctor-select in booking | book a specific doctor |
| **3B Adv. Intake** | flow engine, rule engine, copilot API | **flow builder UI**, rule editor, copilot panel | a custom flow runs end-to-end |
| **3C Integrations** | OCR, Sheets/CRM export, reports | doc-upload UI, export config, report views | OCR'd doc enters KB; export with consent |
| **3D Mobile/PWA** | push service (VAPID) | **PWA manifest/SW, push opt-in, responsive pass** | installable PWA receives a push |

## 5. Coordination & guardrails (critical for two AI agents)
- **Contract PRs are special:** any change to `packages/contracts` is a small, isolated PR reviewed by *both* agents (or you) before dependent work. Never bundle a contract change with feature code.
- **Import-boundary lint:** add an ESLint rule (or `dependency-cruiser`) that *fails CI* if FE imports backend internals — agents can't accidentally cross the seam.
- **One agent per directory tree:** CODEOWNERS + small PRs scoped to one workspace. Two agents editing the same file is where AI agents thrash.
- **"When blocked, build the next contract or tests"** — not "race ahead into the other's territory." An idle agent writes the next phase's contract stub or the test suite, never feature code outside its lane.
- **Shared changelog discipline:** every PR notes which phase gates / gaps it satisfies (tie back to the tracker), so progress is auditable.
- **Migrations are append-only & BE-owned;** FE never touches `packages/db`.

## 6. Definition of Done (per phase)
A phase is done when: (1) all its **Phase-Gate criteria** pass; (2) its **gaps** are honored in code; (3) the **integration checkpoint** passes on real APIs; (4) the relevant **tests** are green — and for the two safety-critical layers, these are non-negotiable and built *in-phase*:
- **Phase 0:** RLS / tenant-isolation tests (no cross-clinic access).
- **Phase 2C:** six-gate + idempotency tests (no message escapes the gates; no double-sends).

## 7. Pitfalls specific to two AI agents
- **Contract drift** → mitigated by §3/§5 (one owner, mock-first).
- **Both agents "fixing" shared config/types** → CODEOWNERS + contract-PR rule.
- **FE mocking something BE later implements differently** → the contract is the single truth; mock is *generated from it*, so they can't diverge silently.
- **Silent scope creep by an agent** → every PR maps to a tracker gate/gap; anything unmapped is rejected.
- **Merge thrash on big PRs** → keep PRs phase-scoped and directory-scoped.

---
*Companion artifacts: `docmee-api-contract.yaml` (the seam to extend per phase), `AGENTS.md` (operating rules for each agent), and the **Build Backlog** + **Phase Gates** tabs in `docmee-trackers.xlsx` (what each phase must satisfy).*
