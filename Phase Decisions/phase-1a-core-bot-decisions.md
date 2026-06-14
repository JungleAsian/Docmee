# Docmee — Phase 1A (Core Inbox + Bot Engine): Locked Decisions & Acceptance Gate

**Status:** 🔒 SEALED · **Date:** 13 June 2026
**Companion docs:** `phase-0-foundation-decisions.md` · `docmee-risk-register.md` · `docmee-action-tracker.md` · `00-architecture.md`

Phase 1A turns the Phase 0 pipes into a working bot: per-clinic knowledge base, the intent→router→bot pipeline, the unified inbox with human takeover, audio transcription, medical-safety deflection, and the **first automatic patient replies**.

---

## Scope

**In:** per-clinic KB (manual entries + text-layer document ingestion); intent classification; routing with safety/takeover gates; prompt assembly; first auto-replies + 24h-window handling; thin real-time inbox with bot-mode/takeover/handback; audio transcription (provider-abstracted); medical-safety deflection guardrail; booking→handoff slot.

**Out (deferred):** full inbox — assignment/tags/notes/filters (1B) · scheduling agent (1C) · consent ledger + retention (2C) · multi-doctor (3A) · OCR/table parsing/advanced ingestion (3C) · multi-language beyond Spanish (later) · additional transcription providers (on-demand) · old-history summarization (later).

---

## 1. Knowledge base (Q1)

- **Unified retrieval substrate:** manual entries and document chunks in one `kb_entries` table, each embedded, distinguished by `source_type` (`manual`|`document`) + nullable `document_id`. Retrieval over all of it at the **0.70** threshold; below it → acknowledge + offer handoff (no general-LLM fallback).
- **`rules` category:** manual-only, **always injected in full**, never document-sourced.
- **Document ingestion (text-layer only):** PDF-with-text, DOCX, TXT, MD via `pdf-parse`/`pdfjs`, `mammoth`, LangChain `RecursiveCharacterTextSplitter` (~500-token chunks, ~15% overlap, structure-aware); async embed via `kb_embedding_jobs`; stored **draft → clinic review → live**. `kb_documents` source table; originals in Supabase Storage. OCR/tables/advanced → 3C.

## 2. Pipeline (Q2)

- **Intent set (5):** `question` · `booking` · `handoff` · `chitchat/greeting` · `unknown/low-confidence`. DeepSeek V4 Flash, intent-only, no LLM fallback.
- **Routing = ordered gate chain, first-match:** Gate 1 takeover/bot-active → Gate 2 safety/deflection → Gate 3 confidence → Gate 4 intent. **Structural enforcement:** one entry point `processInboundMessage()` owns the order; raw "reply" path is not callable out of order; outbound send requires a pipeline-issued **decision token** (no reply emitted outside a gate outcome). Tests are the floor.
- **Booking → handoff in 1A** (routing slot; destination swaps to the scheduling agent in 1C). Not building intake twice.
- **Prompt assembly:** system prompt [role/scope → Type-2 rules → retrieved KB chunks (source-tagged, ≥0.70) → answer contract], cacheable role+rules prefix. History = last ~10 turns as real turns (token-capped). **Truncation priority:** rules + current message never dropped → top KB chunks (drop lowest similarity) → trim oldest history; if even rules+message+top-chunk won't fit → error→handoff. KB grounding internal/source-tagged (retrieved + likely-used logged); patients see clean text, no citations.
- **Auto-reply + 24h window:** auto-reply fires as a gate outcome through the Phase-0 outbound chokepoint (suppression + window checked). Inside window → free-form. **Outside window edge → hold-and-resend, one try, then escalate:** hold as `pending_window`; on patient's next message within a bounded TTL (~24h) send once; if TTL expires / send fails / too stale → escalate to clinic + discard. No template send or dependency in 1A (templates → 2C).

## 3. Inbox + bot-mode + handback (Q3)

- **Per-conversation state:** `bot` · `human` · `paused` · `resolved`.
- **Takeover = explicit on action:** sending a reply (or "Take over") → `human`, bot silent; reading doesn't take over.
- **Self-healing handback (layered):** (1) **resolve = handback** (primary; resolved → bot-eligible, next inbound reopens in bot mode); (2) **inactivity timeout** (~24h configurable) auto-reverts stale `human` → `bot`, logged; (3) **stale view** surfaces inactive `human` conversations. A revert never makes the bot speak unprompted — bot only answers the next inbound.
- **Thin 1A inbox:** real-time list, thread view, manual reply (via outbound chokepoint), takeover/handback. Full inbox → 1B.

## 4. Audio (provider-abstracted)

- **Transcription is a swappable block** (mirrors LLM gateway): interface in `packages/channels`, each STT SDK isolated to its provider file. **Deepgram Nova-3 default** (Spanish-configured); Whisper/AssemblyAI/Google/Azure pluggable via IA-Studio config when enabled. Convocore is **not** a transcription provider (full agent platform) — out of scope for this slot.
- **Flow:** voice note → transcribe → text enters the same pipeline; original audio in Storage, transcript stored as encrypted message content.
- **Failure:** garbled/low-confidence/empty → ask patient to **retype** (fixed Spanish message); **repeat failure (~2x) → offer handoff** (no infinite retype loop).

## 5. Medical-safety deflection guardrail

- Clinics are **booking-only — no emergency handling/triage.** Guardrail is minimal: obvious distress/emergency language → fixed **non-clinical** safe message + **configurable local emergency number**, do **not** engage as booking. Deterministic (pre-LLM) gate + always-injected Type-2 behavioral rules (no diagnosis/treatment/med advice, no symptom interpretation, KB-grounded only, escalate-on-uncertainty, tone, clinic rules). Wording + number require clinic sign-off (X14).

## 6. Operational-detail locks (final sweep, Gaps 1–5)

1. **Conversation lifecycle:** new inbound after **>~30 days** (configurable) → new conversation (same patient, linked history); a `resolved` conversation + inbound **within ~7 days** → reopen in bot mode, else new. History assembly uses the current conversation only.
2. **Bot disclosure:** one-time lightweight disclosure in the first bot reply of each new conversation ("…asistente virtual de [clinic]…"), per-clinic configurable, on by default, not repeated.
3. **Outbound length/format:** answer-contract brevity + hard safeguard — split replies exceeding WhatsApp's ~4096-char limit on paragraph boundaries into ≤2–3 sequential messages; normalize to WhatsApp-supported formatting.
4. **Embedding-job failure:** retry with backoff → on exhaustion mark chunk `failed` (others unaffected), flag document "ingestion incomplete" in the clinic UI, log to `error_log`/DLQ; clinic can re-trigger.
5. **Provider outage / rate-limit mid-message:** bounded quick retries with backoff → fail-safe to **handoff** + brief patient holding message; never silence/crash/hang. DeepSeek down → treat as low-confidence → fallback/handoff; embedding/retrieval down → handoff.

---

## Acceptance gate (definition of done)

1. **KB:** admin creates manual entries + uploads a text-layer document → chunks embedded → review→live; retrieval returns a relevant chunk ≥0.70; `rules` present in every prompt.
2. **Intent + routing:** question→`question`; "talk to a person"→handoff; gibberish→fallback; **taken-over conversation never auto-replies**; distress message → deflection (not booking); no reply emitted without a decision token.
3. **Grounded answer:** KB-covered question → correct grounded answer (grounding logged); no-KB question → acknowledge + offer handoff (no hallucination).
4. **Auto-reply + window:** free-form sends inside 24h; a reply ready after window-close holds (`pending_window`), resends once on patient return within TTL, else escalates.
5. **Inbox + takeover:** secretary sees conversations real-time, sends a manual reply (chokepoint-checked), takes over (bot silent), resolves (→bot-eligible); inactivity timeout reverts a stale `human` conversation; revert never makes the bot speak unprompted.
6. **Audio:** Spanish voice note transcribes → flows as text; failed transcription → retype; repeat failure → handoff.
7. **Disclosure:** first bot reply of a new conversation includes the one-time disclosure.
8. **Provider outage:** simulated 429/5xx → bounded retry → handoff + holding message, no crash/hang.
9. **Lifecycle:** inbound after >30 days → new conversation; resolved + inbound within 7 days → reopens in bot mode.
10. **Embedding-job failure:** failed job retries → marks chunk failed + flags document incomplete; other chunks unaffected.

*Validated against Evolution/test connectivity (Track A); real keys (X5) required for end-to-end.*

## Build-task list (dev)

- KB: `kb_documents` + ingestion orchestrator (extractors + splitter) + Supabase Storage + `kb_embedding_jobs` worker + review-before-live + retrieval@0.70 + rules-always-injected.
- Pipeline: `processInboundMessage()` single entry + ordered gate chain + decision-token-gated outbound + intent (DeepSeek) + router + clinic-bot (retrieval + Claude via gateway) + prompt assembly + prompt-cache prefix.
- Safety: deterministic deflection gate + injected behavioral rules + configurable message/number.
- Auto-reply + window: `last_inbound_at` + window check + `pending_window` hold + one resend + TTL + escalate.
- Inbox: thin real-time inbox + modes (bot/human/paused/resolved) + self-healing handback (resolve / inactivity timeout / stale view).
- Audio: transcription interface + Deepgram (Spanish) + audio→text adapter + failure→retype + repeat→handoff.
- Cross-cutting: one-time disclosure; outbound length split/format; provider-outage retry→handoff; conversation-lifecycle rules; embedding-job failure handling.

## Tracker cross-references

- **Risks:** R9 (doc-ingestion 1A scope — watch/flag during build), R10 (deflection guardrail).
- **Actions:** X5 (Docmee platform keys; transcription provider-abstracted), X9 (Evolution standing for end-to-end), X14 (deflection wording + emergency number sign-off).

---

*Phase 1A is sealed. Next: Phase 1B — Human Inbox + patient data.*
