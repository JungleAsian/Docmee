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
  it('declares collapsed accessible disclosures for requested management sections', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8')
    const customFlowsSource = source.slice(
      source.indexOf('function CustomFlowsSummary'),
      source.indexOf('function WorkflowsSummary'),
    )

    expect(source).toContain('contentId="follow-up-settings"')
    expect(source).toContain('contentId="review-request-settings"')
    expect(source).toContain('contentId="automation-workflow-settings"')
    expect(source).toContain('aria-expanded={revealed}')
    expect(source).toContain("t('automations.disclosure.showDetails')")
    expect(source).toContain("t('automations.disclosure.hideDetails')")
    expect(customFlowsSource).not.toContain('custom-flow-settings')
    expect(customFlowsSource).not.toContain('DisclosureToggle')
    expect(customFlowsSource).not.toContain('useState')
    expect(customFlowsSource).toContain("{t('automations.section.flows.desc')}")
  })
})
