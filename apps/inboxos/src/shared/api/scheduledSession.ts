import { authSnapshot, useAuthStore } from '../store/auth'
import { API_BASE, ApiError } from './client'
import { captureReviewSession, type ReviewSession } from './reviewSession'

// Reuse the session-generation guard, without the shared client's implicit credential retry.
export async function scheduledRequest<T>(conversationId: string, session: ReviewSession, suffix = '', method = 'GET', body?: unknown): Promise<T> {
  const assertCurrent = () => {
    const current = captureReviewSession(session.clinicId)
    const auth = authSnapshot()
    if (!session.userId || !session.accessToken || current.generation !== session.generation
      || current.userId !== session.userId || current.accessToken !== session.accessToken
      || (auth.activeClinicId ?? auth.user?.clinicId) !== session.clinicId) throw new ApiError(409, 'scheduled_session_changed')
  }
  assertCurrent()
  if (!/^(?:|\/templates|\/[a-zA-Z0-9-]+(?:\/cancel)?)$/.test(suffix)) throw new ApiError(400, 'scheduled_scope_changed')
  const controller = new AbortController()
  const unsubscribe = useAuthStore.subscribe(() => { try { assertCurrent() } catch { controller.abort() } })
  const path = `/conversations/${encodeURIComponent(conversationId)}${suffix === '/templates' ? suffix : `/scheduled-messages${suffix}`}`
  try {
    const response = await fetch(`${API_BASE}${path}`, { method, signal: controller.signal,
      headers: { authorization: `Bearer ${session.accessToken}`, 'x-clinic-id': session.clinicId, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    assertCurrent()
    if (!response.ok) throw new ApiError(response.status, 'scheduled_request_failed')
    const result = await response.json()
    assertCurrent()
    return result as T
  } finally { unsubscribe() }
}
