import { describe, expect, it } from 'vitest'
import { appointmentsForClinicDate, clinicDateKey } from './clinicCalendar'

describe('clinicDateKey', () => {
  it('groups UTC appointments on the date seen by the clinic', () => {
    expect(clinicDateKey('2026-08-28T04:30:00.000Z', 'America/Guatemala')).toBe('2026-08-27')
  })

  it('returns active appointments for the selected clinic date in time order', () => {
    const appointments = [
      { id: 'late', startTime: '2026-08-28T20:00:00.000Z', status: 'confirmed' },
      { id: 'cancelled', startTime: '2026-08-28T15:00:00.000Z', status: 'cancelled' },
      { id: 'early', startTime: '2026-08-28T14:00:00.000Z', status: 'pending' },
      { id: 'next-day', startTime: '2026-08-29T14:00:00.000Z', status: 'confirmed' },
    ]

    expect(appointmentsForClinicDate(appointments, '2026-08-28', 'America/Guatemala').map((item) => item.id)).toEqual([
      'early',
      'late',
    ])
  })
})
