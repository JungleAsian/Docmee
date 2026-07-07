// Outbound medical-safety screen (Req 20, defense-in-depth).
//
// The clinic bot's system prompt already forbids diagnosing, prescribing or
// giving dosages (see buildSystemPrompt in clinic-bot.ts), but a prompt is not a
// guarantee — an LLM can still produce unsafe content under an edge case, a
// jailbreak, or a misleading KB chunk. This module is the second layer: it scans
// the GENERATED reply before it ever reaches the patient. A hit means the reply
// is dropped, a safe deferral is sent instead, and the turn is handed to a human.
//
// Design bias: medical safety is a critical requirement, so the screen errs on
// the side of caution. The dosage patterns are extremely high precision (a number
// with a medical unit, a pill count, a dosing frequency — essentially never part
// of a legitimate booking/hours reply). The prescription/diagnosis phrase lists
// are deliberately narrow and medication-leaning; a rare benign phrasing (e.g.
// "te recomiendo tomar agua") may be deferred to a human, which is the safe
// direction for a clinic bot.

import type { Language } from './language-detector.js'

export type MedicalSafetyCategory = 'dosage' | 'prescription' | 'diagnosis'

export interface MedicalSafetyResult {
  safe: boolean
  category?: MedicalSafetyCategory
  /** The offending substring/phrase, for the operator's error-review record. */
  match?: string
}

/** Lowercase + strip accents so 'cápsulas' and 'capsulas' match the same rule. */
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g')

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(COMBINING_MARKS, '')
}

// Dosage signals (ES + EN). Each is a strong, high-precision indicator that the
// reply is dispensing medication instructions rather than clinic logistics.
const DOSAGE_PATTERNS: RegExp[] = [
  // "500 mg", "5ml", "10 ui", "0.5 mcg"
  /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ug|ml|cc|ui|iu)\b/,
  // "2 comprimidos", "1 tablet", "tres cápsulas" → require a leading number.
  /\b\d+\s*(?:comprimidos?|tabletas?|pastillas?|capsulas?|grageas?|tablets?|pills?|capsules?)\b/,
  // Dosing frequency: "cada 8 horas", "every 6 hours".
  /\bcada\s+\d+\s*(?:horas?|h|dias?)\b/,
  /\bevery\s+\d+\s*(?:hours?|hrs?|h|days?)\b/,
  // "3 veces al día", "2 times a day".
  /\b\d+\s*(?:veces?\s+al\s+dia|times?\s+(?:a|per)\s+day)\b/,
]

// Explicit medication-recommendation phrasings (normalized). Kept narrow so a
// general "we recommend you visit the clinic" never trips the screen.
const PRESCRIPTION_PHRASES = [
  'te receto',
  'le receto',
  'te recetare',
  'le recetare',
  'i prescribe',
  'i am prescribing',
  'i will prescribe',
  'i would prescribe',
  'i recommend you take',
  'i recommend taking',
  'i suggest you take',
  'te recomiendo tomar',
  'le recomiendo tomar',
]

// Explicit diagnostic phrasings (normalized). Each asserts a condition, which the
// bot must never do.
const DIAGNOSIS_PHRASES = [
  'te diagnostico',
  'le diagnostico',
  'i diagnose',
  'your diagnosis is',
  'el diagnostico es',
  'tu diagnostico es',
  'padeces de',
  'padece de',
  'sufres de',
  'you suffer from',
  'you probably have',
  'you likely have',
  'it looks like you have',
  'es probable que tengas',
  'parece que tienes',
]

/**
 * Screen an outbound bot reply for prohibited medical content. Returns
 * `{ safe: true }` when the reply is clean, otherwise the violating category and
 * the matched snippet. Dosage is checked first (highest precision), then explicit
 * prescription, then diagnosis.
 */
export function screenMedicalSafety(text: string): MedicalSafetyResult {
  const normalized = normalize(text)

  for (const re of DOSAGE_PATTERNS) {
    const m = normalized.match(re)
    if (m) return { safe: false, category: 'dosage', match: m[0].trim() }
  }
  for (const phrase of PRESCRIPTION_PHRASES) {
    if (normalized.includes(phrase)) return { safe: false, category: 'prescription', match: phrase }
  }
  for (const phrase of DIAGNOSIS_PHRASES) {
    if (normalized.includes(phrase)) return { safe: false, category: 'diagnosis', match: phrase }
  }
  return { safe: true }
}

/**
 * Patient-facing message sent in place of a reply that failed the safety screen.
 * It declines to give medical advice, points the patient to the clinic, and tells
 * them a human is being looped in (the worker pauses the bot + alerts a person).
 */
export function medicalSafetyDeferral(language: Language): string {
  return language === 'es'
    ? 'Por tu seguridad, no puedo darte un diagnóstico ni indicaciones sobre medicamentos o dosis por este medio. Le pediré a un miembro de nuestro equipo que te contacte, y te recomendamos acudir a la clínica para una valoración.'
    : 'For your safety, I can’t provide a diagnosis or advice about medications or dosages here. I’ll ask a member of our team to contact you, and we recommend visiting the clinic for an assessment.'
}
