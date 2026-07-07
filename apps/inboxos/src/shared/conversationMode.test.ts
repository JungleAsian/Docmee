import { describe, expect, it } from 'vitest'
import { conversationMode } from './conversationMode'

describe('conversationMode', () => {
  it('is human when a secretary owns the thread', () => {
    expect(conversationMode('assigned')).toBe('human')
    expect(conversationMode('handoff')).toBe('human')
  })

  it('is bot for every other status', () => {
    expect(conversationMode('open')).toBe('bot')
    expect(conversationMode('pending')).toBe('bot')
    expect(conversationMode('snoozed')).toBe('bot')
    expect(conversationMode('resolved')).toBe('bot')
    expect(conversationMode('archived')).toBe('bot')
  })

  it('defaults to bot when the status is unknown', () => {
    expect(conversationMode(undefined)).toBe('bot')
    expect(conversationMode(null)).toBe('bot')
  })
})
