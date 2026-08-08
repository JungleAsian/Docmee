import { describe, expect, it } from 'vitest'
import { doctorDayGrid } from '../workflow-runner.worker.js'

// A Wednesday, so weekday-specific fixtures below line up predictably.
const WED = '2026-08-05'
const SUN = '2026-08-09'

describe('doctorDayGrid', () => {
  it('falls back to the default grid (null) when the doctor has no availableDays at all', () => {
    expect(doctorDayGrid(undefined, WED)).toBeNull()
    expect(doctorDayGrid(null, WED)).toBeNull()
    expect(doctorDayGrid({}, WED)).toBeNull()
  })

  it('is a day off when availableDays is configured but this weekday has no ranges', () => {
    expect(doctorDayGrid({ mon: [{ start: '09:00', end: '17:00' }] }, WED)).toBe('off')
  })

  it('builds a grid from a single configured range for that weekday', () => {
    expect(doctorDayGrid({ wed: [{ start: '09:00', end: '17:00' }] }, WED)).toEqual({
      startHour: 9,
      endHour: 17,
      slotMinutes: 30,
    })
  })

  it('matches the real Dr. Contreras schedule found in production — extended weekday hours, a shorter Sunday', () => {
    const availableDays = {
      mon: [{ start: '09:00', end: '22:00' }],
      tue: [{ start: '09:00', end: '22:00' }],
      wed: [{ start: '09:00', end: '22:00' }],
      thu: [{ start: '09:00', end: '22:00' }],
      fri: [{ start: '09:00', end: '22:00' }],
      sat: [{ start: '09:00', end: '22:00' }],
      sun: [{ start: '11:00', end: '17:00' }],
    }
    expect(doctorDayGrid(availableDays, WED)).toEqual({ startHour: 9, endHour: 22, slotMinutes: 30 })
    expect(doctorDayGrid(availableDays, SUN)).toEqual({ startHour: 11, endHour: 17, slotMinutes: 30 })
  })

  it('collapses multiple ranges in one day to their outer span', () => {
    // A lunch-break split — BookingGrid can only express one contiguous
    // window, so the safe over-approximation is the earliest start to the
    // latest end (documented limitation, not a silent data-loss bug).
    const grid = doctorDayGrid({ wed: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }] }, WED)
    expect(grid).toEqual({ startHour: 9, endHour: 18, slotMinutes: 30 })
  })

  it('rounds a partial-hour boundary inward so it never offers time the doctor did not configure', () => {
    // 09:30–17:45 rounds to 10:00–17:00 — never wider than the real window.
    expect(doctorDayGrid({ wed: [{ start: '09:30', end: '17:45' }] }, WED)).toEqual({
      startHour: 10,
      endHour: 17,
      slotMinutes: 30,
    })
  })

  it('treats a malformed or reversed range as a day off rather than crashing', () => {
    expect(doctorDayGrid({ wed: [{ start: 'not-a-time', end: '17:00' }] }, WED)).toBe('off')
    expect(doctorDayGrid({ wed: [{ start: '17:00', end: '09:00' }] }, WED)).toBe('off')
    expect(doctorDayGrid({ wed: 'not-an-array' }, WED)).toBe('off')
  })
})
