import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductUpdatesPageContent } from './ProductUpdatesPageContent'
import type { ProductFeature, ProductUpdate } from '../productUpdates'

const releases: ProductUpdate[] = [{
  id: 'release-1',
  publishedAt: '2026-09-24T12:00:00.000Z',
  version: '1.2.3',
  audience: 'all',
  title: { en: 'Release title', es: 'Titulo de version' },
  summary: { en: 'Release summary', es: 'Resumen de version' },
  highlights: [{ en: 'Release highlight', es: 'Detalle de version' }],
}]

const features: ProductFeature[] = [{
  id: 'feature-1',
  audience: 'all',
  href: '/inbox',
  category: { en: 'Messaging', es: 'Mensajeria' },
  title: { en: 'Unified inbox', es: 'Bandeja unificada' },
  description: { en: 'Manage conversations.', es: 'Gestiona conversaciones.' },
}]

describe('product updates page content', () => {
  beforeEach(() => vi.stubGlobal('React', React))

  it('renders the release history in the What’s New tab', () => {
    const markup = renderToStaticMarkup(
      <ProductUpdatesPageContent
        language="en"
        activeTab="updates"
        releases={releases}
        features={features}
        onTabChange={vi.fn()}
      />,
    )

    expect(markup).toContain('Product updates')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('Release title')
    expect(markup).toContain('Release highlight')
    expect(markup).not.toContain('Manage conversations.')
  })

  it('renders the role-filtered feature catalog in the All Features tab', () => {
    const markup = renderToStaticMarkup(
      <ProductUpdatesPageContent
        language="en"
        activeTab="features"
        releases={releases}
        features={features}
        onTabChange={vi.fn()}
      />,
    )

    expect(markup).toContain('All Features')
    expect(markup).toContain('Unified inbox')
    expect(markup).toContain('Manage conversations.')
    expect(markup).toContain('href="/inbox"')
    expect(markup).not.toContain('Release highlight')
  })
})
