import { describe, it, expect } from 'vitest'
import { waitingMinutes, slaLevel, formatWaiting } from './sla'

const NOW = new Date('2026-06-25T12:00:00Z').getTime()

describe('waitingMinutes', () => {
  it('is null when the latest message is not from the patient', () => {
    expect(waitingMinutes('2026-06-25T11:00:00Z', 'assistant', NOW)).toBeNull()
    expect(waitingMinutes('2026-06-25T11:00:00Z', 'agent', NOW)).toBeNull()
  })
  it('is null with no timestamp', () => {
    expect(waitingMinutes(null, 'user', NOW)).toBeNull()
  })
  it('counts minutes since an unanswered patient message', () => {
    expect(waitingMinutes('2026-06-25T11:30:00Z', 'user', NOW)).toBe(30)
  })
  it('is null for a future timestamp (clock skew)', () => {
    expect(waitingMinutes('2026-06-25T12:05:00Z', 'user', NOW)).toBeNull()
  })
})

describe('slaLevel', () => {
  it('escalates ok -> warn -> breach', () => {
    expect(slaLevel(5)).toBe('ok')
    expect(slaLevel(20)).toBe('warn')
    expect(slaLevel(75)).toBe('breach')
  })
})

describe('formatWaiting', () => {
  it('humanizes minutes', () => {
    expect(formatWaiting(5)).toBe('5m')
    expect(formatWaiting(80)).toBe('1h 20m')
    expect(formatWaiting(120)).toBe('2h')
    expect(formatWaiting(1500)).toBe('1d')
  })
})
