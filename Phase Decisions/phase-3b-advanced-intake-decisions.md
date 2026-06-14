# Docmee — Phase 3B (Advanced Intake & Custom Flows): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** prior phase records · `docmee-trackers.xlsx`

Phase 3B generalizes the fixed intake into a clinic-configurable flow builder, upgrades clinic rules into a structured/deterministic engine, and adds a secretary copilot. It also closes requirement gaps PR26, PR27, PR28.

---

## Scope
**In:** declarative custom-flow builder; advanced (structured) clinic rules; internal AI assistant for secretaries.
**Out (deferred):** none specific to 3B.

## Decisions

**Q1 — Custom-flow builder (8.0).** The fixed 8-step intake (1C) generalizes into clinic-configurable **declarative flows** — a flow is a named, versioned, ordered set of steps (collect field / ask / branch / call tool / hand off) run by a deterministic flow engine. Tool steps use the locked DAL allowlist; the same guardrails (opt-out, rules, handoff) always apply; a starter library ships (reschedule, confirm, location, price, surgery, post-consult, review, insurance). *Lower confidence: builder UX + validating clinic-authored flows is real work.*

**Q2 — Advanced clinic rules (8.5).** The 1A always-injected text rules gain a **structured conditional layer** (trigger/condition → enforced action), with safety-critical rules enforced *deterministically at pipeline gates* rather than left to LLM discretion. Resolves PR27 (no-booking-without-payment, after-hours-data-only) and PR26 (tone control becomes a per-clinic rule setting).

**Q3 — Internal AI assistant for secretaries (8.0).** A panel-side **copilot** for staff: reply drafting, conversation summarization, KB-answer surfacing, suggested next actions — same LLM + clinic KB, but strictly **human-in-the-loop** (secretary approves/edits before anything sends; the copilot never messages patients autonomously). *Lower confidence: another LLM surface + cost.*

## Sweep locks
- **G42 Flow validation:** clinic flows validated before activation — required terminal states, no infinite loops, only allowlisted tools/actions, mandatory guardrails auto-injected.
- **G43 Rule precedence / conflict resolution:** deterministic ordering; safety rules outrank preference rules; explicit conflict handling.
- **G44 Safety-critical enforcement point:** payment-gate, after-hours, emergency-transfer enforced deterministically at pipeline gates (not LLM discretion); ties to medical-safety D16.
- **G45 Copilot guardrails:** copilot output is draft-only, never auto-sent; KB-grounded; no cross-clinic PHI; suggestions audited.
- **G46 Flow/rule versioning & rollback:** flows + rules versioned per clinic; a bad flow can be rolled back; all changes audited.

## Acceptance gate
1. Declarative custom flows run by a deterministic engine; tool steps allowlisted; guardrails enforced; versioned + starter library.
2. Structured conditional rules; safety-critical rules enforced deterministically at gates; tone = rule setting.
3. Secretary copilot (draft/summarize/suggest) human-in-the-loop; never auto-sends; KB-grounded; no cross-clinic PHI.

## Tracker cross-references
- Decisions: 3B Flow builder · Advanced rules · Secretary copilot.
- Requirements closed: PR26 (tone), PR27 (clinic rules), PR28 (custom flows) — Partial → Planned.
- Gaps: G42–G46.

---
