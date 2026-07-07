// Bot/human handoff rules (Rev1 #5, #6).
//
// The automated bot is allowed to reply only while a conversation is *bot-owned*.
// The moment a human takes the conversation over — by assigning it or by sending
// a manual reply — the bot must go silent and stay silent until the conversation
// is explicitly reactivated (manual "return to bot") or the reactivation timeout
// elapses. This module holds the pure predicates that decision depends on so they
// can be unit-tested in isolation and reused by the worker, the API, and the
// timeout monitor.
import type { Language } from './botbase/language-detector.js'

/** Conversation lifecycle states relevant to the interruption rule (Req 11: 7). */
export type HandoffStatus =
  | 'open'
  | 'pending'
  | 'assigned'
  | 'handoff'
  | 'snoozed'
  | 'resolved'
  | 'archived'

/** Metadata key set when a human reply auto-pauses the bot. */
export const BOT_PAUSED_AT = 'botPausedAt'
/** Metadata key recording why the bot was paused (for the inbox + reactivation). */
export const HANDOFF_REASON = 'handoffReason'

/**
 * Bot Interruption Rule (#6): the bot may auto-reply only while the conversation
 * is `open`. Once a human owns it (`assigned`/`handoff`) or it is closed
 * (`resolved`), the bot stays silent. Status is the single source of truth — both
 * the manual "return to bot" action and the reactivation timeout flip it back to
 * `open`, which re-enables the bot with no extra flag to keep in sync.
 */
export function isBotPaused(status: HandoffStatus): boolean {
  return status !== 'open'
}

// Explicit "I want a real person" phrases. A cheap pre-LLM keyword check so an
// unambiguous human request hands off reliably even if intent classification (or
// the stubbed LLM in local/test runs) misses it. ES first, then EN.
const HUMAN_REQUEST_PATTERNS = [
  'hablar con una persona',
  'hablar con alguien',
  'hablar con un humano',
  'con una persona',
  'una persona real',
  'persona real',
  'un humano',
  'con la secretaria',
  'con un agente',
  'atención humana',
  'quiero un humano',
  'talk to a person',
  'talk to someone',
  'talk to a human',
  'speak to a person',
  'speak to someone',
  'speak to a human',
  'real person',
  'human agent',
  'a real human',
]

/**
 * True when the patient explicitly asks to be connected to a human. Used to hand
 * off and pause the bot without waiting on the LLM classifier (#5).
 */
export function detectHumanRequest(message: string): boolean {
  const lower = message.toLowerCase()
  return HUMAN_REQUEST_PATTERNS.some((p) => lower.includes(p))
}

/** Patient-facing acknowledgement sent when the bot hands off to a human. */
export function handoffNotice(language: Language): string {
  return language === 'es'
    ? 'Con gusto. Estoy conectándote con una persona de la clínica; te responderá en breve.'
    : 'Of course. I am connecting you with someone from the clinic; they will reply shortly.'
}
