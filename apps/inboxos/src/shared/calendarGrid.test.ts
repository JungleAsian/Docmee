import { describe, it, expect } from 'vitest'
import {
  normalizeAvailability,
  rangesForDate,
  weekdayOf,
  buildDayAxis,
  formatRanges,
  isSplitShift,
} from './calendarGrid'

describe('calendarGrid', () => {
  it('maps a date to its weekday (UTC-based)', () => {
    expect(weekdayOf('2026-06-19')).toBe('fri')
    expect(weekdayOf('2026-06-20')).toBe('sat')
    expect(weekdayOf('2026-06-22')).toBe('mon')
  })

  it('normalizes availability and drops malformed ranges', () => {
    const a = normalizeAvailability({
      mon: [{ start: '09:00', end: '13:00' }, { start: 'bad', end: '17:00' }],
      xyz: [{ start: '08:00', end: '09:00' }],
      tue: 'nope',
    })
    expect(a.mon).toEqual([{ start: '09:00', end: '13:00' }])
    expect(a.tue).toBeUndefined()
    expect((a as Record<string, unknown>).xyz).toBeUndefined()
  })

  it('falls back to Mon–Fri 09:00–17:00 when no hours are configured', () => {
    expect(rangesForDate({}, '2026-06-22')).toEqual([{ start: '09:00', end: '17:00' }]) // Mon
    expect(rangesForDate({}, '2026-06-20')).toEqual([]) // Sat → off
  })

  it('returns sorted ranges for a configured day, [] for a day off', () => {
    const av = normalizeAvailability({
      mon: [{ start: '14:00', end: '17:00' }, { start: '09:00', end: '13:00' }],
    })
    expect(rangesForDate(av, '2026-06-22')).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ])
    expect(rangesForDate(av, '2026-06-23')).toEqual([]) // Tue not configured
  })

  it('builds a split-shift axis with a break band for the lunch gap', () => {
    const rows = buildDayAxis([
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ])
    // 09:00 → working, last row is 16:30, 13:00 / 13:30 are the break band.
    expect(rows[0]).toEqual({ time: '09:00', kind: 'working' })
    expect(rows.at(-1)).toEqual({ time: '16:30', kind: 'working' })
    expect(rows.find((r) => r.time === '13:00')?.kind).toBe('break')
    expect(rows.find((r) => r.time === '13:30')?.kind).toBe('break')
    expect(rows.find((r) => r.time === '14:00')?.kind).toBe('working')
  })

  it('returns an empty axis for a day off', () => {
    expect(buildDayAxis([])).toEqual([])
  })

  it('formats ranges and detects split shifts', () => {
    const ranges = [
      { start: '09:00', end: '13:00' },
      { start: '14:00', end: '17:00' },
    ]
    expect(formatRanges(ranges)).toBe('09:00–13:00, 14:00–17:00')
    expect(isSplitShift(ranges)).toBe(true)
    expect(isSplitShift([{ start: '09:00', end: '17:00' }])).toBe(false)
  })
})
