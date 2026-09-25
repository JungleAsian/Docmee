import { detectLanguage, type Language } from './language-detector.js'
import { expandKbQuery } from './kb-retriever.js'

export type KbIntent = 'hours' | 'booking' | 'location' | 'pricing' | 'policy' | 'medical' | 'general'
export type KbRiskClass = 'medical' | 'pricing' | 'policy' | 'privacy' | 'general'

export interface KbQueryScope {
  language?: Language
  doctorId?: string | null
}

export interface KbQueryPlan {
  normalizedQuery: string
  expandedQuery: string
  language: Language
  doctorId: string | null
  intent: KbIntent
  riskClass: KbRiskClass
  timeSensitive: boolean
}

const INTENT_PATTERNS: Array<[KbIntent, RegExp]> = [
  ['hours', /\b(hours?|horarios?|open|opening|abiert[oa]s?)\b/i],
  ['booking', /\b(appointment|booking|schedule|citas?|reservar|agendar)\b/i],
  ['location', /\b(address|location|where|direcci[oó]n|ubicaci[oó]n|d[oó]nde)\b/i],
  ['pricing', /\b(price|cost|fee|insurance|precio|costo|seguro)\b/i],
  ['policy', /\b(policy|cancel|refund|late|pol[ií]tica|cancelar|reembolso)\b/i],
  ['medical', /\b(diagnos|treat|symptom|rash|pain|medicine|medication|diagn[oó]st|trat|s[ií]ntoma|dolor|medic)\w*/i],
]

export function planKbQuery(question: string, scope: KbQueryScope = {}): KbQueryPlan {
  const normalizedQuery = question.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const intent = INTENT_PATTERNS.find(([, pattern]) => pattern.test(normalizedQuery))?.[0] ?? 'general'
  const inferredLanguage = /[¿¡]|\b(cu[aá]les?|horarios?|citas?|direcci[oó]n|ubicaci[oó]n|precio|seguro|hoy|ahora)\b/i.test(normalizedQuery)
    ? 'es'
    : detectLanguage(normalizedQuery)
  const riskClass: KbRiskClass = intent === 'medical'
    ? 'medical'
    : intent === 'pricing'
      ? 'pricing'
      : intent === 'policy'
        ? 'policy'
        : /\b(ssn|social security|password|credit card|medical record|contrase[nñ]a|tarjeta)\b/i.test(normalizedQuery)
          ? 'privacy'
          : 'general'

  return {
    normalizedQuery,
    expandedQuery: expandKbQuery(normalizedQuery),
    language: scope.language ?? inferredLanguage,
    doctorId: scope.doctorId ?? null,
    intent,
    riskClass,
    timeSensitive: /\b(today|tonight|now|current|hours?|availability|hoy|ahora|actual|horarios?|disponibilidad)\b/i.test(normalizedQuery),
  }
}
