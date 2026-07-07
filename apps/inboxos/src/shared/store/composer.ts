// Composer bridge store (Screen 5 — Internal AI assistant).
//
// The AssistantPanel (right rail) and the ConversationView composer (center
// column) are sibling components with no shared parent state. To honour the
// assistant's "accept / edit" boundary — the secretary ACCEPTS a draft into the
// reply box, EDITS it, then SENDS manually — the panel needs to push text into the
// composer across that column boundary. This tiny Zustand store carries one pending
// insert request, scoped to a conversation id; the composer consumes it on arrival.
//
// Nothing here sends a message. It only fills the editable draft — the human still
// reviews, edits and presses Send.
import { create } from 'zustand'

export interface ComposerInsert {
  conversationId: string
  text: string
  /** Monotonic id so the composer can tell a fresh request from a re-render. */
  nonce: number
}

interface ComposerState {
  pending: ComposerInsert | null
  /** Request that `text` be inserted into the given conversation's reply box. */
  requestInsert: (conversationId: string, text: string) => void
  /** Clear the pending request once the composer has applied it. */
  clearInsert: () => void
}

let seq = 0

export const useComposerStore = create<ComposerState>((set) => ({
  pending: null,
  requestInsert: (conversationId, text) =>
    set({ pending: { conversationId, text, nonce: ++seq } }),
  clearInsert: () => set({ pending: null }),
}))
