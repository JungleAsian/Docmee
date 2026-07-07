import { describe, it, expect } from 'vitest'
import { computeFreeSlots, DEFAULT_BOOKING_GRID } from '../calbot/google-calendar-client.js'

const TZ = 'America/Guatemala'

describe('computeFreeSlots — configurable grid (CRE-47)', () => {
  it('defaults to 09:00–18:00 / 30-min → 18 slots', () => {
    const slots = computeFreeSlots([], '2026-07-01', TZ)
    expect(slots.length).toBe(18)
    expect(slots[0]!.start).toBe('2026-07-01T09:00:00')
    expect(slots[slots.length - 1]!.start).toBe('2026-07-01T17:30:00')
  })

  it('honors a custom grid (08:00–12:00, 15-min → 16 slots)', () => {
    const slots = computeFreeSlots([], '2026-07-01', TZ, { startHour: 8, endHour: 12, slotMinutes: 15 })
    expect(slots.length).toBe(16)
    expect(slots[0]!.start).toBe('2026-07-01T08:00:00')
    expect(slots[15]!.start).toBe('2026-07-01T11:45:00')
  })

  it('excludes slots overlapping an existing event', () => {
    const events = [{ start: { dateTime: '2026-07-01T09:00:00' }, end: { dateTime: '2026-07-01T09:30:00' } }]
    const slots = computeFreeSlots(events, '2026-07-01', TZ)
    expect(slots.find((s) => s.start === '2026-07-01T09:00:00')).toBeUndefined()
    expect(slots.length).toBe(17)
  })

  it('DEFAULT_BOOKING_GRID matches the legacy 9–18/30 grid', () => {
    expect(DEFAULT_BOOKING_GRID).toEqual({ startHour: 9, endHour: 18, slotMinutes: 30 })
  })
})
