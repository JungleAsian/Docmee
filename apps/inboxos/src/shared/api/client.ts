// API client — a thin fetch wrapper that injects the bearer token, transparently
// refreshes a single time on 401, and redirects to /login when refresh fails.
import { authSnapshot, useAuthStore } from '../store/auth'

function resolveApiBase() {
  const configured = process.env['NEXT_PUBLIC_API_URL']?.replace(/\/$/, '')
  if (typeof window === 'undefined') return configured ?? 'http://localhost:3001'
  if (configured && !/^http:\/\/(localhost|127\.0\.0\.1):3001$/.test(configured)) return configured
  // No usable build-time URL. On localhost (dev) the API is a sibling port; on any
  // remote host assume a reverse proxy serves it same-origin under /api (matches the
  // Caddy config). This avoids the `<host>:3001` trap, which never works behind a
  // proxy/ngrok and made every API call hang when NEXT_PUBLIC_API_URL wasn't baked.
  const host = window.location.hostname
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${window.location.protocol}//${host}:3001`
  }
  return `${window.location.origin}/api`
}

const API_BASE = resolveApiBase()

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Field/validator-level detail strings, when the server sent them
     *  (e.g. workflow graph validation: one entry per rule violated). */
    public details?: string[],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function redirectToLogin() {
  useAuthStore.getState().logout()
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    // Flag the reason so the login screen can tell the user their session
    // expired, instead of bouncing them there silently (looked like "nothing happened").
    try {
      sessionStorage.setItem('docmee-session-expired', '1')
    } catch {
      /* sessionStorage unavailable (private mode) — non-fatal */
    }
    window.location.href = '/login'
  }
}

// Screen 6 — the active clinic the operator is working in, sent on every
// authenticated request so the server scopes it to that clinic (clinic switching).
// Falls back to the user's own clinic; the server ignores a non-admin trying to
// name a clinic that isn't theirs, so this is only an escalation path for admins.
function activeClinicHeader(): Record<string, string> {
  const { activeClinicId, user } = authSnapshot()
  const clinicId = activeClinicId ?? user?.clinicId
  return clinicId ? { 'x-clinic-id': clinicId } : {}
}

// Single in-flight refresh shared by concurrent 401s, so we never stampede /auth/refresh.
let refreshing: Promise<string | null> | null = null

async function refreshAccessToken(): Promise<string | null> {
  const { refreshToken } = authSnapshot()
  if (!refreshToken) return null
  if (!refreshing) {
    const presented = refreshToken
    refreshing = fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: presented }),
    })
      .then(async (res) => {
        if (!res.ok) {
          // Concurrent-refresh race (e.g. a second tab): our single-use refresh
          // token was already rotated by another flow, so the server rejects this
          // replay. If storage now holds a newer token + access token, adopt it
          // instead of forcing a logout. (Single-use rotation is unchanged.)
          const cur = authSnapshot()
          if (cur.refreshToken && cur.refreshToken !== presented && cur.accessToken) {
            return cur.accessToken
          }
          return null
        }
        const data = (await res.json()) as { accessToken?: string; refreshToken?: string }
        if (!data.accessToken) return null
        useAuthStore.getState().setAccessToken(data.accessToken)
        // The server rotates the refresh token on each use — persist the new one,
        // otherwise the next refresh would replay the now-revoked token and fail.
        if (data.refreshToken) useAuthStore.getState().setRefreshToken(data.refreshToken)
        return data.accessToken
      })
      .catch(() => null)
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

export interface ApiOptions {
  method?: string
  body?: unknown
  /** Additional trusted request headers, such as an idempotency key. */
  headers?: Record<string, string>
  /** Skip the bearer header (used by the login call). */
  anonymous?: boolean
}

async function request<T>(path: string, opts: ApiOptions = {}, isRetry = false): Promise<T> {
  const { accessToken } = authSnapshot()
  const headers: Record<string, string> = {}
  // Only advertise a JSON body when we actually send one. Fastify rejects an empty
  // body sent with content-type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY, 400),
  // which broke every bodyless POST: heartbeat, conversation close/reopen/resume-bot,
  // notification acknowledge, AI assist, error resolve and KB re-embed.
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  Object.assign(headers, opts.headers)
  if (!opts.anonymous && accessToken) {
    headers['authorization'] = `Bearer ${accessToken}`
    Object.assign(headers, activeClinicHeader())
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  })

  if (res.status === 401 && !opts.anonymous && !isRetry) {
    const next = await refreshAccessToken()
    if (next) return request<T>(path, opts, true)
    redirectToLogin()
    throw new ApiError(401, 'Unauthorized')
  }

  if (!res.ok) {
    let message = res.statusText
    let details: string[] | undefined
    try {
      const data = (await res.json()) as { error?: string; details?: unknown }
      if (data?.error) message = data.error
      if (Array.isArray(data?.details) && data.details.every((d) => typeof d === 'string')) details = data.details
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, message, details)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// Authenticated file download (e.g. CSV export — Req 36). Mirrors request()'s bearer
// header + single 401-refresh, but returns the raw body as a Blob and triggers a
// browser download instead of parsing JSON.
async function download(path: string, filename: string, isRetry = false): Promise<void> {
  const { accessToken } = authSnapshot()
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers['authorization'] = `Bearer ${accessToken}`
    Object.assign(headers, activeClinicHeader())
  }

  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers })

  if (res.status === 401 && !isRetry) {
    const next = await refreshAccessToken()
    if (next) return download(path, filename, true)
    redirectToLogin()
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText)

  const blob = await res.blob()
  if (typeof window !== 'undefined') {
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.URL.revokeObjectURL(url)
  }
}

// Authenticated inline media fetch (Req 3 — patient image). Like download(), but
// returns an object URL for rendering in an <img> (the browser can't set the bearer
// header on an <img src>). The caller revokes the URL when the element unmounts.
async function blobUrl(path: string, isRetry = false): Promise<string> {
  const { accessToken } = authSnapshot()
  const headers: Record<string, string> = {}
  if (accessToken) {
    headers['authorization'] = `Bearer ${accessToken}`
    Object.assign(headers, activeClinicHeader())
  }

  const res = await fetch(`${API_BASE}${path}`, { method: 'GET', headers })

  if (res.status === 401 && !isRetry) {
    const next = await refreshAccessToken()
    if (next) return blobUrl(path, true)
    redirectToLogin()
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) throw new ApiError(res.status, res.statusText)

  return URL.createObjectURL(await res.blob())
}

// Authenticated multipart upload (Req 3 — a secretary attaches an image). Mirrors
// request()'s bearer header + single 401-refresh, but sends a FormData body and
// lets the browser set the multipart Content-Type (with its boundary) itself.
async function upload<T>(path: string, form: FormData, extraHeaders: Record<string, string> = {}, isRetry = false): Promise<T> {
  const { accessToken } = authSnapshot()
  const headers: Record<string, string> = { ...extraHeaders }
  if (accessToken) {
    headers['authorization'] = `Bearer ${accessToken}`
    Object.assign(headers, activeClinicHeader())
  }

  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: form })

  if (res.status === 401 && !isRetry) {
    const next = await refreshAccessToken()
    if (next) return upload<T>(path, form, extraHeaders, true)
    redirectToLogin()
    throw new ApiError(401, 'Unauthorized')
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // non-JSON error body — keep the status text
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  blobUrl,
  upload,
  post: <T>(path: string, body?: unknown, opts?: ApiOptions) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string, body?: unknown) => request<T>(path, { method: 'DELETE', body }),
  download,
}

export { API_BASE }
