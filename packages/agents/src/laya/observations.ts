import type { LayaCandidate, LayaLanguage } from './adapter.js'

/**
 * Helpers for collecting real "typed text → option the patient then tapped" pairs.
 * The pairs are the ground truth LAYA is later measured and calibrated against.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi
const URL = /\b(?:https?:\/\/|www\.)\S+/gi
// Phone-like runs: 7+ digits, allowing spaces, dots, dashes, parentheses and a leading +.
const PHONE = /\+?\d[\d\s().-]{5,}\d/g
const LONG_NUMBER = /\d{5,}/g

/** Removes contact details and identifier-like numbers. Names cannot be detected reliably
 * and are not removed, so stored text stays clinic-scoped, RLS-protected and short-lived. */
export function redactPatientText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(URL, '[link]')
    .replace(PHONE, match => (match.replace(/\D/g, '').length >= 7 ? '[phone]' : match))
    .replace(LONG_NUMBER, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1600)
}

const SPANISH = ['hola', 'buenos', 'buenas', 'quiero', 'necesito', 'cita', 'gracias', 'por favor', 'tengo',
  'puedo', 'cuánto', 'cuanto', 'cuándo', 'cuando', 'dónde', 'donde', 'precio', 'horario', 'cancelar', 'seguro']
const ENGLISH = ['hello', 'hi', 'want', 'need', 'appointment', 'book', 'thanks', 'please', 'price', 'how much',
  'when', 'where', 'hours', 'cancel', 'change', 'insurance', 'doctor', 'secretary']
const words = (text: string) => ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ')} `

/** Coarse language bucket. LAYA thresholds are kept per task and language. */
export function layaLanguageOf(text: string): LayaLanguage {
  const padded = words(text)
  const es = SPANISH.some(word => padded.includes(` ${word} `))
  const en = ENGLISH.some(word => padded.includes(` ${word} `))
  if (es && en) return 'mixed'
  if (es) return 'es'
  if (en) return 'en'
  return 'unknown'
}

/** Typed replies worth recording: not empty, not a footer shortcut, not a bare option number. */
export function isObservableTypedReply(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 2 || trimmed.length > 1600) return false
  if (/^\d{1,2}$/.test(trimmed)) return false
  return /\p{L}/u.test(trimmed)
}

/** Menu options → LAYA branch candidates (titles only: the fine-tuned menu model was trained on
 * titles, and long descriptions push 7-option menus past the runtime deadline).
 * Null when the menu cannot be scored (LAYA takes 1–7). */
export function menuBranchCandidates(
  options: { optionId: string; title: string; description?: string }[],
): LayaCandidate[] | null {
  const usable = options.filter(option => option.optionId && option.title && option.optionId !== '__more__')
  if (usable.length < 1 || usable.length > 7) return null
  const candidates = usable.map(option => ({
    id: option.optionId.slice(0, 128),
    label: option.title.slice(0, 1200),
  }))
  return new Set(candidates.map(candidate => candidate.id)).size === candidates.length ? candidates : null
}


/** Node types that commit a booking change. LAYA picks that lead here get a read-back check first. */
export const LAYA_COMMITTING_NODE_TYPES = ['action.create_booking', 'action.reschedule_booking', 'action.cancel_booking'] as const

/** Menu options whose edge leads straight to a node that creates, moves or cancels a booking. */
export function layaCommittingMenuOptions(
  nodes: { id: string; type: string }[],
  edges: { source: string; target: string; sourceHandle?: string | null }[],
): Map<string, Set<string>> {
  const committing = new Set(nodes.filter(node => (LAYA_COMMITTING_NODE_TYPES as readonly string[]).includes(node.type)).map(node => node.id))
  const out = new Map<string, Set<string>>()
  for (const edge of edges) {
    if (!edge.sourceHandle || !committing.has(edge.target)) continue
    const set = out.get(edge.source) ?? new Set<string>()
    set.add(edge.sourceHandle)
    out.set(edge.source, set)
  }
  return out
}

const YES = new Set(['yes', 'y', 'yeah', 'yep', 'sure', 'ok', 'okay', 'confirm', 'confirmed', 'correct', 'right',
  'si', 'sí', 'confirmo', 'confirmar', 'confirmado', 'correcto', 'dale', 'claro', 'va', 'listo'])
const NEGATIONS = new Set(['no', 'not', 'dont', "don't", 'nope', 'nop', 'wrong', 'incorrect', 'cancel', 'never',
  'nunca', 'tampoco', 'incorrecto', 'equivocado', 'mal', 'ni'])

/**
 * Reply to a read-back check. Only a clear yes confirms: the first word is a yes-word and no
 * negation appears anywhere. Everything else (no, mixed, unrelated text) is a rejection.
 */
export function readbackConfirmed(text: string): boolean {
  const words = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\s']/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length > 6) return false
  if (words.some(word => NEGATIONS.has(word))) return false
  return YES.has(words[0]!) || (words[0] === 'de' && words[1] === 'acuerdo')
}

/** What LAYA understood, echoed back so the patient can correct it. */
export function layaReadbackText(kind: 'routed' | 'confirm', language: string, title: string, patientText = ''): string {
  const quoted = patientText.trim().slice(0, 120)
  if (language === 'es') {
    return kind === 'routed'
      ? `Entendí: “${title}”. ¿No es correcto? Responda 0 para volver al menú principal.`
      : `Usted escribió: “${quoted}”. Entendí: “${title}”. Responda SÍ para continuar o NO para elegir otra opción.`
  }
  return kind === 'routed'
    ? `Got it: “${title}”. Not right? Reply 0 for the main menu.`
    : `You wrote: “${quoted}”. I understood: “${title}”. Reply YES to continue or NO to choose again.`
}
