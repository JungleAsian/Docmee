import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Clinic } from '../types'

const state = vi.hoisted(() => ({ language: 'en' }))
vi.mock('../store/auth', () => ({
  useAuthStore: (select: (value: unknown) => unknown) => select({ language: state.language }),
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false, isSuccess: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}))

describe('InboxDisplaySettingsPanel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each([
    ['en', 'Show settings', 'Save InboxOS settings'],
    ['es', 'Mostrar ajustes', 'Guardar ajustes de InboxOS'],
  ])('starts collapsed behind a localized accessible show-settings button in %s', async (language, show, save) => {
    state.language = language
    vi.stubGlobal('React', React)
    const { InboxDisplaySettingsPanel } = await import('./InboxDisplaySettingsPanel')
    const clinic = { id: 'clinic-1', settings: {} } as Clinic

    const markup = renderToStaticMarkup(
      React.createElement(InboxDisplaySettingsPanel, { clinic }),
    )

    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain(show)
    expect(markup).not.toContain(save)
    expect(markup).not.toContain('type="checkbox"')
  })
})
