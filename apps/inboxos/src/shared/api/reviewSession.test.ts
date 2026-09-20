import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../store/auth'
import type { AuthUser } from '../types'
import { captureReviewSession, reviewRequest } from './reviewSession'

const login = (id: string) => useAuthStore.getState().setSession({ user: { id, role: 'clinic_admin', clinicId: 'clinic-a' } as AuthUser, accessToken: `access-${id}`, refreshToken: `refresh-${id}` })
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().logout() })
describe('session-bound KB requests', () => {
  it.each(['edit', 'reject', 'approve', 'rollback', 'settings'])('rejects an old-session %s action before sending any credentials', async action => {
    login('a'); const session = captureReviewSession('clinic-a'); login('b')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(reviewRequest(`/clinics/clinic-a/kb/learning/${action === 'settings' ? 'settings' : 'candidates/c/review'}`, session, { method: action === 'settings' ? 'PUT' : 'POST', body: { action } })).rejects.toThrow('review_session_changed')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('aborts an in-flight approval and never retries under a switched identity on 401', async () => {
    login('a'); const session = captureReviewSession('clinic-a')
    let resolve!: (response: Response) => void
    const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(done => { resolve = done })); vi.stubGlobal('fetch', fetcher)
    const request = reviewRequest('/clinics/clinic-a/kb/learning/candidates/c/review', session, { method: 'POST', body: { action: 'approve' } })
    const check = expect(request).rejects.toThrow('review_session_changed')
    login('b'); resolve(new Response('', { status: 401 })); await check
    expect(fetcher).toHaveBeenCalledTimes(1)
    const options = fetcher.mock.calls[0]![1] as RequestInit
    expect(options.signal?.aborted).toBe(true)
    expect(options.headers).toMatchObject({ authorization: 'Bearer access-a', 'x-clinic-id': 'clinic-a' })
    expect(useAuthStore.getState().user?.id).toBe('b')
  })
  it('does not invoke shared refresh even if the initiating session simply expires', async () => {
    login('a'); const session = captureReviewSession('clinic-a')
    const fetcher = vi.fn(async () => new Response('', { status: 401 })); vi.stubGlobal('fetch', fetcher)
    await expect(reviewRequest('/clinics/clinic-a/kb/learning/settings', session)).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('rejects late response bodies after logout and same-user re-login', async () => {
    login('a'); const session = captureReviewSession('clinic-a')
    let resolve!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: () => new Promise(done => { resolve = done }) })))
    const request = reviewRequest('/clinics/clinic-a/kb/learning/candidates', session)
    const check = expect(request).rejects.toThrow('review_session_changed')
    await Promise.resolve(); useAuthStore.getState().logout(); login('a'); resolve([{ candidateContent: 'old private answer' }]); await check
  })
  it.each(['clinic', 'token'])('aborts successful response delivery on %s change', async change => {
    login('a'); const session = captureReviewSession('clinic-a')
    let resolve!: (response: Response) => void
    const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(done => { resolve = done })); vi.stubGlobal('fetch', fetcher)
    const request = reviewRequest('/clinics/clinic-a/kb/learning/settings', session, { method: 'PUT', body: { autoApprove: false } })
    const check = expect(request).rejects.toThrow('review_session_changed')
    if (change === 'clinic') useAuthStore.getState().setActiveClinicId('clinic-b')
    else useAuthStore.getState().setAccessToken('rotated-access-a')
    resolve(new Response('{}', { status: 200 })); await check
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('allows a same-session response but never dispatches a cancelled query', async () => {
    login('a'); const session = captureReviewSession('clinic-a')
    const fetcher = vi.fn(async () => new Response('{"autoApprove":false}', { status: 200 })); vi.stubGlobal('fetch', fetcher)
    await expect(reviewRequest('/clinics/clinic-a/kb/learning/settings', session)).resolves.toEqual({ autoApprove: false })
    const controller = new AbortController(); controller.abort()
    await expect(reviewRequest('/clinics/clinic-a/kb/learning/events', session, { signal: controller.signal })).rejects.toThrow('review_request_cancelled')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
