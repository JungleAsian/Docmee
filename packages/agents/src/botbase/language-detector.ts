// First-message language detection (ES vs EN). Simple keyword heuristic — the
// LLM handles nuance once a language is chosen; this only seeds the first turn.

export type Language = 'es' | 'en'

const SPANISH_INDICATORS = [
  'hola', 'buenos', 'buenas', 'quiero', 'necesito', 'cita',
  'doctor', 'gracias', 'por favor', 'tengo', 'puedo', 'puede',
  'cuánto', 'cuanto', 'cuándo', 'cuando', 'dónde', 'donde',
]

export function detectLanguage(text: string): Language {
  const lower = text.toLowerCase()
  const spanishScore = SPANISH_INDICATORS.filter((w) => lower.includes(w)).length
  return spanishScore >= 1 ? 'es' : 'en'
}
