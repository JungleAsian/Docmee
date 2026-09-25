import { createKnowledgeRepository, createKnowledgeLearningRepository, type Clinic, type WorkflowNode, type Sql } from '@docmee/db'
import { chatComplete, defaultChatModel } from '@docmee/llm'
import { buildAiAgentSystemPrompt, parseAiAgentCompletion, parseAiAnswerConfidence, catchAllReplyScenario, aiAgentHandoffReason,
  parseAiAgentScenarios, resolveAiAgentSettings, detectLanguage, isEmergencyMessage, isLikelyQuestion, expandKbQuery,
  rerankHybridChunks, assessKbAnswer, screenMedicalSafety, screenPromptLeak, buildAiAgentFallbackPrompt, withAiAgentReplyTimeout } from '@docmee/agents'
import { resolveAiAgentKnowledgePolicy, isSafeGeneralEducationQuestion } from '@docmee/agents'
import { readAiAssistant, resolveEmbed } from './ai-assistant.js'
import { resolveClinicAiKey } from './clinic-ai-key.js'

/** Runs only retrieval and completion. Never invokes the workflow engine or delivery queues. */
export async function previewTeachingAnswer(sql: Sql, clinic: Clinic, node: WorkflowNode, input: {
  question: string; doctorId: string | null; language: 'en' | 'es' | null
}) {
  const knowledge = createKnowledgeRepository(sql)
  const learning = createKnowledgeLearningRepository(sql)
  const message = input.question
  const language = detectLanguage(message)
  const scope = { doctorId: input.doctorId, language, retrievalRevision: await knowledge.getClinicRetrievalRevision(clinic.id) }
  const result = (action: string, reason: string | null, answer = '', sources: Array<{ documentId: string; title: string; documentVersion: number }> = [],
    diagnostics: { kbMatches: number; retrievalMode: 'embedded' | 'keyword' | 'none' } = { kbMatches: 0, retrievalMode: 'none' }) =>
    ({ action, reason, answer, sources, ...diagnostics, retrievalRevision: scope.retrievalRevision, sent: false as const })
  if (isEmergencyMessage(message)) return result('handoff', 'emergency')
  const embedding = await withAiAgentReplyTimeout(resolveEmbed(readAiAssistant(clinic), clinic.settings)(message)).catch(() => [])
  const rows = await knowledge.searchChunks(expandKbQuery(message), embedding, { clinicId: clinic.id, language, doctorId: input.doctorId ?? undefined }, 40)
  const matches = rerankHybridChunks(rows.map(row => ({ ...row, similarity: 0 })), 5)
  const sources = matches.map(({ documentId, title, documentVersion }) => ({ documentId, title, documentVersion }))
  const retrievalMode: 'embedded' | 'keyword' | 'none' = matches.length ? (embedding.length ? 'embedded' : 'keyword') : 'none'
  const diagnostics = { kbMatches: matches.length, retrievalMode }
  const citations = matches.map(m => ({ chunkId: m.chunkId, documentId: m.documentId, documentVersion: m.documentVersion,
    doctorId: m.doctorId ?? null, language: m.language ?? null, retrievalRevision: m.retrievalRevision,
    governanceReviewState: typeof m.provenance?.['governanceReviewState'] === 'string' ? m.provenance['governanceReviewState'] : 'trusted' }))
  const knowledgePolicy = resolveAiAgentKnowledgePolicy(node.config)
  const generalEducation = knowledgePolicy === 'clinic_kb_and_general_education'
    && isSafeGeneralEducationQuestion(message)
  if (isLikelyQuestion(message) && !matches.length && !generalEducation) return result('handoff', 'knowledge_gap', '', sources, diagnostics)
  if (citations.length && !await learning.sourcesCurrent(clinic.id, citations, scope)) return result('handoff', 'stale_or_missing_sources', '', sources, diagnostics)
  const scenarios = parseAiAgentScenarios(node.config)
  const style = String(node.config?.['communicationStyle'] ?? 'professional')
  const customInstructions = String(node.config?.['customInstructions'] ?? '').trim()
  const preferredLanguage = input.language ?? ''
  const system = [buildAiAgentSystemPrompt({ clinicName: clinic.name, personality: String(node.config?.['personality'] ?? '').trim(),
    customInstructions, style: style === 'friendly' || style === 'brief' ? style : 'professional', scenarios, kbMatches: matches,
    knowledgePolicy }),
    preferredLanguage ? `The patient selected ${preferredLanguage} for this workflow. Reply in ${preferredLanguage} unless the patient explicitly asks to switch languages.` : '',
  ].filter(Boolean).join('\n\n')
  const ai = readAiAssistant(clinic)
  const settings = resolveAiAgentSettings(node.config ?? {}, { chatProvider: ai.chatProvider, model: ai.model })
  const complete = (prompt: string) => withAiAgentReplyTimeout(chatComplete({ provider: settings.provider, model: settings.model || defaultChatModel(settings.provider),
    apiKey: resolveClinicAiKey(clinic.settings, settings.provider), baseURL: ai.baseURL || undefined, history: [],
    maxTokens: settings.maxTokens, system: prompt, message }))
  let raw = await complete(system)
  const parsed = parseAiAgentCompletion(raw)
  const matched = scenarios.find(s => s.id === parsed.scenarioId) ?? catchAllReplyScenario(scenarios)
  if (!matched) return result('no_match', 'no_match', '', sources, diagnostics)
  if (matched.action !== 'reply') return result(matched.action, matched.action === 'route' ? 'routed' : 'ai_agent_handoff', '', sources, diagnostics)
  let answer = parsed.reply
  let usedGroundedFallback = false
  if (!answer) {
    raw = await complete(buildAiAgentFallbackPrompt(clinic.name, customInstructions, preferredLanguage,
      matches.map(m => `# ${m.title}\n${m.content}`).join('\n\n'), knowledgePolicy))
    answer = parseAiAgentCompletion(raw).reply
    usedGroundedFallback = true
  }
  if (!screenMedicalSafety(answer).safe) return result('handoff', 'medical_safety', '', sources, diagnostics)
  if (!screenPromptLeak(answer).safe) return result('handoff', 'prompt_safety', '', sources, diagnostics)
  let confidence = parseAiAnswerConfidence(raw)
  if (generalEducation && !matches.length) {
    return result(confidence !== null && confidence >= .8 ? 'reply' : 'handoff',
      confidence !== null && confidence >= .8 ? null : 'low_answer_confidence',
      confidence !== null && confidence >= .8 ? answer : '', sources, diagnostics)
  }
  const consistency = await learning.scopedConsistency(clinic.id, scope)
  let evidence = assessKbAnswer(message, answer, matches.map(m => m.content), confidence ?? undefined, consistency)
  let reason = aiAgentHandoffReason(evidence, confidence, await learning.sourcesCurrent(clinic.id, citations, scope))
  if (reason === 'ungrounded_answer' && matches.length && !usedGroundedFallback) {
    raw = await complete(buildAiAgentFallbackPrompt(clinic.name, customInstructions, preferredLanguage,
      matches.map(m => `# ${m.title}\n${m.content}`).join('\n\n'), knowledgePolicy))
    answer = parseAiAgentCompletion(raw).reply
    if (!screenMedicalSafety(answer).safe) return result('handoff', 'medical_safety', '', sources, diagnostics)
    if (!screenPromptLeak(answer).safe) return result('handoff', 'prompt_safety', '', sources, diagnostics)
    confidence = parseAiAnswerConfidence(raw)
    evidence = assessKbAnswer(message, answer, matches.map(m => m.content), confidence ?? undefined, consistency)
    reason = aiAgentHandoffReason(evidence, confidence, await learning.sourcesCurrent(clinic.id, citations, scope))
  }
  return result(reason ? 'handoff' : 'reply', reason, reason ? '' : answer, sources, diagnostics)
}
