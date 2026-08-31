import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { notes: [] }, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('../hooks/useI18n', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string) => ({
      'notes.title': 'Internal notes',
      'notes.warning': 'Internal notes are never sent to the patient',
      'notes.empty': 'No notes',
      'notes.placeholder': 'Write an internal note…',
      'notes.add': 'Add note',
    })[key] ?? key,
  }),
}))

vi.mock('../hooks/useTeam', () => ({ useTeam: () => [] }))
vi.mock('../store/auth', () => ({ useAuthStore: () => 'user-1' }))

describe('NotesPanel', () => {
  it('renders internal notes as a revealed native disclosure by default', async () => {
    vi.stubGlobal('React', React)
    const { NotesPanel } = await import('./NotesPanel')
    const markup = renderToStaticMarkup(
      React.createElement(NotesPanel, { conversationId: 'conversation-1' }),
    )

    expect(markup).toContain('<details')
    expect(markup).toContain('<details open=""')
    expect(markup).toContain('<summary')
    expect(markup).toContain('Internal notes')
  })
})
