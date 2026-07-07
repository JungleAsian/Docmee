import { describe, it, expect } from 'vitest'
import { routeNotification, isOnline, ONLINE_WINDOW_MINUTES } from '../routing.js'

describe('routeNotification', () => {
  it('p1 always emails — online or offline', () => {
    expect(routeNotification('p1', true)).toEqual({ panel: true, email: true, channel: 'email' })
    expect(routeNotification('p1', false)).toEqual({ panel: true, email: true, channel: 'email' })
  })

  it('p2 emails only when the recipient is offline', () => {
    expect(routeNotification('p2', true)).toEqual({ panel: true, email: false, channel: 'in_app' })
    expect(routeNotification('p2', false)).toEqual({ panel: true, email: true, channel: 'email' })
  })

  it('standard emails only when the recipient is offline', () => {
    expect(routeNotification('standard', true)).toEqual({ panel: true, email: false, channel: 'in_app' })
    expect(routeNotification('standard', false)).toEqual({ panel: true, email: true, channel: 'email' })
  })

  it('unknown presence is treated as offline (alert is never silently withheld)', () => {
    expect(routeNotification('standard', undefined).email).toBe(true)
    expect(routeNotification('p2').email).toBe(true)
  })

  it('always records a panel entry', () => {
    for (const p of ['p1', 'p2', 'standard'] as const) {
      expect(routeNotification(p, true).panel).toBe(true)
      expect(routeNotification(p, false).panel).toBe(true)
    }
  })

  describe('emailAllowed preference gate', () => {
    it('defaults to true — unchanged behaviour when no preference is passed', () => {
      expect(routeNotification('p2', false).email).toBe(true)
      expect(routeNotification('standard', false).email).toBe(true)
    })

    it('a muted (emailAllowed=false) non-urgent alert → panel only, even when offline', () => {
      expect(routeNotification('p2', false, false)).toEqual({
        panel: true,
        email: false,
        channel: 'in_app',
      })
      expect(routeNotification('standard', false, false).email).toBe(false)
    })

    it('p1 still emails even when the preference would mute it (safety override)', () => {
      expect(routeNotification('p1', true, false).email).toBe(true)
      expect(routeNotification('p1', false, false).email).toBe(true)
    })

    it('an allowed (emailAllowed=true) offline alert still emails', () => {
      expect(routeNotification('p2', false, true).email).toBe(true)
    })
  })
})

describe('isOnline', () => {
  const now = new Date('2026-06-19T12:00:00.000Z')

  it('null / never-seen → offline', () => {
    expect(isOnline(null, now)).toBe(false)
    expect(isOnline(undefined, now)).toBe(false)
  })

  it('within the window → online', () => {
    const recent = new Date(now.getTime() - (ONLINE_WINDOW_MINUTES - 1) * 60_000).toISOString()
    expect(isOnline(recent, now)).toBe(true)
  })

  it('past the window → offline', () => {
    const stale = new Date(now.getTime() - (ONLINE_WINDOW_MINUTES + 1) * 60_000).toISOString()
    expect(isOnline(stale, now)).toBe(false)
  })

  it('garbage timestamp → offline', () => {
    expect(isOnline('not-a-date', now)).toBe(false)
  })
})
