/** Keep browser credential autofill out of unrelated Inbox inputs. */
export function conversationSearchInputProps() {
  return { type: 'search' as const, name: 'conversation-search', autoComplete: 'off' as const }
}

export function deleteConversationPasswordInputProps() {
  return { type: 'password' as const, name: 'delete-conversation-password', autoComplete: 'new-password' as const }
}
