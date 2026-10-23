import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayaDiagnosticStatus, LayaDiagnosticTest } from '@docmee/shared'

const state = vi.hoisted(() => ({
  role: 'ia_studio_admin', language: 'en',
  status: undefined as LayaDiagnosticStatus | undefined,
  result: undefined as LayaDiagnosticTest | undefined,
  loading: false, failed: false, pending: false, testFailed: false,
  query: vi.fn(), post: vi.fn(), refetch: vi.fn(), mutate: vi.fn(),
}))
vi.mock('@/shared/store/auth', () => ({
  useAuthStore: (select: (value: unknown) => unknown) => select({
    user: state.role ? { id: 'operator', role: state.role } : null,
    language: state.language,
  }),
}))
vi.mock('@/shared/api/client', () => ({
  api: { get: vi.fn(), post: state.post },
  ApiError: class extends Error { status = 429 },
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => {
    state.query(options)
    return { data: state.status, isPending: state.loading, isError: state.failed, isFetching: state.loading, refetch: state.refetch }
  },
  useMutation: () => ({ data: state.result, isPending: state.pending, isError: state.testFailed, error: null, mutate: state.mutate }),
}))
import { LayaStatusPanel } from './LayaStatusPanel'

const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
const render = () => renderToStaticMarkup(<LayaStatusPanel clinicId={clinicId} />)
describe('LAYA diagnostic panel', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React)
    vi.clearAllMocks()
    Object.assign(state, { role: 'ia_studio_admin', language: 'en', status: undefined, result: undefined,
      loading: false, failed: false, pending: false, testFailed: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it.each(['', 'clinic_admin', 'doctor', 'secretary'])('hides diagnostics and never loads data for role %s', role => {
    state.role = role
    expect(render()).toBe('')
    expect(state.query).not.toHaveBeenCalled()
  })

  it('shows health separately from qualification and never starts a model test on render', () => {
    state.status = { clinicId, checkedAt: '2026-10-22T22:00:00.000Z', service: 'reachable', model: 'ready', clinicOptIn: 'disabled', qualification: 'unqualified', patientDecisions: 'blocked' }
    const html = render()
    for (const text of ['LAYA diagnostics', 'Reachable', 'Ready', 'Disabled', 'Not qualified', 'Blocked', 'Test English', 'Test Spanish', 'Refresh']) expect(html).toContain(text)
    expect(html).toContain('dateTime="2026-10-22T22:00:00.000Z"')
    expect(state.mutate).not.toHaveBeenCalled()
    expect(state.post).not.toHaveBeenCalled()
    expect(state.query.mock.calls[0]?.[0]).toMatchObject({ queryKey: ['laya-status', clinicId, 'operator'], retry: false, refetchOnWindowFocus: false })
    expect(html).not.toContain('<input')
  })

  it('does not show cached success as current when refresh fails', () => {
    state.status = { clinicId, checkedAt: '2026-10-22T22:00:00.000Z', service: 'reachable', model: 'ready', clinicOptIn: 'enabled', qualification: 'unqualified', patientDecisions: 'blocked' }
    state.failed = true
    expect(render()).toContain('Could not refresh diagnostics')
    expect(render()).not.toContain('<dd>Reachable</dd>')
  })

  it('disables manual tests during a pending test and provides an announced result', () => {
    state.pending = true
    const html = render()
    expect(html.match(/disabled=""/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Running synthetic test')
  })

  it.each(['timeout', 'unavailable', 'invalid_response'] as const)('reports %s without claiming success', outcome => {
    state.result = { clinicId, checkedAt: '2026-10-22T22:00:00.000Z', language: 'es', durationMs: 750, qualification: 'unqualified', outcome }
    const html = render()
    expect(html).toContain('750 ms')
    expect(html).not.toContain('Response received; expected choice matched')
    expect(html).toContain('Not qualified')
  })

  it('translates diagnostics and manual controls into Spanish', () => {
    state.language = 'es'
    const html = render()
    for (const text of ['Diagnóstico de LAYA', 'Probar en inglés', 'Probar en español', 'Actualizar', 'No calificado']) expect(html).toContain(text)
    expect(html).not.toContain('Test English')
  })
})
