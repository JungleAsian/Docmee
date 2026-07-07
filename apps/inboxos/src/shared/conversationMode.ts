// Req 5 / Req 6 — who is driving a thread. The bot auto-answers an open thread; the
// moment a human is assigned or the thread is escalated (handoff), a secretary is in
// control and the bot is paused for that conversation. Shared by the list (mode pill
// per row) and the conversation view (header pill + composer banner) so both surfaces
// agree on a single source of truth.
import type { ConversationStatus } from './types'

export type ConversationMode = 'bot' | 'human'

export function conversationMode(status: ConversationStatus | undefined | null): ConversationMode {
  return status === 'assigned' || status === 'handoff' ? 'human' : 'bot'
}
