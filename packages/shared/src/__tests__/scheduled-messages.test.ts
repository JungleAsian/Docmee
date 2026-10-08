import { describe, it, expect } from 'vitest'
import * as shared from '../index.js'

describe('scheduled message policy', () => {
  it('requires an explicit clinic opt-in', () => {
    expect(shared.scheduledMessagesEnabled({})).toBe(false)
    expect(shared.scheduledMessagesEnabled({ scheduledMessages: { enabled: true } })).toBe(true)
  })
  it('blocks overdue text and uses a strict channel-specific 24h window', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(shared.scheduledDeliveryTimeReason('2026-10-07T11:44:59Z', now)).toBe('overdue')
    expect(shared.scheduledDeliveryTimeReason('2026-10-07T11:45:00Z', now)).toBe(null)
    expect(shared.scheduledTextWindowOpen('2026-10-06T12:00:00Z', now)).toBe(false)
    expect(shared.scheduledTextWindowOpen('2026-10-06T12:00:01Z', now)).toBe(true)
    expect(shared.scheduledTextWindowOpen(null, now)).toBe(false)
    expect(shared.scheduledTextWindowOpen('2026-10-07T12:01:00Z', now)).toBe(false)
  })
  it('rejects dynamic, header/button, unapproved and unknown template structure', () => {
    const template = { status: 'approved', metaStatus: 'APPROVED', body: 'Synthetic notice', components: [{ type: 'BODY', text: 'Synthetic notice' }] }
    expect(shared.isSafeScheduledTemplate(template)).toBe(true)
    expect(shared.isSafeScheduledTemplate({ ...template, body: 'Hello {{1}}' })).toBe(false)
    expect(shared.isSafeScheduledTemplate({ ...template, components: [{ type: 'HEADER', text: 'Header' }] })).toBe(false)
    expect(shared.isSafeScheduledTemplate({ ...template, components: [{ type: 'BUTTONS', buttons: [] }] })).toBe(false)
    expect(shared.isSafeScheduledTemplate({ ...template, components: null })).toBe(false)
    expect(shared.isSafeScheduledTemplate({ ...template, metaStatus: 'PAUSED' })).toBe(false)
    expect(shared.isSafeScheduledTemplate({ ...template, components: [{ type: 'BODY', text: 'Different notice' }] })).toBe(false)
  })
})
