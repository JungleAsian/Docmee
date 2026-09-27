import { describe, expect, it } from 'vitest'
import { helpForJzelQuestion, helpForJzelRoute } from './jzel-help.js'

describe('helpForJzelRoute', () => {
  it('keeps Workflow Builder and Automations guidance separate', () => {
    expect(helpForJzelRoute('/studio/workflows')?.source).toBe('Workflow Builder')
    expect(helpForJzelRoute('/studio/automations')?.source).toBe('Automations')
  })

  it('does not accept untrusted or unknown routes as help context', () => {
    expect(helpForJzelRoute('https://example.test/studio/workflows')).toBeNull()
    expect(helpForJzelRoute('/studio/unknown')).toBeNull()
  })
})

describe('helpForJzelQuestion', () => {
  it('selects channel guidance from the question even on another page', () => {
    const help = helpForJzelQuestion(
      'How do I check channel status and integrations?',
      '/studio/workflows',
    )

    expect(help).toMatchObject({
      id: 'channels-integrations',
      source: 'Channels & Integrations',
    })
    expect(help?.text).toContain('Admin Studio > Channels')
    expect(help?.text).toContain('Google Calendar')
  })

  it('matches Spanish product questions', () => {
    expect(helpForJzelQuestion(
      '¿Dónde reviso el estado de WhatsApp y las integraciones?',
      '/studio/workflows',
    )?.id).toBe('channels-integrations')
  })

  it('uses the current page only for an explicitly contextual help request', () => {
    expect(helpForJzelQuestion('How do I use this page?', '/studio/workflows')?.id)
      .toBe('workflow-builder')
  })

  it('does not attach unrelated product help to a clinic knowledge question', () => {
    expect(helpForJzelQuestion(
      "What is the clinic's parking validation policy?",
      '/studio/workflows',
    )).toBeNull()
    expect(helpForJzelQuestion(
      "What is the clinic's cancellation policy for appointments?",
      '/studio/workflows',
    )).toBeNull()
    expect(helpForJzelQuestion(
      'How do I cancel my appointment?',
      '/studio/workflows',
    )).toBeNull()
  })
})
