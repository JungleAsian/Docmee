import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ServerTimeDisplay } from './ServerClock'
vi.stubGlobal('React', React)
vi.mock('../hooks/useI18n', () => ({ useI18n: () => ({ language: 'en', t: (key: string) => key }) }))

describe('server clock display', () => {
  it('labels server time with its timezone and a machine-readable timestamp', () => {
    const html = renderToStaticMarkup(<ServerTimeDisplay timestamp={Date.parse('2026-10-08T12:00:00Z')} timezone="America/Guatemala" />)
    expect(html).toContain('clock.serverTime')
    expect(html).toContain('06:00:00')
    expect(html).toContain('America/Guatemala')
    expect(html).toContain('dateTime="2026-10-08T12:00:00.000Z"')
    expect(html).not.toContain('aria-live')
  })
  it('shows an honest unavailable state when synchronization fails', () => {
    const html = renderToStaticMarkup(<ServerTimeDisplay timestamp={null} unavailable />)
    expect(html).toContain('clock.unavailable')
    expect(html).not.toContain('<time')
  })
  it('shows a loading state before the first server sample', () => {
    expect(renderToStaticMarkup(<ServerTimeDisplay timestamp={null} />)).toContain('clock.syncing')
  })
})
