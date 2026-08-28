import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Clinic } from '../types'

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

describe('CustomTagManager', () => {
  it('renders the persisted tag manager in the Inbox context rail surface', async () => {
    vi.stubGlobal('React', React)
    const { CustomTagManager } = await import('./CustomTagManager')
    const clinic = {
      id: 'clinic-1',
      settings: { inboxTagDefinitions: [{ name: 'Insurance', color: '#64748b', archived: false }] },
    } as unknown as Clinic

    const markup = renderToStaticMarkup(React.createElement(CustomTagManager, { clinic }))

    expect(markup).toContain('Custom conversation tags')
    expect(markup).toContain('Insurance')
    expect(markup).toContain('Add tag')
  })
})
