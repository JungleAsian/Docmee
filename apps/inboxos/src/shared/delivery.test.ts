import { describe, it, expect } from 'vitest'
import { deliveryIndicator } from './delivery'

describe('deliveryIndicator', () => {
  it('shows a single check for a sent assistant reply', () => {
    const ind = deliveryIndicator({ role: 'assistant', deliveryStatus: 'sent' })
    expect(ind).toEqual({ glyph: '✓', tone: 'muted', labelKey: 'view.delivery.sent' })
  })

  it('shows a double check for a delivered reply', () => {
    expect(deliveryIndicator({ role: 'assistant', deliveryStatus: 'delivered' })?.glyph).toBe('✓✓')
    expect(deliveryIndicator({ role: 'assistant', deliveryStatus: 'delivered' })?.tone).toBe('muted')
  })

  it('marks a read reply with the read tone (blue check)', () => {
    const ind = deliveryIndicator({ role: 'agent', deliveryStatus: 'read' })
    expect(ind?.glyph).toBe('✓✓')
    expect(ind?.tone).toBe('read')
    expect(ind?.labelKey).toBe('view.delivery.read')
  })

  it('flags a failed send with the failed tone', () => {
    const ind = deliveryIndicator({ role: 'assistant', deliveryStatus: 'failed' })
    expect(ind?.glyph).toBe('⚠')
    expect(ind?.tone).toBe('failed')
  })

  it('renders nothing for inbound patient messages even if a status leaked in', () => {
    expect(deliveryIndicator({ role: 'user', deliveryStatus: 'read' })).toBeNull()
  })

  it('renders nothing for system messages', () => {
    expect(deliveryIndicator({ role: 'system', deliveryStatus: 'sent' })).toBeNull()
  })

  it('renders nothing for an outbound message with no receipt yet (Messenger/Instagram/pre-feature)', () => {
    expect(deliveryIndicator({ role: 'assistant', deliveryStatus: null })).toBeNull()
    expect(deliveryIndicator({ role: 'assistant', deliveryStatus: undefined })).toBeNull()
  })
})
