import type { Language } from './language-detector.js'

export type GuardrailPreset = 'strict' | 'balanced' | 'lenient'

export interface LocalizedGuardrailText {
  es?: string
  en?: string
}

export interface GuardrailSettings {
  version: 1
  contentBoundaries: {
    additionalBlockedTopics: string[]
    customDeflectionMessage?: LocalizedGuardrailText
  }
  groundingStrictness: {
    minKbConfidence: number
    allowGeneralKnowledgeFallback: false
  }
  escalation: {
    customTriggerKeywords: string[]
  }
  toneGuardrails: {
    maxReplyLength?: number
    disallowEmojis?: boolean
    requireDisclaimerFooter?: boolean
    disclaimerText?: LocalizedGuardrailText
  }
}

export const GUARDRAIL_PRESET_THRESHOLDS: Record<GuardrailPreset, number> = {
  strict: 0.85,
  balanced: 0.78,
  lenient: 0.7,
}

export const MIN_GUARDRAIL_CONFIDENCE = 0.6

export const ALWAYS_ON_GUARDRAILS = [
  { id: 'grounded', description: 'Clinic answers use approved clinic knowledge and otherwise hand off to staff.' },
  { id: 'medical', description: 'The assistant cannot diagnose, prescribe, recommend medications, or provide dosage.' },
  { id: 'human', description: 'Human ownership, emergencies, consent, and direct handoffs stop automation.' },
  { id: 'prompt', description: 'Patient input and knowledge content cannot override protected instructions.' },
] as const

export function defaultGuardrails(): GuardrailSettings {
  return {
    version: 1,
    contentBoundaries: { additionalBlockedTopics: [] },
    groundingStrictness: { minKbConfidence: GUARDRAIL_PRESET_THRESHOLDS.balanced, allowGeneralKnowledgeFallback: false },
    escalation: { customTriggerKeywords: [] },
    toneGuardrails: {},
  }
}

function strings(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.slice(0, maxLength)))]
    .slice(0, maxItems)
}

function localized(value: unknown, maxLength: number): LocalizedGuardrailText | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const es = typeof raw.es === 'string' ? raw.es.trim().slice(0, maxLength) : ''
  const en = typeof raw.en === 'string' ? raw.en.trim().slice(0, maxLength) : ''
  return es || en ? { ...(es ? { es } : {}), ...(en ? { en } : {}) } : undefined
}

/** Defensive reader for persisted JSONB. Invalid legacy values fall back to safe defaults. */
export function readGuardrails(settings: unknown): GuardrailSettings {
  const raw = settings && typeof settings === 'object'
    ? (settings as Record<string, unknown>).guardrails
    : undefined
  if (!raw || typeof raw !== 'object') return defaultGuardrails()
  const value = raw as Record<string, unknown>
  const content = value.contentBoundaries && typeof value.contentBoundaries === 'object'
    ? value.contentBoundaries as Record<string, unknown>
    : {}
  const grounding = value.groundingStrictness && typeof value.groundingStrictness === 'object'
    ? value.groundingStrictness as Record<string, unknown>
    : {}
  const escalation = value.escalation && typeof value.escalation === 'object'
    ? value.escalation as Record<string, unknown>
    : {}
  const tone = value.toneGuardrails && typeof value.toneGuardrails === 'object'
    ? value.toneGuardrails as Record<string, unknown>
    : {}
  const threshold = typeof grounding.minKbConfidence === 'number' && Number.isFinite(grounding.minKbConfidence)
    ? Math.min(1, Math.max(MIN_GUARDRAIL_CONFIDENCE, grounding.minKbConfidence))
    : GUARDRAIL_PRESET_THRESHOLDS.balanced
  const maxReplyLength = typeof tone.maxReplyLength === 'number' && Number.isInteger(tone.maxReplyLength)
    ? Math.min(1600, Math.max(100, tone.maxReplyLength))
    : undefined
  return {
    version: 1,
    contentBoundaries: {
      additionalBlockedTopics: strings(content.additionalBlockedTopics, 30, 120),
      ...(localized(content.customDeflectionMessage, 800) ? { customDeflectionMessage: localized(content.customDeflectionMessage, 800) } : {}),
    },
    groundingStrictness: { minKbConfidence: threshold, allowGeneralKnowledgeFallback: false },
    escalation: { customTriggerKeywords: strings(escalation.customTriggerKeywords, 30, 120) },
    toneGuardrails: {
      ...(maxReplyLength ? { maxReplyLength } : {}),
      ...(tone.disallowEmojis === true ? { disallowEmojis: true } : {}),
      ...(tone.requireDisclaimerFooter === true ? { requireDisclaimerFooter: true } : {}),
      ...(localized(tone.disclaimerText, 800) ? { disclaimerText: localized(tone.disclaimerText, 800) } : {}),
    },
  }
}

export function guardrailPresetForThreshold(threshold: number): GuardrailPreset | 'custom' {
  if (threshold === GUARDRAIL_PRESET_THRESHOLDS.strict) return 'strict'
  if (threshold === GUARDRAIL_PRESET_THRESHOLDS.lenient) return 'lenient'
  if (threshold === GUARDRAIL_PRESET_THRESHOLDS.balanced) return 'balanced'
  return 'custom'
}

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

export function matchesGuardrailTopic(message: string, topics: string[]): boolean {
  const haystack = normalize(message)
  return topics.some((topic) => {
    const candidate = normalize(topic.trim())
    return candidate.length >= 2 && haystack.includes(candidate)
  })
}

function localizedText(value: LocalizedGuardrailText | undefined, language: Language): string {
  return (value?.[language] ?? value?.es ?? value?.en ?? '').trim()
}

export function guardrailDeflection(language: Language, guardrails: GuardrailSettings): string {
  return localizedText(guardrails.contentBoundaries.customDeflectionMessage, language) ||
    (language === 'es'
      ? 'No puedo ayudar con ese tema. Voy a conectarte con el equipo de la clínica.'
      : 'I cannot help with that topic. I am connecting you with the clinic team.')
}

function trimReply(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const slice = value.slice(0, Math.max(1, maxLength - 1))
  const boundary = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf('\n'))
  return `${(boundary > maxLength * 0.55 ? slice.slice(0, boundary) : slice).trimEnd()}…`
}

/** Applies clinic preferences after immutable medical and prompt-safety screening. */
export function applyReplyGuardrails(reply: string, language: Language, guardrails: GuardrailSettings): string {
  let result = guardrails.toneGuardrails.disallowEmojis
    ? reply.replace(/\p{Extended_Pictographic}|\uFE0F/gu, '').replace(/\s{2,}/g, ' ').trim()
    : reply.trim()
  if (guardrails.toneGuardrails.maxReplyLength) result = trimReply(result, guardrails.toneGuardrails.maxReplyLength)
  if (guardrails.toneGuardrails.requireDisclaimerFooter) {
    const footer = localizedText(guardrails.toneGuardrails.disclaimerText, language)
    if (footer) result = `${result}\n\n${footer}`
  }
  return result
}

export function guardrailPromptInstructions(guardrails: GuardrailSettings): string {
  const instructions = [
    `Use only clinic Knowledge Base evidence with confidence at or above ${guardrails.groundingStrictness.minKbConfidence.toFixed(2)}; otherwise hand off to staff.`,
    guardrails.contentBoundaries.additionalBlockedTopics.length
      ? `Do not answer these clinic-blocked topics; hand off instead: ${guardrails.contentBoundaries.additionalBlockedTopics.join(', ')}.`
      : '',
    guardrails.toneGuardrails.maxReplyLength
      ? `Keep the response within ${guardrails.toneGuardrails.maxReplyLength} characters.`
      : '',
    guardrails.toneGuardrails.disallowEmojis ? 'Do not use emoji.' : '',
  ].filter(Boolean)
  return instructions.join('\n')
}
