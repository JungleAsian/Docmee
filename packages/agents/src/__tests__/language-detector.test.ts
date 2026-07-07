import { describe, it, expect } from 'vitest'
import { detectLanguage } from '../botbase/language-detector.js'

describe('detectLanguage', () => {
  it('Spanish greeting + intent → es', () => {
    expect(detectLanguage('hola quiero una cita')).toBe('es')
  })

  it('English greeting + intent → en', () => {
    expect(detectLanguage('hello I want an appointment')).toBe('en')
  })

  it('a single Spanish indicator is enough → es', () => {
    expect(detectLanguage('Necesito información')).toBe('es')
  })

  it('no Spanish indicators → en (default)', () => {
    expect(detectLanguage('What are your opening times?')).toBe('en')
  })
})
