// Req 11 — the 7-state conversation lifecycle, rendered as a vertical timeline in
// the context pane so a secretary can see at a glance where a thread sits. The
// statuses are shown in their natural operational progression; the conversation's
// current status is highlighted, everything before it is marked done, everything
// after is upcoming. This is a progress indicator over the real 7 statuses (not a
// separate narrative), so it can never drift from the status the rest of the inbox
// acts on.
import type { ConversationStatus } from './types'

export type LifecycleState = 'done' | 'current' | 'upcoming'

// Natural left-to-right order of the lifecycle. `assigned` and `handoff` are both
// "a human is on it" and sit together; pending/snoozed are holding states ahead of
// resolution; archived is terminal.
export const LIFECYCLE_ORDER: ConversationStatus[] = [
  'open',
  'pending',
  'assigned',
  'handoff',
  'snoozed',
  'resolved',
  'archived',
]

export interface LifecycleStep {
  status: ConversationStatus
  state: LifecycleState
}

export function lifecycleSteps(current: ConversationStatus | undefined | null): LifecycleStep[] {
  const idx = current ? LIFECYCLE_ORDER.indexOf(current) : -1
  return LIFECYCLE_ORDER.map((status, i) => ({
    status,
    state: idx < 0 ? 'upcoming' : i < idx ? 'done' : i === idx ? 'current' : 'upcoming',
  }))
}
