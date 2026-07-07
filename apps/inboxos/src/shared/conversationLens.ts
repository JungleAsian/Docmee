// Screen 1 — inbox list operational lenses (pure).
//
// The granular 7-state status filter is precise but not how a secretary actually
// triages: they think in four operational buckets — what the bot is handling, what
// needs a human, what they own, and what's done. These four lenses (mirrors the
// approved high-fidelity design's Active / Bot / Assigned / Closed tabs) sit over
// the SAME full clinic set the list already loads (GET /conversations is unpaginated),
// so they're a complete client-side view and carry live counts.
//
// Bot vs Active partition the live (non-closed) set; Assigned is a cross-cut over the
// live set; Closed is terminal. A thread can therefore match both Active and Assigned
// (an escalation you own) — these are lenses, not a strict partition.
import type { Conversation, ConversationStatus } from './types'

export type ConversationLens = 'active' | 'bot' | 'assigned' | 'closed'

export const LENSES: ConversationLens[] = ['active', 'bot', 'assigned', 'closed']

const CLOSED_STATUSES: ConversationStatus[] = ['resolved', 'archived']

export function isClosed(status: ConversationStatus): boolean {
  return CLOSED_STATUSES.includes(status)
}

// A thread the bot is auto-answering on its own: still open and nobody has taken it.
// The moment a human owns it (assignedTo) or it leaves 'open' (pending/handoff/
// snoozed), it stops being a pure bot thread and becomes Active.
function isBot(c: Conversation): boolean {
  return c.status === 'open' && !c.assignedTo
}

export function matchesLens(c: Conversation, lens: ConversationLens): boolean {
  switch (lens) {
    case 'closed':
      return isClosed(c.status)
    case 'assigned':
      return !isClosed(c.status) && !!c.assignedTo
    case 'bot':
      return !isClosed(c.status) && isBot(c)
    case 'active':
      // Everything still live that isn't a pure bot-auto-answer thread.
      return !isClosed(c.status) && !isBot(c)
  }
}

export function lensCounts(rows: Conversation[]): Record<ConversationLens, number> {
  const counts: Record<ConversationLens, number> = { active: 0, bot: 0, assigned: 0, closed: 0 }
  for (const c of rows) {
    for (const lens of LENSES) {
      if (matchesLens(c, lens)) counts[lens]++
    }
  }
  return counts
}
