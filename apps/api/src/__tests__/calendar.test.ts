import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// The webhook route (registered by buildApp) imports @docmee/queue; stub it so the
// real queue and its Redis connections never load during these HTTP tests.
vi.mock('@docmee/queue', () => ({ whatsappInboundQueue: { add: vi.fn() } }))

// Shared in-memory clinic/doctor stores the mocked repositories read/write.
const store = vi.hoisted(() => ({
  authUrlOptions: [] as Array<{ scope?: string[]; state?: string }>,
  clinics: new Map<string, { id: string; name: string; settings: Record<string, unknown> }>(),
  doctors: new Map<string, {
    id: string
    clinicId: string
    googleCalendarId: string | null
    googleCalendarAccessTokenEncrypted: string | null
    googleCalendarRefreshTokenEncrypted: string | null
  }>(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    findById: async (id: string) => store.clinics.get(id) ?? null,
    update: async (id: string, data: { settings?: Record<string, unknown> }) => {
      const current = store.clinics.get(id)!
      const next = { ...current, ...(data.settings ? { settings: data.settings } : {}) }
      store.clinics.set(id, next)
      return next
    },
  }),
  createDoctorsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const doc = store.doctors.get(id)
      return doc && doc.clinicId === clinicId ? doc : null
    },
    update: async (clinicId: string, id: string, data: Record<string, unknown>) => {
      const current = store.doctors.get(id)!
      const next = { ...current, ...data }
      store.doctors.set(id, next)
      return next
    },
    disconnectCalendar: async (clinicId: string, id: string) => {
      const current = store.doctors.get(id)!
      const next = {
        ...current,
        googleCalendarId: null,
        googleCalendarAccessTokenEncrypted: null,
        googleCalendarRefreshTokenEncrypted: null,
      }
      store.doctors.set(id, next)
      return next
    },
  }),
}))

vi.mock('@docmee/agents', () => ({
  getOAuth2Client: () => ({
    generateAuthUrl: (options: { scope?: string[]; state?: string }) => {
      store.authUrlOptions.push(options)
      return 'https://accounts.google.com/o/oauth2/v2/auth?mock=1'
    },
    getToken: async (_code: string) => ({
      tokens: {
        access_token: 'at-raw',
        refresh_token: 'rt-raw',
        expiry_date: 1_900_000_000_000,
        scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly',
      },
    }),
  }),
}))

vi.mock('@docmee/shared', () => ({ encryptValue: (value: string) => `enc:${value}` }))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'
import { __resetGoogleOAuthStateStoreForTests } from '../auth/oauth-state-store.js'

describe('calendar routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const clinicAdminAuth = {
    authorization: `Bearer ${signAccessToken({ userId: 'admin-c1', clinicId: 'c1', role: 'clinic_admin', email: 'admin@c1.test' })}`,
  }
  const studioAdminAuth = {
    authorization: `Bearer ${signAccessToken({ userId: 'studio-admin', clinicId: 'studio', role: 'ia_studio_admin', email: 'admin@docmee.test' })}`,
  }

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    store.authUrlOptions.length = 0
    store.clinics.clear()
    store.doctors.clear()
    __resetGoogleOAuthStateStoreForTests()
  })

  async function beginClinicOAuth(clinicId: string, headers = clinicAdminAuth): Promise<string> {
    const response = await app.inject({ method: 'POST', url: `/clinic/${clinicId}/calendar/auth-url`, headers })
    expect(response.statusCode, response.body).toBe(200)
    const state = store.authUrlOptions.at(-1)?.state
    expect(state).toBeTruthy()
    return state!
  }

  async function beginDoctorOAuth(clinicId: string, doctorId: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: `/clinics/${clinicId}/doctors/${doctorId}/calendar/auth-url`,
      headers: clinicAdminAuth,
    })
    expect(response.statusCode, response.body).toBe(200)
    const state = store.authUrlOptions.at(-1)?.state
    expect(state).toBeTruthy()
    return state!
  }

  it('GET /status with no tokens → { connected: false }', async () => {
    store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
    const res = await app.inject({ method: 'GET', url: '/clinic/c1/calendar/status', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ connected: false })
  })

  it('GET /status with stored tokens → { connected: true }', async () => {
    store.clinics.set('c2', {
      id: 'c2',
      name: 'Demo',
      settings: { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', calendarId: 'primary' } },
    })
    const res = await app.inject({ method: 'GET', url: '/clinic/c2/calendar/status', headers: studioAdminAuth })
    expect(JSON.parse(res.body)).toEqual({ connected: true })
  })

  it('GET /status for unknown clinic → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinic/missing/calendar/status', headers: studioAdminAuth })
    expect(res.statusCode).toBe(404)
  })

  it('POST /auth-url requires an authenticated clinic administrator', async () => {
    store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
    const unauthenticated = await app.inject({ method: 'POST', url: '/clinic/c1/calendar/auth-url' })
    expect(unauthenticated.statusCode).toBe(401)
    const crossClinic = await app.inject({ method: 'POST', url: '/clinic/c2/calendar/auth-url', headers: clinicAdminAuth })
    expect(crossClinic.statusCode).toBe(403)
  })

  it('keeps calendar management endpoints behind administrator authentication', async () => {
    const requests = [
      { method: 'GET' as const, url: '/clinic/c1/calendar/status' },
      { method: 'GET' as const, url: '/clinic/c1/calendar/health' },
      { method: 'DELETE' as const, url: '/clinic/c1/calendar/disconnect' },
      { method: 'DELETE' as const, url: '/clinics/c1/doctors/d1/calendar/disconnect' },
    ]
    for (const request of requests) {
      const response = await app.inject(request)
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(401)
    }
  })

  it('POST /auth-url returns Google consent with an opaque one-time state', async () => {
    store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
    const res = await app.inject({ method: 'POST', url: '/clinic/c1/calendar/auth-url', headers: clinicAdminAuth })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toContain('accounts.google.com')
    expect(store.authUrlOptions.at(-1)?.state).not.toBe('c1')
    expect(store.authUrlOptions.at(-1)?.scope).toContain('https://www.googleapis.com/auth/drive.readonly')
  })

  it('GET /callback exchanges the code and stores encrypted tokens', async () => {
    store.clinics.set('c3', { id: 'c3', name: 'Demo', settings: {} })
    const state = await beginClinicOAuth('c3', studioAdminAuth)
    const res = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/studio/channels?calendar=connected&clinic=c3')
    const gc = store.clinics.get('c3')!.settings['googleCalendar'] as Record<string, unknown>
    expect(gc.accessToken).toBe('enc:at-raw')
    expect(gc.refreshToken).toBe('enc:rt-raw')
    // expiry stored unencrypted so the worker can refresh before a 401
    expect(gc.expiryDate).toBe(1_900_000_000_000)
    expect(gc.scopes).toEqual([
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ])
  })

  it('GET /callback without code → 400', async () => {
    store.clinics.set('c3', { id: 'c3', name: 'Demo', settings: {} })
    const state = await beginClinicOAuth('c3', studioAdminAuth)
    const res = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?state=${encodeURIComponent(state)}` })
    expect(res.statusCode).toBe(400)
  })

  it('rejects altered and replayed OAuth state before another tenant can be updated', async () => {
    store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
    const state = await beginClinicOAuth('c1')
    const altered = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(`${state}x`)}` })
    expect(altered.statusCode).toBe(400)
    expect(store.clinics.get('c1')!.settings['googleCalendar']).toBeUndefined()

    const first = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}` })
    expect(first.statusCode).toBe(302)
    const replay = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}` })
    expect(replay.statusCode).toBe(400)
  })

  it('DELETE /disconnect clears tokens', async () => {
    store.clinics.set('c4', {
      id: 'c4',
      name: 'Demo',
      settings: { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', calendarId: 'primary' }, other: 1 },
    })
    const res = await app.inject({ method: 'DELETE', url: '/clinic/c4/calendar/disconnect', headers: studioAdminAuth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ disconnected: true })
    const settings = store.clinics.get('c4')!.settings
    expect(settings['googleCalendar']).toBeUndefined()
    expect(settings['other']).toBe(1)
  })

  describe('doctor-level calendar connection', () => {
    beforeEach(() => {
      store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
      store.doctors.set('d1', {
        id: 'd1',
        clinicId: 'c1',
        googleCalendarId: null,
        googleCalendarAccessTokenEncrypted: null,
        googleCalendarRefreshTokenEncrypted: null,
      })
    })

    it('POST /auth-url 404s for an unknown doctor', async () => {
      const res = await app.inject({ method: 'POST', url: '/clinics/c1/doctors/missing/calendar/auth-url', headers: clinicAdminAuth })
      expect(res.statusCode).toBe(404)
    })

    it('POST /auth-url rejects a different clinic before doctor lookup', async () => {
      const res = await app.inject({ method: 'POST', url: '/clinics/other-clinic/doctors/d1/calendar/auth-url', headers: clinicAdminAuth })
      expect(res.statusCode).toBe(403)
    })

    it('POST /auth-url returns Google consent with an opaque doctor state', async () => {
      const res = await app.inject({ method: 'POST', url: '/clinics/c1/doctors/d1/calendar/auth-url', headers: clinicAdminAuth })
      expect(res.statusCode).toBe(200)
      expect(res.json().url).toContain('accounts.google.com')
      expect(store.authUrlOptions.at(-1)?.state).not.toContain('doctor:c1:d1')
      expect(store.authUrlOptions.at(-1)?.scope).toEqual(['https://www.googleapis.com/auth/calendar.events'])
    })

    it('GET /callback with a doctor state persists to the doctor row, not the clinic', async () => {
      const state = await beginDoctorOAuth('c1', 'd1')
      const res = await app.inject({
        method: 'GET',
        url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}`,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/studio/doctors?calendar=connected&doctor=d1')

      const doctor = store.doctors.get('d1')!
      expect(doctor.googleCalendarId).toBe('primary')
      expect(doctor.googleCalendarAccessTokenEncrypted).toBe('enc:at-raw')
      expect(doctor.googleCalendarRefreshTokenEncrypted).toBe('enc:rt-raw')
      // The clinic itself must stay untouched — this is the key regression
      // guard, since one callback route now serves both flows.
      expect(store.clinics.get('c1')!.settings['googleCalendar']).toBeUndefined()
    })

    it('GET /callback with a doctor state 404s for an unknown doctor', async () => {
      const state = await beginDoctorOAuth('c1', 'd1')
      store.doctors.delete('d1')
      const res = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}` })
      expect(res.statusCode).toBe(404)
    })

    it('GET /callback with a bare clinic state still persists to clinics.settings unchanged', async () => {
      const state = await beginClinicOAuth('c1')
      const res = await app.inject({ method: 'GET', url: `/clinic/calendar/callback?code=abc&state=${encodeURIComponent(state)}` })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/studio/channels?calendar=connected&clinic=c1')
      const gc = store.clinics.get('c1')!.settings['googleCalendar'] as Record<string, unknown>
      expect(gc.accessToken).toBe('enc:at-raw')
      // Doctor row from the same tick's other tests must never be touched.
      expect(store.doctors.get('d1')!.googleCalendarAccessTokenEncrypted).toBeNull()
    })

    it('GET /callback with a doctor error state redirects to the doctors page', async () => {
      const state = await beginDoctorOAuth('c1', 'd1')
      const res = await app.inject({
        method: 'GET',
        url: `/clinic/calendar/callback?state=${encodeURIComponent(state)}&error=access_denied`,
      })
      expect(res.statusCode).toBe(302)
      expect(res.headers.location).toBe('/studio/doctors?calendar=error&reason=access_denied')
    })

    it('DELETE /disconnect clears exactly the three doctor calendar columns', async () => {
      store.doctors.set('d1', {
        id: 'd1',
        clinicId: 'c1',
        googleCalendarId: 'primary',
        googleCalendarAccessTokenEncrypted: 'enc:at',
        googleCalendarRefreshTokenEncrypted: 'enc:rt',
      })
      const res = await app.inject({ method: 'DELETE', url: '/clinics/c1/doctors/d1/calendar/disconnect', headers: clinicAdminAuth })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ disconnected: true })
      const doctor = store.doctors.get('d1')!
      expect(doctor.googleCalendarId).toBeNull()
      expect(doctor.googleCalendarAccessTokenEncrypted).toBeNull()
      expect(doctor.googleCalendarRefreshTokenEncrypted).toBeNull()
    })

    it('DELETE /disconnect 404s for an unknown doctor', async () => {
      const res = await app.inject({ method: 'DELETE', url: '/clinics/c1/doctors/missing/calendar/disconnect', headers: clinicAdminAuth })
      expect(res.statusCode).toBe(404)
    })
  })
})
