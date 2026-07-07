import { describe, it, expect } from 'vitest'
import {
  ALERT_TYPES,
  MUTABLE_ALERT_TYPES,
  NOTIFICATION_PRIORITY,
  PRIORITY_DOT,
  alertHandling,
  alertIcon,
  alertLabelKey,
  alertPriority,
  channelLabel,
  isHandoffAlert,
  isSafetyAlert,
} from './notifications'

// The five p1 safety alerts that the requirement states can NEVER be muted.
// Kept literal here (not derived from the map) so a drift in either direction fails.
const P1_SAFETY_TYPES = [
  'emergency',
  'human_handoff_requested',
  'bot_failed',
  'upset_patient',
  'secretary_escalated',
]

describe('notification priority mirror', () => {
  it('carries the canonical 20 alert types', () => {
    expect(ALERT_TYPES).toHaveLength(20)
  })

  it('classifies every p1 safety alert as p1', () => {
    for (const type of P1_SAFETY_TYPES) {
      expect(alertPriority(type)).toBe('p1')
    }
  })

  it('NEVER lets a p1 safety alert be muted (the core preference invariant)', () => {
    for (const type of P1_SAFETY_TYPES) {
      expect(MUTABLE_ALERT_TYPES).not.toContain(type)
    }
  })

  it('excludes exactly the p1 types from the mutable set', () => {
    const p1 = ALERT_TYPES.filter((t) => NOTIFICATION_PRIORITY[t] === 'p1')
    expect([...p1].sort()).toEqual([...P1_SAFETY_TYPES].sort())
    // Every non-p1 type is mutable; no p1 type is.
    expect(MUTABLE_ALERT_TYPES).toHaveLength(ALERT_TYPES.length - p1.length)
  })

  it('defaults to standard priority for an unknown, null or undefined type', () => {
    expect(alertPriority('not_a_real_alert')).toBe('standard')
    expect(alertPriority(null)).toBe('standard')
    expect(alertPriority(undefined)).toBe('standard')
  })

  it('builds the i18n label key for an alert type', () => {
    expect(alertLabelKey('emergency')).toBe('notif.type.emergency')
    expect(alertLabelKey('booking_confirmed')).toBe('notif.type.booking_confirmed')
  })

  it('maps each priority to a distinct dot colour', () => {
    expect(PRIORITY_DOT.p1).toContain('red')
    expect(PRIORITY_DOT.p2).toContain('amber')
    expect(PRIORITY_DOT.standard).toContain('gray')
  })
})

describe('alert row signifiers (Screen 11)', () => {
  it('gives every alert type a glyph and falls back for unknown/empty', () => {
    for (const type of ALERT_TYPES) {
      expect(alertIcon(type)).toBeTruthy()
    }
    expect(alertIcon('not_a_real_alert')).toBe('🔔')
    expect(alertIcon(null)).toBe('🔔')
  })

  it('flags only the emergency type as a patient-safety alert', () => {
    expect(isSafetyAlert('emergency')).toBe(true)
    expect(isSafetyAlert('human_handoff_requested')).toBe(false)
    expect(isSafetyAlert('booking_confirmed')).toBe(false)
    expect(isSafetyAlert(null)).toBe(false)
  })

  it('flags handoff-class alerts (asked-for-human, bot failure, escalation)', () => {
    expect(isHandoffAlert('human_handoff_requested')).toBe(true)
    expect(isHandoffAlert('bot_failed')).toBe(true)
    expect(isHandoffAlert('secretary_escalated')).toBe(true)
    expect(isHandoffAlert('booking_confirmed')).toBe(false)
  })

  it('derives the handling mode from the taxonomy (human / bot / system)', () => {
    expect(alertHandling('emergency')).toBe('human')
    expect(alertHandling('human_handoff_requested')).toBe('human')
    expect(alertHandling('booking_confirmed')).toBe('bot')
    expect(alertHandling('new_patient')).toBe('bot')
    expect(alertHandling('license_expiring')).toBe('system')
    expect(alertHandling(null)).toBe('system')
  })

  it('labels known channels and capitalises unknown ones, else null', () => {
    expect(channelLabel('whatsapp')).toBe('WhatsApp')
    expect(channelLabel('instagram')).toBe('Instagram')
    expect(channelLabel('telegram')).toBe('Telegram')
    expect(channelLabel(undefined)).toBeNull()
    expect(channelLabel(123)).toBeNull()
  })
})
