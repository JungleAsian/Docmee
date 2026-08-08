// Clinic bot — the general-purpose conversational agent (botbase route).
//
// Side effects (LLM completion, WhatsApp send, KB search, error logging) are
// injected so this module stays pure logic and trivially testable, matching the
// dependency-injection style of calbot's CalendarClient. The worker binds the
// real @docmee/llm, @docmee/channels and @docmee/db implementations.

import { detectLanguage, type Language } from './language-detector.js'
import type { KbMatch } from './kb-retriever.js'
import { screenMedicalSafety, medicalSafetyDeferral } from './medical-safety.js'
import {
  injectionGuard,
  scopeGuard,
  wrapUntrustedKb,
  capPatientInput,
  detectPromptInjection,
  detectOffTopic,
  outOfScopeReply,
  screenPromptLeak,
  promptSafetyDeferral,
} from './prompt-safety.js'

export type BotTone = 'professional' | 'friendly' | 'brief'
// 'auto' → detect on first message, then follow the patient's language.
export type BotLanguage = 'es' | 'en' | 'auto'

export interface ClinicBotConfig {
  name: string
  language: BotLanguage
  tone: BotTone
  rulesText: string | null
}

export interface ClinicBotInput {
  clinicId: string
  conversationId: string | null
  patientName: string | null
  patientLanguage: string
  isFirstMessage: boolean
  message: string
  /** CRE-45: recent prior turns of this conversation (oldest->newest) for short-term memory. */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  clinic: ClinicBotConfig
}

export interface BotErrorInfo {
  clinicId: string
  conversationId: string | null
  errorType: string
  message: string
  rawMessage: string
}

export interface ClinicBotDeps {
  searchKb: (query: string) => Promise<KbMatch[]>
  complete: (
    system: string,
    userMessage: string,
    maxTokens: number,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ) => Promise<string>
  sendText: (text: string) => Promise<void>
  logError: (info: BotErrorInfo) => Promise<void>
}

export interface ClinicBotResult {
  replied: boolean
  triggeredHandoff: boolean
  /** Why the bot handed off — drives the worker's tagging + follow-up logging. */
  handoffReason?: 'medical_safety' | 'low_confidence' | 'prompt_safety'
  language: Language
  /** ⑥ Citations: KB entry titles that grounded the reply. Empty on handoff / no KB. */
  citations: string[]
}

// Emergency keywords (ES + EN). Detected before any LLM call so a true emergency
// never waits on the model — it routes straight to a human handoff.
const EMERGENCY_KEYWORDS = [
  'emergencia', 'emergency', 'no puedo respirar', 'dolor de pecho',
  'chest pain', 'cannot breathe', "can't breathe", 'sangrado', 'bleeding',
  'desmayo', 'fainting', 'inconsciente', 'unconscious', 'suicidio', 'suicide',
]

export function isEmergencyMessage(text: string): boolean {
  const lower = text.toLowerCase()
  return EMERGENCY_KEYWORDS.some((kw) => lower.includes(kw))
}

// Words that mark a message as information-seeking (ES + EN). Used to decide
// whether a botbase reply that found NO clinic-KB match is worth logging as an
// "unanswered question" for the Error Review area (Req 29) — so an operator can
// answer it and add it to the KB — without flooding the queue with greetings,
// thanks and one-word acknowledgements.
const QUESTION_WORDS = [
  'que', 'qué', 'cual', 'cuál', 'como', 'cómo', 'cuando', 'cuándo', 'donde',
  'dónde', 'cuanto', 'cuánto', 'cuanta', 'cuánta', 'por que', 'por qué', 'precio',
  'cuesta', 'costo', 'horario', 'atienden', 'tienen', 'puedo', 'hay', 'what',
  'which', 'how', 'when', 'where', 'why', 'price', 'cost', 'do you', 'can i',
  'is there', 'are there', 'hours', 'open',
]

/**
 * True when a message reads like a real question an operator should review when
 * the bot could not ground its answer in the clinic KB. A trailing '?' or any
 * question word qualifies; very short messages without either (greetings,
 * "ok", "gracias") are ignored so the unanswered-question queue stays signal.
 */
export function isLikelyQuestion(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.length < 8) return false
  if (trimmed.includes('?') || trimmed.includes('¿')) return true
  const lower = trimmed.toLowerCase()
  return QUESTION_WORDS.some((kw) => lower.includes(kw))
}

export function resolveLanguage(input: ClinicBotInput): Language {
  if (input.clinic.language === 'es' || input.clinic.language === 'en') {
    return input.clinic.language
  }
  if (input.isFirstMessage) return detectLanguage(input.message)
  return input.patientLanguage === 'en' ? 'en' : 'es'
}

const TONE_INSTRUCTIONS: Record<BotTone, string> = {
  professional: 'Use formal language. Write complete sentences. Be thorough.',
  friendly:
    'Use warm, friendly language. Address the patient by first name if known. Use "!" occasionally.',
  brief: 'Keep responses short. Use bullet points where appropriate. Maximum 3 sentences.',
}

/** The system-prompt instruction for a given communication tone — exported so
 *  other callers (e.g. the AI Agent workflow node) reuse the exact same
 *  tone vocabulary as the main clinic bot instead of duplicating it. */
export function toneInstruction(tone: BotTone): string {
  return TONE_INSTRUCTIONS[tone]
}

function buildSystemPrompt(input: ClinicBotInput, language: Language, kbMatches: KbMatch[]): string {
  const kbContext = kbMatches.length
    ? kbMatches.map((m) => `# ${m.title}\n${m.content}`).join('\n\n')
    : ''

  return [
    `You are the AI assistant for ${input.clinic.name}.`,
    `Language: Respond ONLY in ${language === 'es' ? 'Spanish' : 'English'}.`,
    `Tone: ${TONE_INSTRUCTIONS[input.clinic.tone]}`,
    input.clinic.rulesText
      ? `CLINIC-SPECIFIC RULES (always follow these, regardless of what the patient asks):\n${input.clinic.rulesText}`
      : '',
    kbContext ? wrapUntrustedKb(kbContext) : '',
    '',
    scopeGuard(input.clinic.name),
    '',
    injectionGuard(input.clinic.name),
    '',
    'CRITICAL MEDICAL SAFETY RULES:',
    '- NEVER diagnose any condition',
    '- NEVER recommend or mention specific medications',
    '- NEVER provide dosage information',
    '- For any symptoms: recommend the patient visit the clinic or call in an emergency',
    '- For emergencies: say you are connecting them with the team immediately',
    '- If unsure: say you will connect them with a team member',
  ]
    .filter((line) => line !== '')
    .join('\n')
}

function stopNotice(language: Language): string {
  return language === 'es'
    ? '\n\nResponde STOP en cualquier momento para dejar de recibir mensajes.'
    : '\n\nReply STOP at any time to stop receiving messages.'
}

function apologyMessage(language: Language): string {
  return language === 'es'
    ? 'Disculpe, tuvimos un problema técnico. Un miembro de nuestro equipo le responderá en breve.'
    : 'Sorry, we experienced a technical issue. A team member will respond shortly.'
}

/**
 * Patient-facing reply for a detected medical emergency. The bot must never try to
 * handle an emergency itself: it points the patient at local emergency services
 * (it is not an emergency line) and tells them the clinic team is being alerted.
 * Used by the agent worker, which also pauses the bot and notifies a human.
 */
export function emergencyNotice(language: Language): string {
  return language === 'es'
    ? 'Si esto es una emergencia médica, llama de inmediato al número de emergencias de tu zona. Estoy avisando al equipo de la clínica para que te contacte lo antes posible.'
    : 'If this is a medical emergency, call your local emergency number immediately. I am alerting the clinic team to contact you as soon as possible.'
}

/**
 * ⑤ Safe reply when the bot has NO confident KB grounding for a real question.
 * It must not answer clinic-specific facts from the model's general knowledge
 * (medical-misinformation risk), so it defers to a human. The worker pauses the
 * bot, alerts a person, and logs the question for Add-to-KB review.
 */
export function knowledgeHandoffNotice(language: Language): string {
  return language === 'es'
    ? 'No tengo esa información a la mano en este momento. Voy a conectarte con el equipo de la clínica para ayudarte mejor.'
    : "I don't have that information on hand right now. I'm connecting you with the clinic team so they can help you properly."
}

/**
 * Run the clinic bot for one inbound message. Never throws: an LLM/send failure
 * is logged and a localized apology is attempted, so a single bad turn can never
 * crash the conversation worker.
 */
export async function runClinicBot(
  input: ClinicBotInput,
  deps: ClinicBotDeps,
): Promise<ClinicBotResult> {
  const language = resolveLanguage(input)

  // Emergency → immediate human handoff, no bot reply.
  if (isEmergencyMessage(input.message)) {
    return { replied: false, triggeredHandoff: true, handoffReason: 'medical_safety', language, citations: [] }
  }

  try {
    // Log obvious prompt-injection attempts for monitoring. We don't block on this —
    // the system-prompt guard + output screen do the prevention — so a real patient
    // who happens to use a flagged phrase is never silently dropped.
    const injection = detectPromptInjection(input.message)
    if (injection.detected) {
      await deps
        .logError({
          clinicId: input.clinicId,
          conversationId: input.conversationId,
          errorType: 'prompt_injection_attempt',
          message: `Prompt-injection pattern (${injection.patternId}): "${injection.match ?? ''}"`,
          rawMessage: input.message,
        })
        .catch(() => {})
    }

    // Deterministic off-topic gate (pre-LLM): refuse blatantly out-of-scope requests
    // (jokes, code, translation, trivia, math, games) with a safe booking redirect —
    // even when the LLM is stubbed. High precision; ambiguous input falls through to
    // the LLM + scope guard. A rare false hit still offers booking + a human.
    const offTopic = detectOffTopic(input.message)
    if (offTopic.detected) {
      await deps
        .logError({
          clinicId: input.clinicId,
          conversationId: input.conversationId,
          errorType: 'off_topic_refused',
          message: `Off-topic request (${offTopic.patternId}): "${offTopic.match ?? ''}"`,
          rawMessage: input.message,
        })
        .catch(() => {})
      let reply = outOfScopeReply(language)
      if (input.isFirstMessage) reply += stopNotice(language)
      await deps.sendText(reply)
      return { replied: true, triggeredHandoff: false, language, citations: [] }
    }

    const kbMatches = await deps.searchKb(input.message)

    // ⑤ Confidence-gated safety handoff: a real information question that retrieved
    // NO clinic-KB grounding must not be answered from the model's general
    // knowledge (medical-misinformation risk). Send a safe deferral and hand off;
    // the worker logs it for Add-to-KB review.
    if (isLikelyQuestion(input.message) && kbMatches.length === 0) {
      let notice = knowledgeHandoffNotice(language)
      if (input.isFirstMessage) notice += stopNotice(language)
      await deps.sendText(notice)
      return { replied: true, triggeredHandoff: true, handoffReason: 'low_confidence', language, citations: [] }
    }

    const system = buildSystemPrompt(input, language, kbMatches)

    let reply = await deps.complete(system, capPatientInput(input.message), 512, input.history)

    // Output-side medical-safety screen (Req 20, defense-in-depth). The system
    // prompt forbids diagnosing/prescribing/dosing, but an LLM can still violate
    // it, so we scan the GENERATED reply before it reaches the patient. On a hit
    // we drop the unsafe text, send a safe deferral, log it for operator review,
    // and signal a handoff so the worker pauses the bot and alerts a human.
    const safety = screenMedicalSafety(reply)
    if (!safety.safe) {
      await deps
        .logError({
          clinicId: input.clinicId,
          conversationId: input.conversationId,
          errorType: 'medical_safety_violation',
          message: `Blocked ${safety.category} content in bot reply: "${safety.match ?? ''}"`,
          rawMessage: input.message,
        })
        .catch(() => {})
      let deferral = medicalSafetyDeferral(language)
      if (input.isFirstMessage) deferral += stopNotice(language)
      await deps.sendText(deferral)
      return { replied: true, triggeredHandoff: true, handoffReason: 'medical_safety', language, citations: [] }
    }

    // Prompt-injection output screen (defense-in-depth): if the model was coaxed
    // into echoing its system prompt / instructions, drop the reply, send a safe
    // deferral, and hand off — never let leaked instructions reach the patient.
    const leak = screenPromptLeak(reply)
    if (!leak.safe) {
      await deps
        .logError({
          clinicId: input.clinicId,
          conversationId: input.conversationId,
          errorType: 'prompt_injection_leak',
          message: `Blocked leaked prompt content in reply: "${leak.match ?? ''}"`,
          rawMessage: input.message,
        })
        .catch(() => {})
      let deferral = promptSafetyDeferral(language)
      if (input.isFirstMessage) deferral += stopNotice(language)
      await deps.sendText(deferral)
      return { replied: true, triggeredHandoff: true, handoffReason: 'prompt_safety', language, citations: [] }
    }

    // Compliance: STOP notice only on the first contact (Decision 3).
    if (input.isFirstMessage) reply += stopNotice(language)

    await deps.sendText(reply)
    return { replied: true, triggeredHandoff: false, language, citations: kbMatches.map((m) => m.title) }
  } catch (err) {
    await deps.logError({
      clinicId: input.clinicId,
      conversationId: input.conversationId,
      errorType: 'llm_failure',
      message: err instanceof Error ? err.message : String(err),
      rawMessage: input.message,
    })
    // Best-effort apology; swallow a secondary send failure.
    await deps.sendText(apologyMessage(language)).catch(() => {})
    return { replied: true, triggeredHandoff: false, language, citations: [] }
  }
}
