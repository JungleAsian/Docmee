import { describe, it, expect } from 'vitest'
import { matchCustomFlow, type CustomFlowDef } from '../botbase/custom-flows.js'

const priceFlow: CustomFlowDef = {
  id: 'price',
  triggerKeywords: ['precio', 'price', 'costo'],
  messages: ['Nuestros precios...'],
  action: 'end',
  language: 'both',
}

describe('matchCustomFlow', () => {
  it('matches a keyword as a whole token, accent-insensitive', () => {
    expect(matchCustomFlow('¿cuál es el précio?', [priceFlow], 'es')?.id).toBe('price')
  })

  it('does not match a keyword that is only a substring of a word', () => {
    // "preciosa" should not trigger "precio"
    expect(matchCustomFlow('qué casa tan preciosa', [priceFlow], 'es')).toBeNull()
  })

  it('respects the flow language', () => {
    const esOnly: CustomFlowDef = { ...priceFlow, language: 'es' }
    expect(matchCustomFlow('what is the price', [esOnly], 'en')).toBeNull()
    expect(matchCustomFlow('cuál es el precio', [esOnly], 'es')?.id).toBe('price')
  })

  it('matches multi-word keywords as a phrase', () => {
    const flow: CustomFlowDef = {
      id: 'hours',
      triggerKeywords: ['horario de atencion'],
      messages: ['9-18h'],
      language: 'both',
    }
    expect(matchCustomFlow('cuál es su horario de atención', [flow], 'es')?.id).toBe('hours')
    expect(matchCustomFlow('horario', [flow], 'es')).toBeNull()
  })

  it('returns the first matching flow in order', () => {
    const a: CustomFlowDef = { id: 'a', triggerKeywords: ['hola'], messages: [], language: 'both' }
    const b: CustomFlowDef = { id: 'b', triggerKeywords: ['hola'], messages: [], language: 'both' }
    expect(matchCustomFlow('hola', [a, b], 'es')?.id).toBe('a')
  })

  it('returns null for an empty message', () => {
    expect(matchCustomFlow('   ', [priceFlow], 'es')).toBeNull()
  })
})
