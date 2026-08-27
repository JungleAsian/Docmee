import { describe, expect, it } from 'vitest'
import { clinicDate, clinicInstantRange, clinicLocalInstant } from '../clinicTime.js'

describe('clinic time conversion', () => {
  it('converts clinic-local wall time to a UTC instant', () => {
    expect(clinicLocalInstant('2026-08-27T20:30:00', 'America/New_York')?.toISOString())
      .toBe('2026-08-28T00:30:00.000Z')
  })

  it('preserves duration across midnight and groups by the clinic date', () => {
    const range = clinicInstantRange('2026-08-27', '23:45', 30, 'America/Guatemala')
    expect(range).toEqual({
      startTime: '2026-08-28T05:45:00.000Z',
      endTime: '2026-08-28T06:15:00.000Z',
    })
    expect(clinicDate(range!.startTime, 'America/Guatemala')).toBe('2026-08-27')
  })

  it('rejects a local time skipped by daylight saving', () => {
    expect(clinicLocalInstant('2026-03-08T02:30:00', 'America/New_York')).toBeNull()
  })
})
