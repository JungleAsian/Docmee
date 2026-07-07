import { describe, it, expect, afterEach } from 'vitest'
import { localTimeIn } from '../reports.worker.js'
import { buildReviewLink } from '../review-request.worker.js'

describe('localTimeIn', () => {
  it('converts a UTC instant to the clinic-local hour', () => {
    // 2026-06-15T14:00:00Z is 08:00 in Guatemala (UTC-6).
    const now = new Date('2026-06-15T14:00:00Z')
    const local = localTimeIn('America/Guatemala', now)
    expect(local.hour).toBe(8)
  })

  it('reports the local weekday (0=Sun)', () => {
    // 2026-06-15 is a Monday.
    const local = localTimeIn('America/Guatemala', new Date('2026-06-15T14:00:00Z'))
    expect(local.dayOfWeek).toBe(1)
  })

  it('falls back to UTC for a blank timezone', () => {
    const local = localTimeIn('', new Date('2026-06-15T09:00:00Z'))
    expect(local.hour).toBe(9)
  })
})

describe('buildReviewLink', () => {
  const original = process.env['PUBLIC_API_URL']
  afterEach(() => {
    if (original === undefined) delete process.env['PUBLIC_API_URL']
    else process.env['PUBLIC_API_URL'] = original
  })

  it('builds a tracking redirect when a base URL is set', () => {
    process.env['PUBLIC_API_URL'] = 'https://api.docmee.app/'
    expect(buildReviewLink('fu-1', 'https://maps.example/x')).toBe('https://api.docmee.app/r/fu-1')
  })

  it('falls back to the raw review link with no base URL', () => {
    delete process.env['PUBLIC_API_URL']
    expect(buildReviewLink('fu-1', 'https://maps.example/x')).toBe('https://maps.example/x')
  })
})
