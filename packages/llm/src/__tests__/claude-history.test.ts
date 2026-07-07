import { describe, it, expect } from 'vitest'
import { buildMessages } from '../providers/claude.js'

describe('buildMessages — Anthropic message normalization (CRE-45)', () => {
  it('appends the new user message to an empty history', () => {
    expect(buildMessages([], 'hola')).toEqual([{ role: 'user', content: 'hola' }])
  })

  it('keeps a clean alternating history', () => {
    const hist = [
      { role: 'user' as const, content: 'precio de limpieza?' },
      { role: 'assistant' as const, content: 'Cuesta $500.' },
    ]
    expect(buildMessages(hist, 'y de blanqueamiento?')).toEqual([
      { role: 'user', content: 'precio de limpieza?' },
      { role: 'assistant', content: 'Cuesta $500.' },
      { role: 'user', content: 'y de blanqueamiento?' },
    ])
  })

  it('drops leading assistant turns (history must start with user)', () => {
    const hist = [{ role: 'assistant' as const, content: '¿En qué puedo ayudar?' }]
    expect(buildMessages(hist, 'quiero una cita')).toEqual([
      { role: 'user', content: 'quiero una cita' },
    ])
  })

  it('merges consecutive same-role turns (no back-to-back roles)', () => {
    const hist = [
      { role: 'user' as const, content: 'hola' },
      { role: 'user' as const, content: 'sigo ahí?' },
    ]
    expect(buildMessages(hist, 'precio?')).toEqual([
      { role: 'user', content: 'hola\nsigo ahí?\nprecio?' },
    ])
  })
})
