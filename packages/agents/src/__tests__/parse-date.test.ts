import { describe, it, expect } from 'vitest'
import { parseDate, clinicToday } from '../calbot/shared.js'

// Anchor "today" = Wednesday 2026-06-24 for deterministic relative-date assertions.
const TODAY = '2026-06-24'

describe('parseDate — explicit formats', () => {
  it('parses ISO dates embedded in text', () => {
    expect(parseDate('agendar 2026-07-01 por favor', TODAY)).toBe('2026-07-01')
  })
  it('parses DD/MM and DD/MM/YYYY (year from refToday)', () => {
    expect(parseDate('el 3/7', TODAY)).toBe('2026-07-03')
    expect(parseDate('3/7/2027', TODAY)).toBe('2027-07-03')
  })
  it('returns null when no date is present', () => {
    expect(parseDate('hola, quiero una cita', TODAY)).toBeNull()
  })
})

describe('parseDate — natural language (CRE-46)', () => {
  it('today / hoy', () => {
    expect(parseDate('hoy', TODAY)).toBe('2026-06-24')
    expect(parseDate('today please', TODAY)).toBe('2026-06-24')
  })
  it('tomorrow / mañana (ignores trailing time)', () => {
    expect(parseDate('mañana', TODAY)).toBe('2026-06-25')
    expect(parseDate('tomorrow at 10', TODAY)).toBe('2026-06-25')
  })
  it('day after tomorrow / pasado mañana', () => {
    expect(parseDate('pasado mañana', TODAY)).toBe('2026-06-26')
    expect(parseDate('day after tomorrow', TODAY)).toBe('2026-06-26')
  })
  it('weekday name resolves to the next future occurrence', () => {
    // Wed 2026-06-24 -> next Monday = 2026-06-29
    expect(parseDate('el lunes', TODAY)).toBe('2026-06-29')
    expect(parseDate('next monday', TODAY)).toBe('2026-06-29')
    // Friday this week = 2026-06-26
    expect(parseDate('viernes', TODAY)).toBe('2026-06-26')
    // Same weekday as today -> next week, accent-insensitive
    expect(parseDate('miércoles que viene', TODAY)).toBe('2026-07-01')
  })
  it('is accent- and case-insensitive', () => {
    expect(parseDate('MAÑANA', TODAY)).toBe('2026-06-25')
    expect(parseDate('Sábado', TODAY)).toBe('2026-06-27')
  })
})

describe('clinicToday', () => {
  it('returns a YYYY-MM-DD string for a real timezone', () => {
    expect(clinicToday('America/Mexico_City')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
  it('falls back gracefully on an invalid timezone', () => {
    expect(clinicToday('Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
