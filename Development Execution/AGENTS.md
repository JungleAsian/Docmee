# AGENTS.md — Operating Rules for Docmee Dev Agents

Two agents build this monorepo. Read this before any task. **Stay in your lane; the contract is the seam.**

## Who owns what
| Path | Owner | Rule |
|---|---|---|
| `apps/api`, `apps/worker` | **BE** | FE must never import from here |
| `packages/db`, `packages/core`, `packages/channels` | **BE** | migrations are append-only |
| `packages/contracts` | **BE owns** · FE **consumes** | changes = isolated "contract PR", reviewed by both |
| `apps/web`, `packages/ui` | **FE** | BE must never import from here |
| `packages/config` | both (rare) | touch only via a flagged PR |

## The contract rule (non-negotiable)
- All cross-boundary data shapes live in `packages/contracts` (OpenAPI + generated TS types).
- FE imports types **only** from `packages/contracts`. FE never hand-writes a backend type.
- FE develops against the **generated mock** of the contract until a phase's real endpoints land.
- Changing the contract is a **separate, small PR**. Never bundle it with feature code.

## Hard guardrails (CI enforces)
- Import-boundary lint fails the build if FE reaches into backend internals (or vice-versa).
- Every list/read endpoint is **clinic-scoped server-side** (RLS). Never accept a `clinic_id` from the client.
- Outbound messages **must** go through the chokepoint; proactive messages **must** pass the six-gate. No bypasses.
- Never log message bodies / PHI (SEC16). Never commit secrets.
- Tests are part of "done": RLS isolation (Phase 0) and six-gate/idempotency (Phase 2C) are mandatory, in-phase.

## Workflow per task
1. Find the phase + gate/gap it maps to in `docmee-trackers.xlsx` (Build Backlog / Phase Gates tabs). If it maps to nothing, **stop and ask** — no unmapped scope.
2. If the boundary shape is missing, request/author a **contract PR** first.
3. Implement within your owned directories only. Small, phase-scoped PRs.
4. In the PR description, cite the **gate(s)/gap(s)** satisfied.
5. Don't mark a phase done until its integration checkpoint passes on real APIs.

## When blocked
Do **not** race into the other agent's territory. Instead: author the next phase's contract stub, or write tests for your lane. Idle ≠ license to cross the seam.

## Build order
Follow `docmee-build-backlog.md` / the Build Backlog tab: Sprint 0 → Phase 0 → 1A → 1B → 1C → **Pilot Launch Gate** → 2A → 2B → 2C → 2D → 3A → 3B → 3C → 3D.

## Definition of Done (per phase)
Phase-gate criteria pass · gaps honored in code · integration checkpoint green on real APIs · required tests green.
