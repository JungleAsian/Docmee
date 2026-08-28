// Req 5 / Req 6 — who is driving a thread. The bot auto-answers an open thread; the
// moment a human is assigned or the thread is escalated (handoff), a secretary is in
// control and the bot is paused for that conversation. Shared by the list (mode pill
// per row) and the conversation view (header pill + composer banner) so both surfaces
// agree on a single source of truth.
import type { ConversationStatus } from './types'

export type ConversationMode = 'bot' | 'human'

export type AutomationTransitionStep = {
  method: 'patch' | 'post'
  path: string
  body?: Record<string, string>
}

export function conversationMode(
  status: ConversationStatus | undefined | null,
  automationMode?: 'automated' | 'human_only' | string | null,
): ConversationMode {
  if (automationMode === 'human_only') return 'human'
  return status === 'assigned' || status === 'handoff' ? 'human' : 'bot'
}

export function automationTransitionSteps(
  target: ConversationMode,
  conversationId: string,
  patientId: string,
): AutomationTransitionStep[] {
  if (target === 'human') {
    return [
      {
        method: 'patch',
        path: `/patients/${patientId}/automation-mode`,
        body: { automationMode: 'human_only' },
      },
      {
        method: 'post',
        path: `/conversations/${conversationId}/status`,
        body: { status: 'handoff' },
      },
    ]
  }

  return [
    {
      method: 'post',
      path: `/conversations/${conversationId}/resume-bot`,
    },
    {
      method: 'patch',
      path: `/patients/${patientId}/automation-mode`,
      body: { automationMode: 'automated' },
    },
  ]
}
