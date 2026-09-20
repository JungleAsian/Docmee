// Opt-in, fail-closed transport for sensitive staff review. It deliberately does
// not use the shared API client's credential-refresh/retry behavior.
import { useSyncExternalStore } from 'react'
import { authSnapshot, useAuthStore } from '../store/auth'
import { API_BASE, ApiError } from './client'

let generation = 0
const listeners = new Set<() => void>()
useAuthStore.subscribe((state, previous) => {
  // Token rotation also invalidates an open review: conservative re-review is
  // preferable to adopting credentials issued after an action was initiated.
  if (state.user !== previous.user || state.accessToken !== previous.accessToken
    || state.refreshToken !== previous.refreshToken || state.activeClinicId !== previous.activeClinicId) {
    generation += 1
    for (const notify of listeners) notify()
  }
})
const subscribe = (notify: () => void) => { listeners.add(notify); return () => { listeners.delete(notify) } }
export const useReviewGeneration = () => useSyncExternalStore(subscribe, () => generation, () => generation)
export interface ReviewSession { generation: number; clinicId: string; userId: string | null; accessToken: string | null }
export function captureReviewSession(clinicId: string): ReviewSession {
  const state = authSnapshot()
  return { generation, clinicId, userId: state.user?.id ?? null, accessToken: state.accessToken }
}
function assertSession(session: ReviewSession) {
  const state = authSnapshot()
  if (session.generation !== generation || !session.userId || !session.accessToken
    || state.user?.id !== session.userId || state.accessToken !== session.accessToken
    || (state.activeClinicId ?? state.user?.clinicId) !== session.clinicId) throw new ApiError(409, 'review_session_changed')
}
export async function reviewRequest<T>(path: string, session: ReviewSession, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  assertSession(session)
  if (!path.startsWith(`/clinics/${session.clinicId}/kb/learning/`)) throw new ApiError(409, 'review_scope_changed')
  const controller = new AbortController()
  const unsubscribe = subscribe(() => { if (generation !== session.generation) controller.abort() })
  const cancel = () => controller.abort()
  options.signal?.addEventListener('abort', cancel, { once: true })
  if (options.signal?.aborted) controller.abort()
  try {
    if (controller.signal.aborted) throw new ApiError(409, 'review_request_cancelled')
    const response = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET', signal: controller.signal,
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-clinic-id': session.clinicId, ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
    assertSession(session)
    if (!response.ok) throw new ApiError(response.status, response.status === 401 ? 'review_session_expired' : 'review_request_failed')
    const result = response.status === 204 ? undefined : await response.json()
    assertSession(session)
    if (controller.signal.aborted) throw new ApiError(409, 'review_request_cancelled')
    return result as T
  } catch (error) {
    assertSession(session)
    throw error
  } finally { unsubscribe(); options.signal?.removeEventListener('abort', cancel) }
}
export function reviewApi(session: ReviewSession) {
  return {
    get: <T>(path: string, signal?: AbortSignal) => reviewRequest<T>(path, session, { signal }),
    post: <T>(path: string, body?: unknown) => reviewRequest<T>(path, session, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => reviewRequest<T>(path, session, { method: 'PUT', body }),
  }
}
