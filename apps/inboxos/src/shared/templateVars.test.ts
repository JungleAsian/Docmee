import { describe, it, expect } from 'vitest'
import { applyTemplateVars } from './templateVars'

describe('applyTemplateVars (CRE-64)', () => {
  it('substitutes known variables, tolerating inner spaces', () => {
    expect(
      applyTemplateVars('Hola {{patient_name}}, su cita es el {{ date }}.', {
        patient_name: 'Ana',
        date: '2026-07-01',
      }),
    ).toBe('Hola Ana, su cita es el 2026-07-01.')
  })
  it('leaves unknown or empty variables intact', () => {
    expect(applyTemplateVars('Hi {{patient_name}} from {{clinic_name}}', { patient_name: 'Sam' })).toBe(
      'Hi Sam from {{clinic_name}}',
    )
    expect(applyTemplateVars('Hi {{patient_name}}', { patient_name: '' })).toBe('Hi {{patient_name}}')
  })
  it('replaces every occurrence', () => {
    expect(applyTemplateVars('{{patient_name}} {{patient_name}}', { patient_name: 'Jo' })).toBe('Jo Jo')
  })
  it('returns text unchanged when there are no placeholders', () => {
    expect(applyTemplateVars('No vars here', { patient_name: 'X' })).toBe('No vars here')
  })
})
