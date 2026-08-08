import { describe, expect, it } from 'vitest'
import { buildAiAgentSystemPrompt, parseAiAgentCompletion } from '../workflow-runner.worker.js'

describe('buildAiAgentSystemPrompt', () => {
  it('includes the tone instruction for the given communication style', () => {
    const system = buildAiAgentSystemPrompt({
      clinicName: 'Clínica Demo A',
      personality: '',
      customInstructions: '',
      style: 'friendly',
      scenarios: [],
    })
    expect(system).toContain('Use warm, friendly language')
  })

  it('includes personality and custom instructions when set, omits them when blank', () => {
    const withBoth = buildAiAgentSystemPrompt({
      clinicName: 'Clínica Demo A',
      personality: 'Warm and patient.',
      customInstructions: 'Always mention Saturday hours.',
      style: 'professional',
      scenarios: [],
    })
    expect(withBoth).toContain('Personality: Warm and patient.')
    expect(withBoth).toContain('Instructions: Always mention Saturday hours.')

    const withNeither = buildAiAgentSystemPrompt({
      clinicName: 'Clínica Demo A',
      personality: '',
      customInstructions: '',
      style: 'professional',
      scenarios: [],
    })
    expect(withNeither).not.toContain('Personality:')
    expect(withNeither).not.toContain('Instructions:')
  })

  it('lists every scenario id and description verbatim', () => {
    const system = buildAiAgentSystemPrompt({
      clinicName: 'Clínica Demo A',
      personality: '',
      customInstructions: '',
      style: 'brief',
      scenarios: [
        { id: 'cancel', description: 'Patient wants to cancel an appointment' },
        { id: 'billing', description: 'Patient has a billing question' },
      ],
    })
    expect(system).toContain('cancel: Patient wants to cancel an appointment')
    expect(system).toContain('billing: Patient has a billing question')
  })

  it('instructs the strict SCENARIO/REPLY output format', () => {
    const system = buildAiAgentSystemPrompt({
      clinicName: 'Clínica Demo A',
      personality: '',
      customInstructions: '',
      style: 'professional',
      scenarios: [],
    })
    expect(system).toContain('SCENARIO:')
    expect(system).toContain('REPLY:')
  })
})

describe('parseAiAgentCompletion', () => {
  it('parses a well-formed completion with a reply', () => {
    const raw = 'SCENARIO: cancel\nREPLY:\nSure, I can help you cancel that appointment.'
    expect(parseAiAgentCompletion(raw)).toEqual({
      scenarioId: 'cancel',
      reply: 'Sure, I can help you cancel that appointment.',
    })
  })

  it('treats NONE (case-insensitive) as no match', () => {
    expect(parseAiAgentCompletion('SCENARIO: NONE\nREPLY:').scenarioId).toBeNull()
    expect(parseAiAgentCompletion('SCENARIO: none\nREPLY:').scenarioId).toBeNull()
  })

  it('returns a null scenarioId and empty reply for unparseable output', () => {
    expect(parseAiAgentCompletion('this is not the expected format at all')).toEqual({
      scenarioId: null,
      reply: '',
    })
  })

  it('trims whitespace from both the scenario id and the reply', () => {
    const raw = 'SCENARIO:   cancel  \nREPLY:\n  Sure, one moment.  \n'
    expect(parseAiAgentCompletion(raw)).toEqual({ scenarioId: 'cancel', reply: 'Sure, one moment.' })
  })

  it('handles a reply-less completion (route/handoff scenarios never draft a reply)', () => {
    expect(parseAiAgentCompletion('SCENARIO: billing\nREPLY:')).toEqual({ scenarioId: 'billing', reply: '' })
  })
})
