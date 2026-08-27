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

  it('preserves customized assistant names', () => {
    expect(readAiAssistant(clinicWithAssistant({ name: 'J.Zel' })).name).toBe('J.Zel')
    expect(readAiAssistant(clinicWithAssistant({ name: 'J.zel Dental' })).name).toBe('J.zel Dental')
  })
})
