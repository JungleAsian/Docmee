import { createKnowledgeRepository, createKnowledgeLearningRepository, type Clinic, type WorkflowNode, type Sql } from '@docmee/db'
import { chatComplete, defaultChatModel } from '@docmee/llm'
import { buildAiAgentSystemPrompt, parseAiAgentCompletion, parseAiAnswerConfidence, catchAllReplyScenario, aiAgentHandoffReason,
  parseAiAgentScenarios, resolveAiAgentSettings, detectLanguage, isEmergencyMessage, isLikelyQuestion, retrieveKbEvidence,
  assessKbAnswer, screenMedicalSafety, screenPromptLeak, buildAiAgentFallbackPrompt, withAiAgentReplyTimeout } from '@docmee/agents'
import { readAiAssistant, resolveEmbed } from './ai-assistant.js'
import { resolveClinicAiKey } from './clinic-ai-key.js'

/** Runs only retrieval and completion. Never invokes the workflow engine or delivery queues. */
export async function previewTeachingAnswer(sql: Sql, clinic: Clinic, node: WorkflowNode, input: {
  question: string; doctorId: string | null; language: 'en' | 'es' | null
}) {
  const knowledge = createKnowledgeRepository(sql)
  const learning = createKnowledgeLearningRepository(sql)
  const message = input.question
  const language = input.language ?? detectLanguage(message)
  let scope = { doctorId: input.doctorId, language, retrievalRevision: await knowledge.getClinicRetrievalRevision(clinic.id) }
  const result = (action: string, reason: string | null, answer = '', sources: Array<{ documentId: string; title: string; documentVersion: number }> = []) =>
    ({ action, reason, answer, sources, retrievalRevision: scope.retrievalRevision, sent: false as const })
  if (isEmergencyMessage(message)) return result('handoff', 'emergency')
  const pack = await retrieveKbEvidence({ clinicId: clinic.id, question: message, language,
    doctorId: input.doctorId, knowledge, embed: query => withAiAgentReplyTimeout(resolveEmbed(readAiAssistant(clinic), clinic.settings)(query)),
    sourcesCurrent: (citations, revision) => learning.sourcesCurrent(clinic.id, citations, { doctorId: input.doctorId, language, retrievalRevision: revision }) })
  scope = { ...scope, language: pack.plan.language, retrievalRevision: pack.revision }
  const matches = pack.matches
  const sources = matches.map(({ documentId, title, documentVersion }) => ({ documentId, title, documentVersion }))
  const citations = matches.map(m => ({ chunkId: m.chunkId, documentId: m.documentId, documentVersion: m.documentVersion,
    doctorId: m.doctorId ?? null, language: m.language ?? null, retrievalRevision: m.retrievalRevision,
    governanceReviewState: typeof m.provenance?.['governanceReviewState'] === 'string' ? m.provenance['governanceReviewState'] : 'trusted' }))
  if (isLikelyQuestion(message) && !matches.length) return result('handoff', 'knowledge_gap')
  if (pack.status !== 'ready') {
    return result('handoff', pack.status === 'stale_sources' ? 'stale_or_missing_sources' : pack.status)
  }
  if (citations.length && !await learning.sourcesCurrent(clinic.id, citations, scope)) return result('handoff', 'stale_or_missing_sources')
  const scenarios = parseAiAgentScenarios(node.config)
  const style = String(node.config?.['communicationStyle'] ?? 'professional')
  const customInstructions = String(node.config?.['customInstructions'] ?? '').trim()
  const preferredLanguage = input.language ?? ''
  const system = [buildAiAgentSystemPrompt({ clinicName: clinic.name, personality: String(node.config?.['personality'] ?? '').trim(),
    customInstructions, style: style === 'friendly' || style === 'brief' ? style : 'professional', scenarios, kbMatches: matches }),
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
  if (!matched) return result('no_match', 'no_match', '', sources)
  if (matched.action !== 'reply') return result(matched.action, matched.action === 'route' ? 'routed' : 'ai_agent_handoff', '', sources)
  let answer = parsed.reply
  if (!answer) {
    raw = await complete(buildAiAgentFallbackPrompt(clinic.name, customInstructions, preferredLanguage,
      matches.map(m => `# ${m.title}\n${m.content}`).join('\n\n')))
    answer = parseAiAgentCompletion(raw).reply
  }
  if (!screenMedicalSafety(answer).safe) return result('handoff', 'medical_safety', '', sources)
  if (!screenPromptLeak(answer).safe) return result('handoff', 'prompt_safety', '', sources)
  const confidence = parseAiAnswerConfidence(raw)
  const evidence = assessKbAnswer(message, answer, matches.map(m => m.content), confidence ?? undefined, await learning.scopedConsistency(clinic.id, scope))
  const reason = aiAgentHandoffReason(evidence, confidence, await learning.sourcesCurrent(clinic.id, citations, scope))
  return result(reason ? 'handoff' : 'reply', reason, reason ? '' : answer, sources)
}
