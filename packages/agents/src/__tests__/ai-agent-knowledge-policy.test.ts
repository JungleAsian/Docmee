import { describe, expect, it } from 'vitest'
import { aiAgentHandoffReason, buildAiAgentFallbackPrompt, extractGroundedKbReply, isSafeGeneralEducationQuestion, resolveAiAgentKnowledgePolicy } from '../workflows/ai-agent-answer.js'

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

  it('extracts the exact clinic fact that answers the question', () => {
    const source = [
      'Clinic: Derma Paz',
      'Address: 20 Avenida 1-16 Zona 3',
      'Phone: 46082715',
      'Doctor: Dra. Mónica Paz, dermatóloga.',
    ].join('\n')
    expect(extractGroundedKbReply('What is the Derma Paz contact phone?', 'You can call the clinic at 4608-2715.', [source]))
      .toBe('Phone: 46082715')
    expect(extractGroundedKbReply('¿Quién es la doctora?', 'La especialista es Mónica Paz.', [source]))
      .toBe('Doctor: Dra. Mónica Paz, dermatóloga.')
  })

  it('does not extract an unrelated sentence for a missing clinic fact', () => {
    expect(extractGroundedKbReply('What is the parking validation policy?', 'Parking is validated for two hours.', [
      'Phone: 46082715\nAddress: 20 Avenida 1-16 Zona 3',
    ])).toBeNull()
  })

  it('allows exact current-source delivery without weakening the publication evidence', () => {
    const evidence = { answerConfidence: .99, groundingScore: 1, contradiction: 'unknown' as const,
      risks: [], safeContentClass: 'unknown' as const, verifier: 'extractive-v1' as const }
    expect(aiAgentHandoffReason(evidence, .99, true)).toBe('contradiction_unknown')
    expect(aiAgentHandoffReason(evidence, .99, true, { allowExactCurrentSource: true })).toBeNull()
  })
})
