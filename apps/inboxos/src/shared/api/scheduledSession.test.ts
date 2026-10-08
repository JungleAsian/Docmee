import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../store/auth'
import type { AuthUser } from '../types'
import { captureReviewSession } from './reviewSession'
import { scheduledRequest } from './scheduledSession'

const login = (id: string) => useAuthStore.getState().setSession({ user: { id, role: 'clinic_admin', clinicId: 'clinic-a' } as AuthUser, accessToken: `access-${id}`, refreshToken: `refresh-${id}` })
afterEach(() => { vi.unstubAllGlobals(); useAuthStore.getState().logout() })
describe('session-bound scheduling', () => {
  it('rejects stale author actions without dispatch', async () => {
    login('a'); const session = captureReviewSession('clinic-a'); login('b')
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(scheduledRequest('c', session, '', 'POST', {})).rejects.toThrow('scheduled_session_changed')
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('never refreshes or retries writes after 401', async () => {
    login('a'); const fetcher = vi.fn(async () => new Response('', { status: 401 })); vi.stubGlobal('fetch', fetcher)
    await expect(scheduledRequest('c', captureReviewSession('clinic-a'), '', 'POST', {})).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toBeDefined()
  })
  it('discards success after a clinic switch while preserving initiating headers', async () => {
    login('a'); let resolve!: (r: Response) => void
    const fetcher = vi.fn((_url: string, _init: RequestInit) => new Promise<Response>(done => { resolve = done })); vi.stubGlobal('fetch', fetcher)
    const request = scheduledRequest('c', captureReviewSession('clinic-a'), '', 'POST', {})
    const check = expect(request).rejects.toThrow('scheduled_session_changed')
    useAuthStore.getState().setActiveClinicId('clinic-b'); resolve(new Response('{}', { status: 201 })); await check
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]![1].headers).toMatchObject({ authorization: 'Bearer access-a', 'x-clinic-id': 'clinic-a' })
    expect(fetcher.mock.calls[0]![1].signal?.aborted).toBe(true)
  })
})
