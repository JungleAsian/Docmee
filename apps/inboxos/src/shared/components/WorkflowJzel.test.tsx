import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowJzel } from './WorkflowJzel'

vi.stubGlobal('React', React)
describe('workflow J.zel launcher', () => {
  const props = { clinicId: 'selected', status: 'draft', graph: { nodes: [], edges: [] }, language: 'en' as const, onApply: vi.fn() }
  it('is unavailable to non-superusers', () => {
    expect(renderToStaticMarkup(<WorkflowJzel {...props} role="clinic_admin" />)).toBe('')
    expect(renderToStaticMarkup(<WorkflowJzel {...props} />)).toBe('')
  })
  it('offers an accessible launcher in the fullscreen editor', () => {
    const html = renderToStaticMarkup(<WorkflowJzel {...props} role="ia_studio_admin" />)
    expect(html).toContain('J.zel')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('type="button"')
  })
})
