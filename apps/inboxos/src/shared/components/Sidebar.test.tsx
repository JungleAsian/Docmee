import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => '/inbox',
}))

vi.mock('../hooks/useI18n', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string) => (key === 'app.name' ? 'Docmee' : key),
  }),
}))

vi.mock('../hooks/useLogout', () => ({
  useLogout: () => vi.fn(),
}))

vi.mock('./LanguageToggle', () => ({
  LanguageToggle: () => null,
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

describe('Sidebar', () => {
  it('shows the happy Docmee avatar when the sidebar is collapsed', async () => {
    vi.stubGlobal('React', React)
    const { Sidebar } = await import('./Sidebar')
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, { title: 'Inbox', links: [], collapsed: true }),
    )

    expect(markup).toContain('src="/pets/docmee-pet-happy.png"')
    expect(markup).toContain('alt="Docmee"')
  })
})
