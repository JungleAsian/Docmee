import { describe, it, expect } from 'vitest'
import {
  normalizeAvailability,
  hasAvailability,
  worksOnDay,
  weekdayOf,
  isWithinAvailability,
  filterSlotsByAvailability,
  type DoctorAvailability,
} from '../calbot/doctor-availability.js'
import type { TimeSlot } from '../calbot/google-calendar-client.js'

// 2026-07-01 is a Wednesday; 2026-07-04 is a Saturday.
const WED = '2026-07-01'
const SAT = '2026-07-04'

function slots(date: string, times: string[]): TimeSlot[] {
  return times.map((t) => ({ start: `${date}T${t}:00`, end: `${date}T${t}:30` }))
}

describe('normalizeAvailability', () => {
  it('keeps valid weekday ranges', () => {
    const out = normalizeAvailability({ mon: [{ start: '09:00', end: '13:00' }] })
    expect(out).toEqual({ mon: [{ start: '09:00', end: '13:00' }] })
  })

  it('drops unknown weekday keys and non-array values', () => {
    const out = normalizeAvailability({ funday: [{ start: '09:00', end: '10:00' }], tue: 'nope' })
    expect(out).toEqual({})
  })

  it('drops malformed and reversed/zero-length ranges', () => {
    const out = normalizeAvailability({
      mon: [
        { start: '09:00', end: '13:00' }, // ok
        { start: '13:00', end: '09:00' }, // reversed → dropped
        { start: '13:00', end: '13:00' }, // zero-length → dropped
        { start: '9am', end: '5pm' }, // bad format → dropped
      ],
    })
    expect(out).toEqual({ mon: [{ start: '09:00', end: '13:00' }] })
  })

  it('returns {} for junk input', () => {
    expect(normalizeAvailability(null)).toEqual({})
    expect(normalizeAvailability([1, 2])).toEqual({})
    expect(normalizeAvailability('x')).toEqual({})
  })
})

describe('weekdayOf', () => {
  it('maps a date to its weekday key regardless of host TZ', () => {
    expect(weekdayOf(WED)).toBe('wed')
    expect(weekdayOf(SAT)).toBe('sat')
  })
})

describe('hasAvailability / worksOnDay', () => {
  it('treats an empty schedule as no restriction (works every day)', () => {
    const av: DoctorAvailability = {}
    expect(hasAvailability(av)).toBe(false)
    expect(worksOnDay(av, SAT)).toBe(true)
  })

  it('treats a configured schedule as a restriction — off on unlisted days', () => {
    const av: DoctorAvailability = { mon: [{ start: '09:00', end: '17:00' }], wed: [{ start: '09:00', end: '13:00' }] }
    expect(hasAvailability(av)).toBe(true)
    expect(worksOnDay(av, WED)).toBe(true)
    expect(worksOnDay(av, SAT)).toBe(false)
  })
})

describe('isWithinAvailability', () => {
  const av: DoctorAvailability = { wed: [{ start: '09:00', end: '12:00' }, { start: '15:00', end: '18:00' }] }

  it('accepts times inside a range, rejects outside (end-exclusive)', () => {
    expect(isWithinAvailability(av, WED, '09:00')).toBe(true)
    expect(isWithinAvailability(av, WED, '11:30')).toBe(true)
    expect(isWithinAvailability(av, WED, '12:00')).toBe(false) // end is exclusive
    expect(isWithinAvailability(av, WED, '13:00')).toBe(false) // lunch gap
    expect(isWithinAvailability(av, WED, '15:30')).toBe(true)
  })

  it('rejects any time on a day off', () => {
    expect(isWithinAvailability(av, SAT, '10:00')).toBe(false)
  })

  it('accepts any time when no restriction is configured', () => {
    expect(isWithinAvailability({}, SAT, '23:00')).toBe(true)
  })
})

describe('filterSlotsByAvailability', () => {
  it('returns slots unchanged when no hours configured', () => {
    const s = slots(WED, ['09:00', '14:00', '17:30'])
    expect(filterSlotsByAvailability(s, WED, {})).toEqual(s)
  })

  it('keeps only slots inside the day ranges', () => {
    const av: DoctorAvailability = { wed: [{ start: '09:00', end: '12:00' }] }
    const s = slots(WED, ['08:30', '09:00', '11:30', '12:00', '14:00'])
    const kept = filterSlotsByAvailability(s, WED, av).map((x) => x.start.slice(11, 16))
    expect(kept).toEqual(['09:00', '11:30'])
  })

  it('returns no slots on a day the doctor does not work', () => {
    const av: DoctorAvailability = { wed: [{ start: '09:00', end: '12:00' }] }
    expect(filterSlotsByAvailability(slots(SAT, ['10:00', '11:00']), SAT, av)).toEqual([])
  })
})
