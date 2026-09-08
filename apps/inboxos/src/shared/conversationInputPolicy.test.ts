import { describe, expect, it } from 'vitest'
import { conversationSearchInputProps, deleteConversationPasswordInputProps } from './conversationInputPolicy'

describe('conversation input autofill boundaries', () => {
  it('keeps credential autofill out of the conversation search box', () => {
    expect(conversationSearchInputProps()).toEqual({
      type: 'search',
      name: 'conversation-search',
      autoComplete: 'off',
    })
  })

  it('marks the delete password field as a password-only field', () => {
    expect(deleteConversationPasswordInputProps()).toEqual({
      type: 'password',
      name: 'delete-conversation-password',
      autoComplete: 'new-password',
    })
  })
})