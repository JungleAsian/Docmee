import { describe, expect, it } from 'vitest'
import {
  GUARDRAIL_PRESET_THRESHOLDS,
  applyReplyGuardrails,
  defaultGuardrails,
  guardrailDeflection,
  matchesGuardrailTopic,
  readGuardrails,
} from '../botbase/guardrails.js'

describe('clinic guardrails', () => {
  it('keeps absent settings at the current balanced, fail-closed default', () => {
    expect(readGuardrails({})).toEqual(defaultGuardrails())
    expect(defaultGuardrails().groundingStrictness).toEqual({
      minKbConfidence: GUARDRAIL_PRESET_THRESHOLDS.balanced,
      allowGeneralKnowledgeFallback: false,
    })
  })

  it('clamps legacy threshold values to the non-bypassable floor', () => {
    expect(readGuardrails({ guardrails: { groundingStrictness: { minKbConfidence: 0.1 } } }).groundingStrictness.minKbConfidence).toBe(0.6)
  })

  it('detects configured blocked topics independent of case and accents', () => {
    expect(matchesGuardrailTopic('Necesito información sobre PÓLIZAS.', ['polizas'])).toBe(true)
    expect(matchesGuardrailTopic('Quiero reservar una cita.', ['polizas'])).toBe(false)
  })

  it('uses the clinic deflection and applies post-generation reply preferences', () => {
    const guardrails = readGuardrails({ guardrails: {
      contentBoundaries: { additionalBlockedTopics: ['policy'], customDeflectionMessage: { en: 'Our team will help.' } },
      toneGuardrails: { maxReplyLength: 16, disallowEmojis: true, requireDisclaimerFooter: true, disclaimerText: { en: 'Info only.' } },
    } })
    expect(guardrailDeflection('en', guardrails)).toBe('Our team will help.')
    expect(applyReplyGuardrails(`Hello 😀 ${'a'.repeat(150)}`, 'en', guardrails)).toBe(`Hello ${'a'.repeat(93)}…\n\nInfo only.`)
  })
})
