import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

describe('Automation Center disclosures', () => {
  it('declares collapsed accessible disclosures for each management section', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8')

    expect(source).toContain('contentId="follow-up-settings"')
    expect(source).toContain('contentId="review-request-settings"')
    expect(source).toContain('contentId="custom-flow-settings"')
    expect(source).toContain('contentId="automation-workflow-settings"')
    expect(source).toContain('aria-expanded={revealed}')
    expect(source).toContain("{revealed ? 'Hide details' : 'Show details'}")
  })
})
