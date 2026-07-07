import { describe, it, expect } from 'vitest'
import {
  computeFreeSlots,
  normalizeAvailability,
  rangesForDate,
  weekdayOf,
} from './slots.js'

describe('slots — weekdayOf', () => {
  it('maps an ISO date to the right weekday key', () => {
    expect(weekdayOf('2026-06-22')).toBe('mon') // a Monday
    expect(weekdayOf('2026-06-27')).toBe('sat')
    expect(weekdayOf('2026-06-28')).toBe('sun')
  })
})

describe('slots — normalizeAvailability', () => {
  it('keeps valid ordered ranges and drops junk', () => {
    const out = normalizeAvailability({
      mon: [{ start: '09:00', end: '13:00' }, { start: '17:00', end: '09:00' }],
      funday: [{ start: '09:00', end: '10:00' }],
      tue: 'nope',
    })
    expect(out.mon).toEqual([{ start: '09:00', end: '13:00' }]) // reversed range dropped
    expect(out).not.toHaveProperty('funday')
    expect(out).not.toHaveProperty('tue')
  })

  it('returns {} for non-object input', () => {
    expect(normalizeAvailability(null)).toEqual({})
    expect(normalizeAvailability([1, 2])).toEqual({})
  })
})

describe('slots — rangesForDate', () => {
  it('returns the configured ranges for a worked day', () => {
    const a = normalizeAvailability({ mon: [{ start: '09:00', end: '12:00' }] })
    expect(rangesForDate(a, '2026-06-22')).toEqual([{ start: '09:00', end: '12:00' }])
  })

  it('treats an absent weekday as a day off when hours are configured', () => {
    const a = normalizeAvailability({ mon: [{ start: '09:00', end: '12:00' }] })
    expect(rangesForDate(a, '2026-06-23')).toEqual([]) // Tuesday — not configured
  })

  it('falls back to a default weekday window when NO hours are configured', () => {
    expect(rangesForDate({}, '2026-06-22')).toEqual([{ start: '09:00', end: '17:00' }]) // Mon
    expect(rangesForDate({}, '2026-06-28')).toEqual([]) // Sun — off by default
  })
})

describe('slots — computeFreeSlots', () => {
  it('slices a range into duration-sized slots', () => {
    const slots = computeFreeSlots([{ start: '09:00', end: '10:00' }], 30, [])
    expect(slots).toEqual([
      { start: '09:00', end: '09:30' },
      { start: '09:30', end: '10:00' },
    ])
  })

  it('drops the trailing partial slot that does not fit the duration', () => {
    const slots = computeFreeSlots([{ start: '09:00', end: '10:00' }], 45, [])
    expect(slots).toEqual([{ start: '09:00', end: '09:45' }])
  })

  it('removes slots that overlap a busy interval', () => {
    const slots = computeFreeSlots([{ start: '09:00', end: '11:00' }], 30, [
      { start: '09:30', end: '10:00' },
    ])
    expect(slots.map((s) => s.start)).toEqual(['09:00', '10:00', '10:30'])
  })

  it('honours split shifts (lunch break)', () => {
    const slots = computeFreeSlots(
      [{ start: '09:00', end: '10:00' }, { start: '14:00', end: '15:00' }],
      60,
      [],
    )
    expect(slots.map((s) => s.start)).toEqual(['09:00', '14:00'])
  })

  it('returns nothing for a non-positive duration', () => {
    expect(computeFreeSlots([{ start: '09:00', end: '17:00' }], 0, [])).toEqual([])
  })
})
