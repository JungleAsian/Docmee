import { describe, expect, it } from 'vitest'
import { EMBED_PROVIDERS, readAiAssistant } from './aiAssistant.js'

describe('Docmee assistant configuration', () => {
  it('uses the current product name for new clinic configurations', () => {
    expect(readAiAssistant(undefined).name).toBe('Docmee')
  })

  it('keeps the valid local default selectable', () => {
    expect(readAiAssistant(undefined).embedProvider).toBe('local')
    expect(EMBED_PROVIDERS.map((provider) => provider.id)).toContain('local')
  })

  it('preserves a saved local provider and rejects an invalid legacy value', () => {
    expect(readAiAssistant({ aiAssistant: { embedProvider: 'local' } } as never).embedProvider).toBe('local')
    expect(readAiAssistant({ aiAssistant: { embedProvider: 'unknown' } } as never).embedProvider).toBe('local')
  })

  it('keeps every supported persisted provider visible without mutating the saved value', () => {
    expect(EMBED_PROVIDERS.map((provider) => provider.id)).toEqual(['local', 'openai', 'gemini', 'custom'])
    for (const embedProvider of ['local', 'openai', 'gemini', 'custom'] as const) {
      expect(readAiAssistant({ aiAssistant: { embedProvider } } as never).embedProvider).toBe(embedProvider)
    }
  })
})
