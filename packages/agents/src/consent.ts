// Patient consent / opt-out keywords (Req 19 Meta Compliance).
//
// Meta/WhatsApp require an unsubscribe path: a patient who replies STOP (or the
// Spanish equivalent) must stop receiving messages, and must be able to re-enable
// them later. Detection is a deterministic keyword check — NOT the LLM intent
// classifier — so STOP works even when the model is stubbed (local/test) or
// misclassifies, and so it can run before any other routing branch. The worker
// persists the decision to the patient so it sticks across turns; this module is
// pure predicates so it can be unit-tested in isolation, matching handoff.ts.
import type { Language } from './botbase/language-detector.js'

/**
 * Normalize an inbound message for keyword matching: lower-case, strip accents and
 * punctuation, collapse whitespace. So "¡STOP!" and "baja" and "Suscripción" all
 * reduce to a bare comparable token.
 */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

function normalize(message: string): string {
  return message
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // strip combining accents
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space
    .replace(/\s+/g, ' ')
    .trim()
}

// Opt-out commands (ES + EN). Matched on EXACT normalized equality so a standalone
// command opts the patient out, but the words appearing inside a sentence do not
// (e.g. "quiero cancelar mi cita" must reach calbot to cancel an appointment, and
// "stop by the clinic tomorrow" is an ordinary question — neither opts out).
const OPT_OUT_KEYWORDS = new Set([
  'stop',
  'unsubscribe',
  'cancel',
  'end',
  'baja',
  'dar de baja',
  'darme de baja',
  'cancelar suscripcion',
  'cancela suscripcion',
  'no mas mensajes',
  'no quiero mas mensajes',
  'no enviar mas mensajes',
  'dejar de recibir mensajes',
  'detener',
  'detener mensajes',
  'parar',
])

// Opt-in / re-subscribe commands (ES + EN), also matched on exact equality.
const OPT_IN_KEYWORDS = new Set([
  'start',
  'unstop',
  'subscribe',
  'alta',
  'darme de alta',
  'suscribir',
  'suscribirme',
  'reactivar',
  'reactivar mensajes',
  'quiero recibir mensajes',
])

/**
 * True when the patient sends an explicit opt-out command (STOP / BAJA / …). The
 * worker then persists patients.metadata.optedOut and stays silent on every later
 * turn. Bare-keyword match only, so appointment-cancel phrasing is not swept up.
 */
export function isOptOutMessage(message: string): boolean {
  return OPT_OUT_KEYWORDS.has(normalize(message))
}

/**
 * True when an opted-out patient sends an explicit re-subscribe command
 * (START / ALTA / …). The worker clears the opt-out and confirms.
 */
export function isOptInMessage(message: string): boolean {
  return OPT_IN_KEYWORDS.has(normalize(message))
}

/** Patient-facing confirmation sent when a patient re-enables messages (START). */
export function optInConfirmation(language: Language): string {
  return language === 'es'
    ? 'Listo, has vuelto a activar los mensajes. ¿En qué puedo ayudarte?'
    : 'Done — messages are re-enabled. How can I help you?'
}
