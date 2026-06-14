# Docmee — Executive Summary

**AI chatbot platform for medical clinics over Meta messaging (WhatsApp first).** Status as of 13 June 2026: **planning complete — all 12 phases sealed, 61 decisions locked, 0 open gaps.** Next step is build.

---

## What Docmee is
A central, multi-tenant SaaS that lets clinics answer patients on WhatsApp (then Messenger + Instagram), book and confirm appointments via Google Calendar, and hand off seamlessly to human secretaries. Each clinic gets a private panel; an admin console ("IA Studio") manages all clinics. The bot answers **only** from a per-clinic knowledge base and **never** diagnoses, prescribes, or interrupts a human.

## The build, in twelve phases (all decision-sealed)
| | Phase | What it delivers |
|---|---|---|
| **Foundation** | 0 | Multi-tenant isolation (RLS), app-layer encryption, opt-out chokepoint, idempotency, single-VPS deploy |
| **MVP** | 1A · 1B · 1C | Core bot + WhatsApp inbox · human inbox + patient CRM · Google Calendar scheduling |
| **Pro ops** | 2A · 2B · 2C · 2D | Multi-user/RBAC + notifications · Messenger/IG + unified inbox · automation (reminders/follow-ups) · analytics + search |
| **Scale** | 3A · 3B · 3C · 3D | Multi-doctor clinics · custom flows + advanced rules + secretary copilot · OCR + Sheets/CRM + reports · mobile PWA + push |

## Core architecture
- **Stack:** pnpm monorepo · Fastify · Supabase (PostgreSQL + pgvector) · BullMQ/Redis · Next.js 14 · Caddy · single VPS.
- **AI:** Claude Sonnet (responses) · DeepSeek (intent) · OpenAI embeddings · Deepgram transcription (provider-abstracted/swappable).
- **Safety spine:** every outbound message passes one chokepoint; proactive messages clear a **six-gate** check (opt-out · approved template · timing · appointment-state · frequency-cap · clinic-enabled); safety-critical rules enforced **deterministically**, not by LLM discretion; strict per-clinic data isolation throughout.

## Key product principles (locked)
- **Bot never interrupts a human** — a human reply pauses the bot; self-healing handback.
- **Grounded answers only** — per-clinic KB, no cross-clinic mixing, medical-safety guardrails.
- **Human-in-the-loop** where it matters — reschedule/cancel and the secretary copilot stay human-approved.
- **Compliant proactive messaging** — transactional only at launch; marketing deferred.

## Spec coverage
Cross-checked against all 32 requirement sections of the platform spec: **19 Covered · 12 Planned · 1 Partial-by-design (bot reschedule/cancel kept human) · 0 Gaps.** Every requirement is either in-plan or a recorded, deliberate decision.

## Deliberately deferred (Future Improvements)
Live two-way calendar sync (FI1) · self-hosted LLM (FI2) · licensing/self-host (FI3) · native mobile app (FI4) · automated billing/Stripe (FI5) · smarter cross-channel identity merge (FI6) · bot-driven reschedule/cancel (FI7) · broadcast/marketing campaigns (FI8).

## What "sealed" means
Decisions — architecture, product behavior, scope — are finalized. It does **not** mean code is written. Remaining work lives in the tracker: **Phase Gates** (build/test criteria) and the **Action Tracker** (X1–X18 deployment + per-clinic onboarding steps).

## Risk & security posture
13 risks tracked (1 Med-High, rest Medium/Low); 24-item security audit (2 Critical, ~11 High) with 5 items open and recommended mitigations. Top watch-items: LLM-PHI handling, backups, PHI-in-logs, rate-limiting, dependency supply-chain.

---
*Single source of truth: `docmee-trackers.xlsx` (14 tabs — dashboard, decisions, risks, gaps, security, requirements, progress Gantts, cost). Per-phase decision records accompany this summary.*
