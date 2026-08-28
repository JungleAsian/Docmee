import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Clinic } from '../types'

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

describe('InboxDisplaySettingsPanel', () => {
  it('starts collapsed behind an accessible show-settings button', async () => {
    vi.stubGlobal('React', React)
    const { InboxDisplaySettingsPanel } = await import('./InboxDisplaySettingsPanel')
    const clinic = { id: 'clinic-1', settings: {} } as Clinic

    const markup = renderToStaticMarkup(
      React.createElement(InboxDisplaySettingsPanel, { clinic }),
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Show settings')
    expect(markup).not.toContain('Save InboxOS settings')
  })
})
