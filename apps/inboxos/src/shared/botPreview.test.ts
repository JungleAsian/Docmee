import { describe, it, expect } from 'vitest'
import { tonePreview, SAFETY_RULE_KEYS } from './botPreview'

describe('tonePreview', () => {
  it('returns a patient + bot sample for each tone in Spanish', () => {
    for (const tone of ['professional', 'friendly', 'brief'] as const) {
      const p = tonePreview(tone, 'es')
      expect(p.patient).toMatch(/garganta/)
      expect(p.bot.length).toBeGreaterThan(0)
    }
  })

  it('returns English samples when previewing in English', () => {
    const p = tonePreview('professional', 'en')
    expect(p.patient).toMatch(/throat/)
    expect(p.bot).toMatch(/6:00 pm/)
  })

  it('varies the reply by tone', () => {
    const pro = tonePreview('professional', 'es').bot
    const brief = tonePreview('brief', 'es').bot
    expect(pro).not.toBe(brief)
    expect(brief.length).toBeLessThan(pro.length)
  })

  it('never includes a dosage or diagnosis in a sample reply', () => {
    for (const lang of ['es', 'en'] as const) {
      for (const tone of ['professional', 'friendly', 'brief'] as const) {
        const bot = tonePreview(tone, lang).bot.toLowerCase()
        expect(bot).not.toMatch(/\bmg\b|\bml\b|diagn/)
      }
    }
  })
})

describe('SAFETY_RULE_KEYS', () => {
  it('lists the four enforced safety rules', () => {
    expect(SAFETY_RULE_KEYS).toHaveLength(4)
    expect(SAFETY_RULE_KEYS).toContain('bot.safety.diagnosis')
    expect(SAFETY_RULE_KEYS).toContain('bot.safety.medication')
  })
})
