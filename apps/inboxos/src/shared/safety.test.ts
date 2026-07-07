import { describe, it, expect } from 'vitest'
import { assessSafety, safetyRank } from './safety'

describe('assessSafety (Req 20)', () => {
  it('returns no level for an empty / missing tag set', () => {
    expect(assessSafety([]).level).toBeNull()
    expect(assessSafety(undefined).level).toBeNull()
    expect(assessSafety(null).level).toBeNull()
  })

  it('ignores unrelated tags', () => {
    expect(assessSafety(['billing', 'appointment', 'new_patient']).level).toBeNull()
  })

  it('flags emergency / medical_safety as critical', () => {
    expect(assessSafety(['emergency']).level).toBe('critical')
    expect(assessSafety(['medical_safety']).level).toBe('critical')
  })

  it('flags urgent / patient_upset as warning', () => {
    expect(assessSafety(['urgent']).level).toBe('warning')
    expect(assessSafety(['patient_upset']).level).toBe('warning')
  })

  it('critical outranks warning when both are present', () => {
    const a = assessSafety(['urgent', 'emergency', 'billing'])
    expect(a.level).toBe('critical')
    // critical tags come first, warning tags follow, noise dropped
    expect(a.tags).toEqual(['emergency', 'urgent'])
  })

  it('exposes only the safety tags, never the noise', () => {
    expect(assessSafety(['patient_upset', 'insurance']).tags).toEqual(['patient_upset'])
  })

  it('ranks critical above warning above none for triage sorting', () => {
    expect(safetyRank('critical')).toBeGreaterThan(safetyRank('warning'))
    expect(safetyRank('warning')).toBeGreaterThan(safetyRank(null))
  })
})
