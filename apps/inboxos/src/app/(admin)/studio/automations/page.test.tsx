import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { templates: [] } }),
}))

vi.mock('@/shared/hooks/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

describe('CreateAutomationGallery', () => {
  it('starts collapsed behind an accessible show-settings button', async () => {
    vi.stubGlobal('React', React)
    const { CreateAutomationGallery } = await import('./CreateAutomationGallery')

    const markup = renderToStaticMarkup(
      React.createElement(CreateAutomationGallery, { clinicId: 'clinic-1' }),
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Show settings')
    expect(markup).not.toContain('hub.table.use')
  })
})
