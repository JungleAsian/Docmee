import { describe, expect, it } from 'vitest'
import { readAiAssistant } from './ai-assistant.js'

function clinicWithAssistant(aiAssistant?: Record<string, unknown>) {
  return { settings: aiAssistant === undefined ? {} : { aiAssistant } } as never
}

describe('readAiAssistant', () => {
  it('uses Docmee for missing and exact legacy-default names', () => {
    expect(readAiAssistant(clinicWithAssistant()).name).toBe('Docmee')
    expect(readAiAssistant(clinicWithAssistant({ name: 'J.zel' })).name).toBe('Docmee')
  })

  it('recognizes the managed CLI provider without changing defaults', () => {
    const config = readAiAssistant(clinicWithAssistant({ chatProvider: 'claude_cli' }))
    expect(config.chatProvider).toBe('claude_cli')
    expect(config.model).toBe('claude-opus-4-8')
    expect(config.intentProvider).toBe('deepseek')
  })

  it('preserves customized assistant names', () => {
    expect(readAiAssistant(clinicWithAssistant({ name: 'J.Zel' })).name).toBe('J.Zel')
    expect(readAiAssistant(clinicWithAssistant({ name: 'J.zel Dental' })).name).toBe('J.zel Dental')
  })
})
