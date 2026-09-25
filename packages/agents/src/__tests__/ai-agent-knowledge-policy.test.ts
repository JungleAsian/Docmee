import { describe, expect, it } from 'vitest'
import { buildAiAgentFallbackPrompt, isSafeGeneralEducationQuestion, resolveAiAgentKnowledgePolicy } from '../workflows/ai-agent-answer.js'

describe('AI Agent knowledge policy', () => {
  it('defaults to strict clinic KB grounding', () => {
    expect(resolveAiAgentKnowledgePolicy({})).toBe('strict_kb')
    expect(resolveAiAgentKnowledgePolicy({ knowledgePolicy: 'anything_else' })).toBe('strict_kb')
  })

  it('allows only explicit, non-personalized education questions under the education policy', () => {
    expect(resolveAiAgentKnowledgePolicy({ knowledgePolicy: 'clinic_kb_and_general_education' }))
      .toBe('clinic_kb_and_general_education')
    for (const question of ['What is alopecia?', '¿Qué es la dermatitis?', 'What causes acne?', 'Explain psoriasis']) {
      expect(isSafeGeneralEducationQuestion(question)).toBe(true)
    }
  })

  it('keeps clinic facts and personalized medical requests out of general education', () => {
    for (const question of [
      'What are your clinic hours?', 'Where is the clinic?', 'How much does a consultation cost?',
      'I am losing my hair, what treatment should I use?', 'Can I take this medicine?', '¿Debo usar minoxidil?',
    ]) expect(isSafeGeneralEducationQuestion(question)).toBe(false)
  })

  it('does not give the general-education fallback contradictory KB-only instructions', () => {
    const prompt = buildAiAgentFallbackPrompt('Derma Paz', '', '', '', 'clinic_kb_and_general_education')
    expect(prompt).toContain('General model knowledge is allowed only for a short non-personalized educational explanation')
    expect(prompt).not.toContain('Use only complete, unchanged KB sentences')
  })
})
