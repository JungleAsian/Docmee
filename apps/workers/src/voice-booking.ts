import { chatComplete, defaultChatModel, type ChatProvider } from '@docmee/llm'
import { resolveClinicAiKey } from './clinic-ai-key.js'

const DEFAULT_ALLOWED_FIELDS = [
  'patient_name',
  'phone_number',
  'preferred_date',
  'preferred_time',
  'clinic_location',
  'doctor_preference',
] as const

const MEDICAL_KEYWORDS = [
  'dolor',
  'sangrado',
  'fiebre',
  'emergencia',
  'symptom',
  'symptoms',
  'pain',
  'bleeding',
  'fever',
  'diagnosis',
  'medication',
  'medicine',
]

type AllowedField = (typeof DEFAULT_ALLOWED_FIELDS)[number]

export interface VoiceBookingExtraction {
  transcript: string
  extracted: Partial<Record<AllowedField, string>>
  confidence: 'high' | 'medium' | 'low'
  needsReview: boolean
  containsDisallowedMedicalContent: boolean
  source: 'ai' | 'heuristic'
}

export async function extractVoiceBookingDetails(opts: {
  transcript: string
  clinicSettings: unknown
  allowedFields?: string
  provider?: string
}): Promise<VoiceBookingExtraction> {
  const transcript = opts.transcript.trim()
  const allowedFields = parseAllowedFields(opts.allowedFields)
  const containsDisallowedMedicalContent = hasMedicalContent(transcript)

  if (!transcript) {
    return {
      transcript,
      extracted: {},
      confidence: 'low',
      needsReview: true,
      containsDisallowedMedicalContent,
      source: 'heuristic',
    }
  }

  const ai = await tryAiExtraction({
    transcript,
    clinicSettings: opts.clinicSettings,
    allowedFields,
    provider: opts.provider,
  })

  const extracted = sanitizeExtracted(ai?.extracted ?? heuristicExtract(transcript), allowedFields)
  const confidence = ai?.confidence ?? heuristicConfidence(extracted)
  const needsReview =
    containsDisallowedMedicalContent ||
    confidence === 'low' ||
    Object.keys(extracted).length === 0

  return {
    transcript,
    extracted,
    confidence,
    needsReview,
    containsDisallowedMedicalContent,
    source: ai ? 'ai' : 'heuristic',
  }
}

async function tryAiExtraction(opts: {
  transcript: string
  clinicSettings: unknown
  allowedFields: AllowedField[]
  provider?: string
}): Promise<{ extracted: Partial<Record<AllowedField, string>>; confidence: 'high' | 'medium' | 'low' } | null> {
  const ai = ((opts.clinicSettings as {
    aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string }
  } | null)?.aiAssistant ?? {}) as { chatProvider?: string; model?: string; baseURL?: string }
  const provider = resolveChatProvider(opts.provider, ai.chatProvider)
  const model =
    typeof ai.model === 'string' && ai.model.trim() !== '' ? ai.model.trim() : defaultChatModel(provider)
  const baseURL = typeof ai.baseURL === 'string' && ai.baseURL.trim() !== '' ? ai.baseURL.trim() : undefined
  const apiKey = resolveClinicAiKey(opts.clinicSettings, provider)

  try {
    const raw = await chatComplete({
      provider,
      model,
      apiKey,
      baseURL,
      maxTokens: 300,
      system: [
        'You extract only low-risk clinic booking details from WhatsApp voice note transcripts.',
        'Ignore and do not return medical content, symptoms, diagnosis, or treatment.',
        'Return strict JSON only with keys: patient_name, phone_number, preferred_date, preferred_time, clinic_location, doctor_preference, confidence.',
        'Use null for unknown values. confidence must be "high", "medium", or "low".',
      ].join(' '),
      message: `Transcript:\n${opts.transcript}`,
      history: [],
    })
    const parsed = parseJsonObject(raw)
    if (!parsed) return null
    const extracted = sanitizeExtracted(parsed, opts.allowedFields)
    const confidence = normalizeConfidence(parsed['confidence'])
    return { extracted, confidence }
  } catch (err) {
    console.warn('[voice-booking] AI extraction failed:', err)
    return null
  }
}

function resolveChatProvider(provider?: string, fallback?: string): ChatProvider {
  const raw = (provider || fallback || '').trim()
  return raw === 'openai' || raw === 'custom' || raw === 'gemini' ? raw : 'claude'
}

function parseAllowedFields(raw?: string): AllowedField[] {
  const values = (raw ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is AllowedField =>
      DEFAULT_ALLOWED_FIELDS.includes(value as AllowedField),
    )
  return values.length > 0 ? values : [...DEFAULT_ALLOWED_FIELDS]
}

function sanitizeExtracted(
  input: Record<string, unknown>,
  allowedFields: AllowedField[],
): Partial<Record<AllowedField, string>> {
  const clean: Partial<Record<AllowedField, string>> = {}
  for (const field of allowedFields) {
    const raw = input[field]
    if (typeof raw !== 'string') continue
    const value = raw.trim()
    if (!value) continue
    clean[field] = value
  }
  return clean
}

function normalizeConfidence(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'medium' ? value : 'low'
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function hasMedicalContent(transcript: string): boolean {
  const lower = transcript.toLowerCase()
  return MEDICAL_KEYWORDS.some((keyword) => lower.includes(keyword))
}

function heuristicExtract(transcript: string): Partial<Record<AllowedField, string>> {
  const extracted: Partial<Record<AllowedField, string>> = {}
  const text = transcript.replace(/\s+/g, ' ').trim()

  const phone = text.match(/(?:\+?\d[\d\s()-]{7,}\d)/)
  if (phone) extracted.phone_number = phone[0].trim()

  const time = text.match(/\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s?(?:am|pm)?\b/i)
  if (time) extracted.preferred_time = time[0].trim()

  const date = text.match(
    /\b(?:\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i,
  )
  if (date) extracted.preferred_date = date[0].trim()

  const name =
    text.match(/\b(?:mi nombre es|soy|my name is|this is)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,2})/iu) ??
    text.match(/\b(?:patient|paciente)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,2})/iu)
  if (name?.[1]) extracted.patient_name = name[1].trim()

  const doctor = text.match(/\b(?:dr\.?|doctor|doctora|with)\s+([A-ZÁÉÍÓÚÑ][\p{L}'-]+(?:\s+[A-ZÁÉÍÓÚÑ][\p{L}'-]+){0,2})/iu)
  if (doctor?.[1]) extracted.doctor_preference = doctor[1].trim()

  const location = text.match(/\b(?:branch|location|clinic|sucursal)\s+([A-ZÁÉÍÓÚÑ0-9][\p{L}\d\s'/-]{1,40})/iu)
  if (location?.[1]) extracted.clinic_location = location[1].trim()

  return extracted
}

function heuristicConfidence(extracted: Partial<Record<AllowedField, string>>): 'high' | 'medium' | 'low' {
  const count = Object.keys(extracted).length
  if (count >= 4) return 'high'
  if (count >= 2) return 'medium'
  return 'low'
}
