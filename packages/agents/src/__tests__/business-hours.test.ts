import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { isInsideBusinessHours } from '../botbase/business-hours.js'

// 2026-06-18T16:00:00Z === Thursday 10:00 in America/Guatemala (UTC-6, no DST).
const TZ = 'America/Guatemala'

beforeAll(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-18T16:00:00Z'))
})

afterAll(() => {
  vi.useRealTimers()
})

describe('isInsideBusinessHours', () => {
  it('inside the open window → true', () => {
    expect(isInsideBusinessHours({ thursday: { open: '09:00', close: '17:00' } }, TZ)).toBe(true)
  })

  it('before opening → false', () => {
    expect(isInsideBusinessHours({ thursday: { open: '11:00', close: '17:00' } }, TZ)).toBe(false)
  })

  it('after closing → false', () => {
    expect(isInsideBusinessHours({ thursday: { open: '07:00', close: '09:30' } }, TZ)).toBe(false)
  })

  it('closed day → false', () => {
    expect(isInsideBusinessHours({ thursday: { open: '09:00', close: '17:00', closed: true } }, TZ)).toBe(false)
  })

  it('weekday not configured → false', () => {
    expect(isInsideBusinessHours({ monday: { open: '09:00', close: '17:00' } }, TZ)).toBe(false)
  })

  it('no configured hours → always open (true)', () => {
    expect(isInsideBusinessHours({}, TZ)).toBe(true)
    expect(isInsideBusinessHours(null, TZ)).toBe(true)
  })
})
