// Screen 1 — inbox list operational lenses (pure).
//
// The granular 7-state status filter is precise but not how a secretary actually
// triages: they need the whole queue, what the bot is handling, what needs a human,
// and what is already assigned. These four lenses sit over
// the SAME full clinic set the list already loads (GET /conversations is unpaginated),
// so they're a complete client-side view and carry live counts.
//
// Secretary vs Bot partition the live (non-closed) set; Assigned is a cross-cut over
// the live set; All includes terminal conversations for complete history.
import type { Conversation, ConversationStatus } from './types'

export type ConversationLens = 'all' | 'secretary' | 'bot' | 'assigned'

export const LENSES: ConversationLens[] = ['all', 'secretary', 'bot', 'assigned']

const CLOSED_STATUSES: ConversationStatus[] = ['resolved', 'archived']

export function isClosed(status: ConversationStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

/** True only when an open conversation is owned by the supplied user. */
export function isAssignedToUser(c: Conversation, userId: string | null | undefined): boolean {
  return Boolean(userId) && !isClosed(c.status) && c.assignedTo === userId
}

// A thread the bot is auto-answering on its own: still open and nobody has taken it.
// The moment a human owns it (assignedTo) or it leaves 'open' (pending/handoff/
// snoozed), it stops being a pure bot thread and becomes Active.
function isBot(c: Conversation): boolean {
  return c.status === 'open' && !c.assignedTo
}

export function matchesLens(c: Conversation, lens: ConversationLens): boolean {
  switch (lens) {
    case 'all':
      return true
    case 'assigned':
      return !isClosed(c.status) && !!c.assignedTo
    case 'bot':
      return !isClosed(c.status) && isBot(c)
    case 'secretary':
      // Everything still live that isn't a pure bot-auto-answer thread.
      return !isClosed(c.status) && !isBot(c)
  }
}

export function lensCounts(rows: Conversation[]): Record<ConversationLens, number> {
  const counts: Record<ConversationLens, number> = { all: 0, secretary: 0, bot: 0, assigned: 0 }
  for (const c of rows) {
    for (const lens of LENSES) {
      if (matchesLens(c, lens)) counts[lens]++
    }
  }
  return counts
}
