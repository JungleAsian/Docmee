import { describe, it, expect } from 'vitest'
import { resolveNotificationType } from '../notification-processor.worker.js'

describe('resolveNotificationType', () => {
  it('maps alertflow reason "emergency" → emergency', () => {
    expect(resolveNotificationType({ reason: 'emergency' })).toBe('emergency')
  })

  it('maps alertflow reason "human_handoff" → human_handoff_requested', () => {
    expect(resolveNotificationType({ reason: 'human_handoff' })).toBe('human_handoff_requested')
  })

  it('maps the agent-worker reason "upset" → upset_patient', () => {
    expect(resolveNotificationType({ reason: 'upset' })).toBe('upset_patient')
  })

  it('maps the conversation-processor type "META_TOKEN_EXPIRING" → meta_token_expiring', () => {
    expect(resolveNotificationType({ type: 'META_TOKEN_EXPIRING' })).toBe('meta_token_expiring')
  })

  it('accepts a canonical lowercase type directly', () => {
    expect(resolveNotificationType({ type: 'booking_confirmed' })).toBe('booking_confirmed')
  })

  it('returns null for an unmappable job', () => {
    expect(resolveNotificationType({ reason: 'something_else' })).toBeNull()
    expect(resolveNotificationType({})).toBeNull()
  })
})
