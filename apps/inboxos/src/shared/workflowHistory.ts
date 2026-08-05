// Undo/redo history for the workflow canvas. Pure immutable stack so it can be
// unit-tested in isolation; the editor component decides when to push (it
// coalesces keystroke bursts into a single entry).
//
// past [...oldest, newest] / present / future [...oldest, newest]. Pushing a new
// present clears the redo stack, and the past is capped so long sessions do not
// grow memory without bound.

export interface HistoryState<T> {
  past: T[]
  present: T
  future: T[]
}

export const HISTORY_LIMIT = 100

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] }
}

export function pushHistory<T>(h: HistoryState<T>, next: T, limit: number = HISTORY_LIMIT): HistoryState<T> {
  const past = [...h.past, h.present]
  if (past.length > limit) past.splice(0, past.length - limit)
  return { past, present: next, future: [] }
}

/** Replace the present without recording a step (keystroke-burst coalescing). */
export function replacePresent<T>(h: HistoryState<T>, next: T): HistoryState<T> {
  return { ...h, present: next }
}

export function canUndo<T>(h: HistoryState<T>): boolean {
  return h.past.length > 0
}

export function canRedo<T>(h: HistoryState<T>): boolean {
  return h.future.length > 0
}

export function undoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.past.length === 0) return h
  const past = [...h.past]
  const present = past.pop()!
  return { past, present, future: [...h.future, h.present] }
}

export function redoHistory<T>(h: HistoryState<T>): HistoryState<T> {
  if (h.future.length === 0) return h
  const future = [...h.future]
  const present = future.pop()!
  return { past: [...h.past, h.present], present, future }
}
