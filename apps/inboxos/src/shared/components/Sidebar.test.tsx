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
  LanguageToggle: ({ compact }: { compact?: boolean }) => (
    React.createElement('span', { 'data-language-compact': compact ? 'true' : 'false' }, 'language')
  ),
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: ({ compact }: { compact?: boolean }) => (
    React.createElement('span', { 'data-theme-compact': compact ? 'true' : 'false' }, 'theme')
  ),
}))

describe('Sidebar', () => {
  it('shows the supplied Robotito avatar when the sidebar is collapsed', async () => {
    vi.stubGlobal('React', React)
    const { Sidebar } = await import('./Sidebar')
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, { title: 'Inbox', links: [], collapsed: true }),
    )

    expect(markup).toContain('src="/pets/docmee-robotito.png?v=20260828"')
    expect(markup).toContain('alt="Docmee"')
    expect(markup).toContain('items-center justify-center px-0 py-3')
    expect(markup).toContain('h-[49.92px] w-[49.92px] shrink-0 object-contain')
  })

  it('keeps compact original rail controls and the leaf toggle available when collapsed', async () => {
    vi.stubGlobal('React', React)
    const { Sidebar } = await import('./Sidebar')
    const markup = renderToStaticMarkup(
      React.createElement(Sidebar, {
        title: 'Inbox',
        links: [{ href: '/inbox', label: 'Inbox', icon: React.createElement('span', null, 'I') }],
        collapsed: true,
        railToggle: { expanded: false, onToggle: vi.fn(), label: 'Show rail' },
      }),
    )

    expect(markup).toContain('crm-sidebar-leaf-toggle')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-language-compact="true"')
    expect(markup).toContain('data-theme-compact="true"')
    expect(markup).toContain('crm-nav-item-icon')
    expect(markup).toContain('Tutorial')
    expect(markup).toContain('nav.logout')
  })
})
