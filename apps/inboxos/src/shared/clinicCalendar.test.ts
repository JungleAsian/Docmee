import { describe, expect, it } from 'vitest'
import { clinicDateKey } from './clinicCalendar'

describe('clinicDateKey', () => {
  it('groups UTC appointments on the date seen by the clinic', () => {
    expect(clinicDateKey('2026-08-28T04:30:00.000Z', 'America/Guatemala')).toBe('2026-08-27')
  })
})
