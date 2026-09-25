import { describe, expect, it } from 'vitest'
import { planKbQuery } from '../botbase/kb-query-plan.js'

describe('planKbQuery', () => {
  it('normalizes and expands a bilingual clinic-hours question', () => {
    const plan = planKbQuery('  ¿Cuáles son los HORARIOS hoy?  ')

    expect(plan.normalizedQuery).toBe('¿cuáles son los horarios hoy?')
    expect(plan.expandedQuery).toContain('horarios')
    expect(plan.intent).toBe('hours')
    expect(plan.language).toBe('es')
    expect(plan.timeSensitive).toBe(true)
  })

  it('classifies medical questions as high risk and keeps doctor scope', () => {
    const plan = planKbQuery('Can Dr. Paz diagnose this rash?', { doctorId: 'doctor-paz', language: 'en' })

    expect(plan.riskClass).toBe('medical')
    expect(plan.doctorId).toBe('doctor-paz')
  })
})
