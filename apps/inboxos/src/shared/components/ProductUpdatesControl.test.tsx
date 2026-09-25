import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductUpdatePopover, ProductUpdatesButton } from './ProductUpdatesControl'
import type { ProductUpdate } from '../productUpdates'

const update: ProductUpdate = {
  id: 'release-1',
  publishedAt: '2026-09-24T12:00:00.000Z',
  audience: 'all',
  title: { en: 'A useful update', es: 'Una novedad util' },
  summary: { en: 'A short summary.', es: 'Un resumen breve.' },
  highlights: [
    { en: 'First improvement', es: 'Primera mejora' },
    { en: 'Second improvement', es: 'Segunda mejora' },
  ],
}

describe('product updates header control', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
  })

  it('announces the unseen count from a dedicated product-updates button', () => {
    const markup = renderToStaticMarkup(
      <ProductUpdatesButton unseenCount={3} expanded={false} language="en" onToggle={vi.fn()} />,
    )

    expect(markup).toContain('aria-label="What’s new: 3 unseen updates"')
    expect(markup).toContain('>3<')
  })

  it('renders an accessible summary with release highlights and actions', () => {
    const markup = renderToStaticMarkup(
      <ProductUpdatePopover update={update} language="en" onDismiss={vi.fn()} onViewAll={vi.fn()} />,
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('A useful update')
    expect(markup).toContain('A short summary.')
    expect(markup).toContain('First improvement')
    expect(markup).toContain('Second improvement')
    expect(markup).toContain('View all updates')
    expect(markup).toContain('Dismiss')
  })

  it('uses the selected language', () => {
    const markup = renderToStaticMarkup(
      <ProductUpdatePopover update={update} language="es" onDismiss={vi.fn()} onViewAll={vi.fn()} />,
    )

    expect(markup).toContain('Una novedad util')
    expect(markup).toContain('Ver todas las novedades')
  })
})
