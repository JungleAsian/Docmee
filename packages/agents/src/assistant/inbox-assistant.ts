// Internal AI Assistant for secretaries (Req 41).
//
// Pure, dependency-injected logic that helps a human secretary inside the Clinic
// Inbox by (a) SUMMARIZING a conversation and (b) DRAFTING reply suggestions
// grounded in the clinic Knowledge Base. This is a STAFF-ONLY aid: nothing here
// sends anything to the patient — the API route returns the text to the panel and
// the secretary reviews/edits/sends manually. Side effects (LLM completion, KB
// search) are injected, mirroring clinic-bot.ts, so this module stays trivially
// testable and free of provider dependencies.

import type { KbMatch } from '../botbase/kb-retriever.js'
import type { Language } from '../botbase/language-detector.js'

/** A single inbox message, in the shape the assistant reasons over. */
export interface AssistantMessage {
  role: 'user' | 'assistant' | 'agent' | 'system'
  content: string
}

export interface InboxAssistantDeps {
  /** Clinic-scoped KB retrieval (already bound to the clinic's chunk set). */
  searchKb: (query: string) => Promise<KbMatch[]>
  /** LLM completion (system, user, maxTokens) → text. */
  complete: (system: string, userMessage: string, maxTokens: number) => Promise<string>
}

export interface SummaryResult {
  summary: string
}

export interface SuggestionSource {
  title: string
  similarity: number
}

export interface SuggestionsResult {
  suggestions: string[]
  /** KB documents the suggestions were grounded in (for "based on" attribution). */
  sources: SuggestionSource[]
}

// Up to 3 drafts per request — enough choice without overwhelming the panel.
export const MAX_SUGGESTIONS = 3
// Delimiter the model is told to place between suggestions. A line of three tildes
// is unlikely to appear inside a natural reply, so splitting on it is robust.
const SUGGESTION_DELIM = '~~~'

function speakerLabel(role: AssistantMessage['role'], language: Language): string {
  if (language === 'es') {
    switch (role) {
      case 'user':
        return 'Paciente'
      case 'assistant':
        return 'Bot'
      case 'agent':
        return 'Personal'
      default:
        return 'Sistema'
    }
  }
  switch (role) {
    case 'user':
      return 'Patient'
    case 'assistant':
      return 'Bot'
    case 'agent':
      return 'Staff'
    default:
      return 'System'
  }
}

/** Render the message list as a labelled transcript for the LLM. */
export function renderTranscript(messages: AssistantMessage[], language: Language): string {
  return messages
    .filter((m) => m.content.trim() !== '')
    .map((m) => `${speakerLabel(m.role, language)}: ${m.content.trim()}`)
    .join('\n')
}

/**
 * The most recent inbound patient message — the natural query for grounding reply
 * suggestions in the KB (what the secretary needs to answer right now). Returns
 * null when the patient has not said anything yet.
 */
export function lastPatientMessage(messages: AssistantMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'user' && m.content.trim() !== '') return m.content.trim()
  }
  return null
}

function buildSummarySystemPrompt(language: Language): string {
  return [
    'You are an internal assistant for a medical clinic, helping a human secretary.',
    'Summarize the following patient conversation for the secretary so they can take over quickly.',
    'Cover: who the patient is (if known), what they want, any appointment details, and the next action the secretary should consider.',
    'Be concise — a few short sentences or bullet points. This summary is for STAFF ONLY and is never shown to the patient.',
    `Write the summary ONLY in ${language === 'es' ? 'Spanish' : 'English'}.`,
  ].join('\n')
}

function buildSuggestionsSystemPrompt(
  clinicName: string,
  rulesText: string | null,
  kbMatches: KbMatch[],
  language: Language,
): string {
  const kbContext = kbMatches.length
    ? kbMatches.map((m) => `# ${m.title}\n${m.content}`).join('\n\n')
    : ''

  return [
    `You are an internal drafting assistant for ${clinicName}, helping a human secretary reply to a patient.`,
    `Propose up to ${MAX_SUGGESTIONS} alternative reply drafts the secretary can review, edit and send.`,
    'Ground every draft strictly in the clinic knowledge base below; if the knowledge base does not cover the question, say you are not sure and suggest the secretary confirm — never invent clinic-specific facts.',
    rulesText
      ? `CLINIC-SPECIFIC RULES (always follow these):\n${rulesText}`
      : '',
    kbContext ? `Knowledge base:\n${kbContext}` : 'Knowledge base: (empty)',
    '',
    'CRITICAL MEDICAL SAFETY RULES (these drafts may be sent to a patient):',
    '- NEVER diagnose any condition',
    '- NEVER recommend or mention specific medications',
    '- NEVER provide dosage information',
    '- For symptoms: suggest the patient visit the clinic or call emergency services if urgent',
    '',
    `Write every draft ONLY in ${language === 'es' ? 'Spanish' : 'English'}.`,
    `Output ONLY the drafts, separated by a line containing exactly "${SUGGESTION_DELIM}". Do not number them or add any other commentary.`,
  ]
    .filter((line) => line !== '')
    .join('\n')
}

/**
 * Split a raw LLM completion into individual reply drafts. Splits on the delimiter,
 * strips any stray leading numbering/bullets, drops blanks and caps the count. When
 * the model returned no delimiter (e.g. a single draft, or a stub response), the
 * whole trimmed text becomes one suggestion.
 */
export function parseSuggestions(raw: string): string[] {
  const parts = raw.includes(SUGGESTION_DELIM) ? raw.split(SUGGESTION_DELIM) : [raw]
  return parts
    .map((p) => p.trim().replace(/^(?:\d+[.)]|[-*•])\s*/, '').trim())
    .filter((p) => p !== '')
    .slice(0, MAX_SUGGESTIONS)
}

/** Summarize a conversation for the secretary. Never sent to the patient. */
export async function summarizeConversation(
  messages: AssistantMessage[],
  language: Language,
  deps: InboxAssistantDeps,
): Promise<SummaryResult> {
  const transcript = renderTranscript(messages, language)
  const system = buildSummarySystemPrompt(language)
  const user = transcript === '' ? '(no messages yet)' : transcript
  const summary = await deps.complete(system, user, 400)
  return { summary: summary.trim() }
}

export interface SuggestRepliesInput {
  messages: AssistantMessage[]
  clinicName: string
  rulesText: string | null
  language: Language
}

/**
 * Draft reply suggestions grounded in the clinic KB. The KB is searched with the
 * latest patient message; the drafts are returned to the panel for the secretary
 * to review/edit/send — they are NEVER sent automatically.
 */
export async function suggestReplies(
  input: SuggestRepliesInput,
  deps: InboxAssistantDeps,
): Promise<SuggestionsResult> {
  const query = lastPatientMessage(input.messages)
  const kbMatches = query ? await deps.searchKb(query) : []
  const system = buildSuggestionsSystemPrompt(
    input.clinicName,
    input.rulesText,
    kbMatches,
    input.language,
  )
  const user = renderTranscript(input.messages, input.language) || '(no messages yet)'
  const raw = await deps.complete(system, user, 600)
  return {
    suggestions: parseSuggestions(raw),
    sources: kbMatches.map((m) => ({ title: m.title, similarity: m.similarity })),
  }
}

// ── Suggest next step ──────────────────────────────────────────────────────
//
// The third assistant pillar (alongside summarize + draft): recommend the single
// best OPERATIONAL next action for the secretary, not patient-facing copy. The
// model must pick exactly one of a fixed, panel-localized action vocabulary so the
// UI can render an unambiguous, colour-coded recommendation; the rationale is the
// staff-only "why". Like every assistant output this is advisory — it never acts.

/** The fixed set of operational next steps the panel can render + localize. */
export const NEXT_STEP_ACTIONS = [
  'urgent_safety', // possible emergency / safety concern — act immediately
  'escalate_human', // needs a human/doctor or is sensitive — keep human in control
  'book_appointment', // patient wants to book or reschedule — open the calendar
  'confirm_details', // confirm a pending/known appointment or detail
  'request_info', // need more from the patient before proceeding
  'answer_question', // patient asked something answerable — draft a reply
  'follow_up_later', // nothing to do now; waiting on the patient / a later touch
  'resolve', // nothing left to do — the thread can be resolved
] as const

export type NextStepAction = (typeof NEXT_STEP_ACTIONS)[number]

/** Fallback when the model returns an unknown / missing action. */
export const DEFAULT_NEXT_STEP: NextStepAction = 'answer_question'

export interface NextStepResult {
  action: NextStepAction
  /** Staff-only one/two-sentence justification. May be empty. */
  rationale: string
}

function isNextStepAction(value: string): value is NextStepAction {
  return (NEXT_STEP_ACTIONS as readonly string[]).includes(value)
}

function buildNextStepSystemPrompt(language: Language): string {
  return [
    'You are an internal assistant for a medical clinic, helping a human secretary decide what to do next in a patient conversation.',
    'Recommend exactly ONE next operational step for the SECRETARY (not a message to the patient).',
    'Choose the single most appropriate action key from this list:',
    '- urgent_safety: the patient may have a medical emergency or safety concern; act immediately.',
    '- escalate_human: the matter needs a doctor or a human decision, or is sensitive; keep a human in control.',
    '- book_appointment: the patient wants to book or reschedule an appointment; open the calendar.',
    '- confirm_details: confirm a pending or known appointment / detail with the patient.',
    '- request_info: more information is needed from the patient before proceeding.',
    '- answer_question: the patient asked something answerable; draft a reply.',
    '- follow_up_later: nothing to do right now; you are waiting on the patient or a later touch-point.',
    '- resolve: nothing is left to do; the conversation can be resolved.',
    'Prefer urgent_safety or escalate_human whenever there is any doubt about patient safety.',
    'Reply in EXACTLY this format, nothing else:',
    'ACTION: <one action key from the list>',
    `WHY: <one or two short sentences for the secretary, in ${language === 'es' ? 'Spanish' : 'English'}>`,
  ].join('\n')
}

/**
 * Parse the model's ACTION/WHY response into a validated recommendation. Tolerant
 * of casing, surrounding prose and a missing WHY; an unknown or absent action
 * falls back to {@link DEFAULT_NEXT_STEP} so the panel always has something to show.
 */
export function parseNextStep(raw: string): NextStepResult {
  const text = raw.trim()
  const actionMatch = text.match(/ACTION:\s*([a-z_]+)/i)
  const candidate = actionMatch?.[1]?.toLowerCase() ?? ''
  const action: NextStepAction = isNextStepAction(candidate) ? candidate : DEFAULT_NEXT_STEP

  const whyMatch = text.match(/WHY:\s*([\s\S]+)/i)
  let rationale = whyMatch?.[1]?.trim() ?? ''
  // No WHY label: use whatever is left after stripping the ACTION line, so a model
  // that ignored the format still yields a usable note instead of a blank panel.
  if (rationale === '') {
    rationale = text
      .replace(/ACTION:\s*[a-z_]+/i, '')
      .replace(/^WHY:\s*/i, '')
      .trim()
  }
  return { action, rationale }
}

/**
 * Recommend the secretary's next operational step. Reads only the conversation (no
 * KB) and returns a validated action + rationale for the panel. Advisory only — it
 * never sends a message or changes the conversation.
 */
export async function suggestNextStep(
  messages: AssistantMessage[],
  language: Language,
  deps: InboxAssistantDeps,
): Promise<NextStepResult> {
  const transcript = renderTranscript(messages, language)
  const system = buildNextStepSystemPrompt(language)
  const user = transcript === '' ? '(no messages yet)' : transcript
  const raw = await deps.complete(system, user, 200)
  return parseNextStep(raw)
}
