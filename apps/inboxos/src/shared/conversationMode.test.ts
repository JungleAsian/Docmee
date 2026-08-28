import { describe, expect, it } from 'vitest'
import { automationTransitionSteps, conversationMode } from './conversationMode'

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

  it('uses the persistent patient automation mode when the conversation is opted out', () => {
    expect(conversationMode('open', 'human_only')).toBe('human')
    expect(conversationMode('pending', 'human_only')).toBe('human')
    expect(conversationMode('open', 'automated')).toBe('bot')
  })

  it('blocks patient automation before placing a conversation in secretary mode', () => {
    expect(automationTransitionSteps('human', 'conversation-1', 'patient-1')).toEqual([
      {
        method: 'patch',
        path: '/patients/patient-1/automation-mode',
        body: { automationMode: 'human_only' },
      },
      {
        method: 'post',
        path: '/conversations/conversation-1/status',
        body: { status: 'handoff' },
      },
    ])
  })

  it('reopens the conversation before re-enabling AI mode for the patient', () => {
    expect(automationTransitionSteps('bot', 'conversation-1', 'patient-1')).toEqual([
      {
        method: 'post',
        path: '/conversations/conversation-1/resume-bot',
      },
      {
        method: 'patch',
        path: '/patients/patient-1/automation-mode',
        body: { automationMode: 'automated' },
      },
    ])
  })
})
