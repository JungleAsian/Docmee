import { toneInstruction, wrapUntrustedKb, injectionGuard, type BotTone, type KbMatch, type KbAnswerEvidence } from '../botbase/index.js'
import { parseAiAgentScenarios } from './workflow-engine.js'

export type AiAgentKnowledgePolicy = 'strict_kb' | 'clinic_kb_and_general_education'

export function resolveAiAgentKnowledgePolicy(config: Record<string, unknown> | undefined): AiAgentKnowledgePolicy {
  return config?.['knowledgePolicy'] === 'clinic_kb_and_general_education'
    ? 'clinic_kb_and_general_education'
    : 'strict_kb'
}

/** Allows bounded educational definitions, while clinic facts and individual care stay fail-closed. */
export function isSafeGeneralEducationQuestion(message: string): boolean {
  const text = message.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/^[¿?¡!\s]+/, '')
  const asksForEducation = /^(?:what (?:is|are|causes|causes the|does)|explain|tell me about|general information about|que (?:es|son|causa)|explica|informacion general sobre)\b/.test(text)
  if (!asksForEducation) return false
  const clinicFact = /\b(?:clinic|doctor|hours?|open|address|location|phone|telephone|price|cost|appointment|booking|availability|insurance|policy|clinica|doctor(?:a)?|horario|abre|direccion|ubicacion|telefono|precio|costo|cita|reserva|disponibilidad|seguro|politica)\b/
  const personalized = /\b(?:i|i'm|im|my|mine|me|should i|can i|do i|am i|tengo|mi|mis|debo|puedo|siento|me duele)\b/
  return !clinicFact.test(text) && !personalized.test(text)
}

export function buildAiAgentSystemPrompt(input: {
  clinicName: string
  personality: string
  customInstructions: string
  style: BotTone
  scenarios: { id: string; description: string }[]
  kbMatches?: KbMatch[]
  clinicAddress?: string | null
  clinicPhone?: string | null
  clinicType?: string | null
  knowledgePolicy?: AiAgentKnowledgePolicy
}): string {
  const scenarioLines = input.scenarios.length
    ? input.scenarios.map((s) => `- ${s.id}: ${s.description}`).join('\n')
    : '(no scenarios configured)'
  const kbMatches = input.kbMatches ?? []
  const kbContext = kbMatches.length
    ? kbMatches.map((m) => `# ${m.title}\n${m.content}`).join('\n\n')
    : ''
  const policy = input.knowledgePolicy ?? 'strict_kb'
  const knowledgeInstruction = policy === 'clinic_kb_and_general_education'
    ? 'The clinic Knowledge Base is the only source of truth for clinic-specific facts such as doctors, services, hours, location, prices, policies, availability, and booking. You may use general model knowledge only for a non-personalized educational definition or explanation. Never use it for diagnosis, treatment selection, medication or dosage, personalized advice, emergencies, or missing clinic facts; choose handoff instead.'
    : 'The clinic Knowledge Base is your authoritative source of truth (the clinic bible). Use it as the priority source for every clinic-specific fact. Never invent, infer, or import facts from general model knowledge. If the Knowledge Base does not contain the requested information, choose a handoff or no-match scenario instead of answering the gap.'
  return [
    `You are the AI agent for ${input.clinicName}, deciding how to route this WhatsApp conversation.`,
    knowledgeInstruction,
    `Tone: ${toneInstruction(input.style)}`,
    input.personality ? `Personality: ${input.personality}` : '',
    input.customInstructions ? `Instructions: ${input.customInstructions}` : '',
    kbContext ? wrapUntrustedKb(kbContext) : '',
    injectionGuard(input.clinicName),
    'Scenarios you can match the patient\'s message against (id: description):',
    scenarioLines,
    [
      'Respond in EXACTLY this format, nothing else:',
      'SCENARIO: <the id of the single best-matching scenario, or NONE if nothing fits>',
      'CONFIDENCE: <your independent answer confidence from 0 to 1; never use retrieval similarity>',
      policy === 'clinic_kb_and_general_education'
        ? 'For clinic-specific facts, use only complete, unchanged sentences from the supplied current KB. For an allowed general educational question, give a short general explanation without diagnosing or recommending care. If neither rule supports an answer, select handoff.'
        : 'For a factual REPLY use only complete, unchanged sentences from the supplied current KB. If no exact supported answer exists, select handoff; do not paraphrase or add general knowledge.',
      'REPLY:',
      '<your reply to the patient, in their language — ONLY when the matched scenario is a reply scenario, otherwise leave this blank>',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

/** Parse the strict `SCENARIO: ...` / `REPLY: ...` completion format
 *  `buildAiAgentSystemPrompt` instructs the model to use. Defensive: any
 *  unparseable or `NONE` completion returns a null scenarioId — the caller
 *  treats that as "no match", never as an LLM failure (that's `error`,
 *  reserved for the chatComplete call itself throwing). */
export function parseAiAnswerConfidence(raw: string): number | null {
  const match = raw.match(/^CONFIDENCE:\s*(0(?:\.\d+)?|1(?:\.0+)?)\s*$/im)
  return match ? Number(match[1]) : null
}

export function parseAiAgentCompletion(raw: string): { scenarioId: string | null; reply: string } {
  const scenarioMatch = raw.match(/SCENARIO:\s*(\S+)/i)
  const scenarioId = scenarioMatch && scenarioMatch[1]!.toUpperCase() !== 'NONE' ? scenarioMatch[1]!.trim() : null
  const replyMatch = raw.match(/REPLY:\s*([\s\S]*)$/i)
  const reply = replyMatch ? replyMatch[1]!.trim() : ''
  return { scenarioId, reply }
}

export function catchAllReplyScenario(scenarios: ReturnType<typeof parseAiAgentScenarios>) {
  const replyScenarios = scenarios.filter((s) => s.action === 'reply')
  if (replyScenarios.length !== 1) return undefined
  const description = replyScenarios[0]!.description.toLowerCase()
  return /\b(any|all|general|question|inquiry|consulta|pregunta)\b/.test(description)
    ? replyScenarios[0]
    : undefined
}


/** Shared last gate for live delivery and the side-effect-free teaching preview. */
export function aiAgentHandoffReason(evidence: KbAnswerEvidence, confidence: number | null, sourcesCurrent: boolean): string | null {
  return !sourcesCurrent ? 'stale_or_missing_sources'
    : evidence.groundingScore < 1 ? 'ungrounded_answer'
    : evidence.contradiction !== 'clear' ? 'contradiction_unknown'
    : confidence === null || confidence < .8 ? 'low_answer_confidence'
    : evidence.risks.some(risk => ['prompt_injection', 'privacy'].includes(risk)) ? 'unsafe_answer' : null
}

export function buildAiAgentFallbackPrompt(clinicName: string, instructions: string, preferredLanguage: string, kbContext: string,
  knowledgePolicy: AiAgentKnowledgePolicy = 'strict_kb'): string {
  return [
    `You are the AI assistant for ${clinicName}.`,
    instructions || 'Answer the patient kindly and accurately.',
    preferredLanguage ? `The patient selected ${preferredLanguage}. Reply in ${preferredLanguage} unless the patient explicitly asks to switch languages.` : '',
    knowledgePolicy === 'clinic_kb_and_general_education'
      ? 'Use the supplied Knowledge Base for every clinic-specific fact. General model knowledge is allowed only for a short non-personalized educational explanation; never diagnose, prescribe, recommend treatment, give dosage, or fill a clinic-information gap.'
      : 'Use only the supplied Knowledge Base context. If exact details are not in the Knowledge Base, say a secretary can help; never fill gaps from general model knowledge.',
    knowledgePolicy === 'clinic_kb_and_general_education'
      ? 'For clinic facts, use only complete, unchanged KB sentences. For allowed general education, answer briefly from general knowledge. Return CONFIDENCE: <independent number 0 to 1> then REPLY: followed by the answer. Confidence must assess this answer, not the earlier scenario selection.'
      : 'Use only complete, unchanged KB sentences. Return CONFIDENCE: <independent number 0 to 1> then REPLY: followed by the answer. Confidence must assess this answer, not the earlier scenario selection.',
    kbContext ? wrapUntrustedKb(kbContext) : '',
  ].filter(Boolean).join('\n\n')
}

export async function withAiAgentReplyTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ai_agent_timeout')), 15_000)
    })])
  } finally { if (timer) clearTimeout(timer) }
}
