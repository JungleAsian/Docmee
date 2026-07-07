// Screen 9 — Error Review Queue. The error_reviews table only carries the raw
// worker fields (errorType, errorMessage, stackTrace, context, status, …); the
// triage signals the queue surfaces — patient-safety, bot vs human mode, urgent,
// handoff-pending — are DERIVED here from the errorType + context with documented
// heuristics (the same spirit as the existing fix-guidance heuristic). Keeping the
// derivation in one pure, tested module makes the badges predictable and lets the
// page stay presentational.
import type { TranslationKey } from './i18n'
import type { ErrorReview } from './types'

export type ErrorMode = 'bot' | 'human'

export interface ErrorContact {
  /** Best available patient label (name → phone → fallback). */
  name: string
  /** WhatsApp / channel handle, when the worker recorded it. */
  phone: string | null
  /** Channel slug ('whatsapp' | 'messenger' | 'instagram' | …). */
  channel: string | null
}

export interface ErrorReviewMeta {
  /** Who was driving the conversation when it failed. */
  mode: ErrorMode
  /** Time-critical — surface first (open + safety or a blocked patient reply). */
  urgent: boolean
  /** Clinical risk — never auto-resolve. */
  patientSafety: boolean
  /** Still waiting on a person to take over. */
  handoffPending: boolean
  /** Closed (resolved/ignored) — no longer actionable. */
  resolved: boolean
  contact: ErrorContact
  /** The raw inbound patient text, when available, for the conversation excerpt. */
  patientMessage: string | null
  /** Localized friendly label key for the error type, or null (humanize the code). */
  typeLabelKey: TranslationKey | null
}

function ctxString(context: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = context[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function ctxFlag(context: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => context[key] === true)
}

/** A send/delivery failure means the patient never got a reply — always pressing. */
export function isDeliveryFailure(errorType: string): boolean {
  return /send_fail|delivery_fail|meta_send|whatsapp_send|message_failed/.test(errorType.toLowerCase())
}

/**
 * Clinical-risk flag. Anything explicitly safety/medical/emergency tagged, plus an
 * unresolved intent — an inbound the bot could not classify may be a crisis it
 * failed to read, so it is treated as patient-safety until a human clears it.
 */
export function isPatientSafety(errorType: string): boolean {
  return /safety|medical|emergency|urgent|intent_unresolved/.test(errorType.toLowerCase())
}

/** Localized friendly label for the known worker codes; null → humanize the raw code. */
export function errorTypeLabelKey(errorType: string): TranslationKey | null {
  const v = errorType.toLowerCase()
  if (v.includes('unanswered') || v.includes('no_kb') || v.includes('kb_match')) return 'errors.type.unanswered'
  if (v.includes('transcription')) return 'errors.type.transcription'
  if (v.includes('intent')) return 'errors.type.intent'
  if (v.includes('low_confidence') || v.includes('bad_response')) return 'errors.type.lowConfidence'
  if (v.includes('calendar') || v.includes('gcal') || v.includes('booking')) return 'errors.type.calendar'
  if (v.includes('template')) return 'errors.type.template'
  if (isDeliveryFailure(v)) return 'errors.type.sendFailed'
  if (v.includes('safety') || v.includes('medical')) return 'errors.type.safety'
  return null
}

/** Title-case a snake/kebab worker code for display when no localized label exists. */
export function humanizeErrorType(errorType: string): string {
  return errorType
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/** Derive the triage metadata for one error review. */
export function errorReviewMeta(error: ErrorReview): ErrorReviewMeta {
  const context = error.context ?? {}
  const type = error.errorType.toLowerCase()
  const open = error.status === 'open'

  const patientSafety = isPatientSafety(type)
  const delivery = isDeliveryFailure(type)

  // Human mode: the worker paused the bot / escalated, or the conversation was
  // already secretary-driven, or it is a safety case (always escalated to a human).
  const mode: ErrorMode =
    ctxString(context, 'mode') === 'human' ||
    ctxFlag(context, 'botPaused', 'escalated', 'handoff', 'humanMode') ||
    patientSafety
      ? 'human'
      : 'bot'

  // Handoff pending: still open and something a person must pick up — an explicit
  // handoff flag, a failed send, a low-confidence answer, or a booking conflict.
  const handoffPending =
    open &&
    (ctxFlag(context, 'handoff', 'awaitingHuman') ||
      delivery ||
      /handoff|escalat|low_confidence|booking_conflict|conflict/.test(type))

  // Urgent: open and either a safety case or a blocked patient reply.
  const urgent = open && (patientSafety || delivery)

  const phone = ctxString(
    context,
    'recipient',
    'recipientWaId',
    'patientWaId',
    'waId',
    'phone',
    'from',
    'to',
  )
  const name = ctxString(context, 'patientName', 'name', 'contactName') ?? phone ?? ''
  const channel = ctxString(context, 'channel')

  // The raw inbound, for the conversation excerpt. unanswered_question stores the
  // patient's own message as errorMessage, so use that when context has nothing.
  const patientMessage =
    ctxString(context, 'rawMessage', 'message', 'inbound', 'text') ??
    (type.includes('unanswered') || type.includes('intent') ? error.errorMessage : null)

  return {
    mode,
    urgent,
    patientSafety,
    handoffPending,
    resolved: !open,
    contact: { name, phone, channel },
    patientMessage,
    typeLabelKey: errorTypeLabelKey(type),
  }
}

export interface QueueStats {
  urgent: number
  open: number
  handoff: number
  resolved7d: number
  patientCount: number
}

/** Roll up the stat-strip counters from the full (date-ranged) error set. */
export function queueStats(errors: ErrorReview[], now: number): QueueStats {
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000
  const patients = new Set<string>()
  let urgent = 0
  let open = 0
  let handoff = 0
  let resolved7d = 0
  for (const e of errors) {
    const meta = errorReviewMeta(e)
    if (e.status === 'open') {
      open += 1
      if (meta.urgent) urgent += 1
      if (meta.handoffPending) handoff += 1
      const who = meta.contact.phone ?? meta.contact.name
      if (who) patients.add(who)
    } else if (e.status === 'resolved') {
      const at = e.resolvedAt ? new Date(e.resolvedAt).getTime() : NaN
      if (!Number.isNaN(at) && at >= weekAgo) resolved7d += 1
    }
  }
  return { urgent, open, handoff, resolved7d, patientCount: patients.size }
}
