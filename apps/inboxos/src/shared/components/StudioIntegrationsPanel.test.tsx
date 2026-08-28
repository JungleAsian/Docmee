import * as React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Clinic } from '@/shared/types'

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useQuery: () => ({ data: { providers: [] }, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

vi.mock('@/shared/api/client', () => ({ api: { del: vi.fn(), get: vi.fn(), patch: vi.fn(), post: vi.fn() } }))
vi.mock('@/shared/store/auth', () => ({ useAuthStore: (selector: (state: { user: { jzelEnabled: boolean } }) => unknown) => selector({ user: { jzelEnabled: true } }) }))
vi.mock('@/shared/components/GoogleOAuthButton', () => ({ GoogleOAuthButton: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button> }))

describe('Studio integration disclosures', () => {
  const clinic = { id: 'clinic-1', settings: {} } as Clinic

  it('starts Google workspace cards collapsed behind an accessible disclosure', async () => {
    vi.stubGlobal('React', React)
    const { StudioIntegrationsPanel } = await import('./StudioIntegrationsPanel')

    const markup = renderToStaticMarkup(<StudioIntegrationsPanel clinic={clinic} />)

    expect(markup).toContain('Google workspace sync')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Show integrations')
    expect(markup).not.toContain('Google Calendar')
    expect(readFileSync(resolve(import.meta.dirname, 'StudioIntegrationsPanel.tsx'), 'utf8')).toContain('id="google-workspace-integrations" className="space-y-4"')
  })

  it('starts Docmee AI provider cards collapsed behind an accessible disclosure', async () => {
    vi.stubGlobal('React', React)
    const { AiProvidersPanel } = await import('./StudioIntegrationsPanel')

    const markup = renderToStaticMarkup(<AiProvidersPanel clinic={clinic} />)

    expect(markup).toContain('Docmee AI providers')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('Show providers')
    expect(markup).not.toContain('Claude (Anthropic)')
    expect(readFileSync(resolve(import.meta.dirname, 'StudioIntegrationsPanel.tsx'), 'utf8')).toContain('id="docmee-ai-provider-integrations" className="space-y-4"')
  })
})
