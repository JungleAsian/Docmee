import { describe, it, expect } from 'vitest'
import {
  shouldEscalate,
  pickEscalationRecipient,
  ESCALATION_AFTER_MINUTES,
} from '../escalation.js'

describe('shouldEscalate', () => {
  it('escalates an old, unacknowledged p1 alert', () => {
    expect(
      shouldEscalate({ priority: 'p1', ageMinutes: ESCALATION_AFTER_MINUTES, status: 'sent' }),
    ).toBe(true)
  })

  it('does not escalate before the window', () => {
    expect(
      shouldEscalate({ priority: 'p1', ageMinutes: ESCALATION_AFTER_MINUTES - 1, status: 'sent' }),
    ).toBe(false)
  })

  it('never escalates non-p1 alerts', () => {
    expect(shouldEscalate({ priority: 'p2', ageMinutes: 999, status: 'sent' })).toBe(false)
    expect(shouldEscalate({ priority: 'standard', ageMinutes: 999, status: 'sent' })).toBe(false)
  })

  it('does not escalate an acknowledged or skipped alert', () => {
    expect(shouldEscalate({ priority: 'p1', ageMinutes: 999, status: 'acknowledged' })).toBe(false)
    expect(shouldEscalate({ priority: 'p1', ageMinutes: 999, status: 'skipped' })).toBe(false)
  })

  it('escalates a failed-delivery p1 alert (nobody got it)', () => {
    expect(shouldEscalate({ priority: 'p1', ageMinutes: 999, status: 'failed' })).toBe(true)
  })
})

describe('pickEscalationRecipient', () => {
  it('prefers the clinic admin', () => {
    expect(
      pickEscalationRecipient({
        originalRecipient: 'sec@c.com',
        adminEmail: 'admin@c.com',
        fallbackEmail: 'ops@docmee.app',
      }),
    ).toBe('admin@c.com')
  })

  it('falls back when there is no admin', () => {
    expect(
      pickEscalationRecipient({ originalRecipient: 'sec@c.com', fallbackEmail: 'ops@docmee.app' }),
    ).toBe('ops@docmee.app')
  })

  it('never re-notifies the original recipient (case-insensitive)', () => {
    expect(
      pickEscalationRecipient({
        originalRecipient: 'Admin@C.com',
        adminEmail: 'admin@c.com',
        fallbackEmail: 'ops@docmee.app',
      }),
    ).toBe('ops@docmee.app')
  })

  it('returns null when there is nobody new to escalate to', () => {
    expect(
      pickEscalationRecipient({ originalRecipient: 'sec@c.com', adminEmail: 'sec@c.com' }),
    ).toBeNull()
    expect(pickEscalationRecipient({ originalRecipient: 'sec@c.com' })).toBeNull()
  })
})
