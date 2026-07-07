import { describe, it, expect } from 'vitest'
import {
  normalizeNotificationPrefs,
  isEmailAllowedByPrefs,
  DEFAULT_NOTIFICATION_PREFS,
} from '../preferences.js'

describe('normalizeNotificationPrefs', () => {
  it('an empty/absent value → permissive default (email on, nothing muted)', () => {
    expect(normalizeNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(normalizeNotificationPrefs(null)).toEqual(DEFAULT_NOTIFICATION_PREFS)
    expect(normalizeNotificationPrefs(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS)
  })

  it('emailEnabled is only false when explicitly false', () => {
    expect(normalizeNotificationPrefs({ emailEnabled: false }).emailEnabled).toBe(false)
    expect(normalizeNotificationPrefs({ emailEnabled: true }).emailEnabled).toBe(true)
    // A missing/garbage flag stays on so alerts are never silently swallowed.
    expect(normalizeNotificationPrefs({ emailEnabled: 'nope' }).emailEnabled).toBe(true)
  })

  it('keeps only known alert types in mutedTypes and dedupes them', () => {
    const prefs = normalizeNotificationPrefs({
      mutedTypes: ['new_patient', 'new_patient', 'not_a_real_type', 'daily_summary'],
    })
    expect(prefs.mutedTypes).toEqual(['new_patient', 'daily_summary'])
  })

  it('a non-array mutedTypes → empty list', () => {
    expect(normalizeNotificationPrefs({ mutedTypes: 'new_patient' }).mutedTypes).toEqual([])
  })
})

describe('isEmailAllowedByPrefs', () => {
  it('master switch off → no email for any type', () => {
    const prefs = { emailEnabled: false, soundEnabled: false, mutedTypes: [] as never[] }
    expect(isEmailAllowedByPrefs(prefs, 'new_patient')).toBe(false)
    expect(isEmailAllowedByPrefs(prefs, 'booking_confirmed')).toBe(false)
  })

  it('a muted type → no email; an unmuted type → email', () => {
    const prefs = normalizeNotificationPrefs({ mutedTypes: ['new_patient'] })
    expect(isEmailAllowedByPrefs(prefs, 'new_patient')).toBe(false)
    expect(isEmailAllowedByPrefs(prefs, 'booking_confirmed')).toBe(true)
  })

  it('the default prefs allow every type', () => {
    expect(isEmailAllowedByPrefs(DEFAULT_NOTIFICATION_PREFS, 'daily_summary')).toBe(true)
  })
})
