export type JzelChatTurn = { role: 'user' | 'assistant'; content: string }

export const JZEL_MAX_MESSAGE_CHARS = 2_000
export const JZEL_MAX_HISTORY_TURNS = 8
export const JZEL_MAX_HISTORY_TURN_CHARS = 1_000
export const JZEL_MAX_HISTORY_CHARS = 6_000
export const JZEL_MAX_RETRIEVED_CONTEXT_CHARS = 6_000

export function validateJzelHistory(history: unknown):
  | { ok: true; turns: JzelChatTurn[]; chars: number }
  | { ok: false; error: 'history_too_large' | 'history_turn_too_large' } {
  if (!Array.isArray(history)) return { ok: true, turns: [], chars: 0 }
  if (history.length > JZEL_MAX_HISTORY_TURNS) return { ok: false, error: 'history_too_large' }

  let chars = 0
  const turns: JzelChatTurn[] = []
  for (const turn of history) {
    if (!turn || typeof turn !== 'object' || !('content' in turn) || typeof turn.content !== 'string' || turn.content.length > JZEL_MAX_HISTORY_TURN_CHARS) {
      return { ok: false, error: 'history_turn_too_large' }
    }
    if (!('role' in turn) || (turn.role !== 'user' && turn.role !== 'assistant')) continue
    chars += turn.content.length
    turns.push({ role: turn.role, content: turn.content })
  }
  return chars > JZEL_MAX_HISTORY_CHARS ? { ok: false, error: 'history_too_large' } : { ok: true, turns, chars }
}
