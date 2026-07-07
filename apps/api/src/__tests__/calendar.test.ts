import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// The webhook route (registered by buildApp) imports @docmee/queue; stub it so the
// real queue and its Redis connections never load during these HTTP tests.
vi.mock('@docmee/queue', () => ({ whatsappInboundQueue: { add: vi.fn() } }))

// Shared in-memory clinic store the mocked repository reads/writes.
const store = vi.hoisted(() => ({ clinics: new Map<string, { id: string; name: string; settings: Record<string, unknown> }>() }))

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
}))

vi.mock('@docmee/agents', () => ({
  getOAuth2Client: () => ({
    generateAuthUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth?mock=1',
    getToken: async (_code: string) => ({
      tokens: { access_token: 'at-raw', refresh_token: 'rt-raw', expiry_date: 1_900_000_000_000 },
    }),
  }),
}))

vi.mock('@docmee/shared', () => ({ encryptValue: (value: string) => `enc:${value}` }))

import { buildApp } from '../app.js'

describe('calendar routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    store.clinics.clear()
  })

  it('GET /status with no tokens → { connected: false }', async () => {
    store.clinics.set('c1', { id: 'c1', name: 'Demo', settings: {} })
    const res = await app.inject({ method: 'GET', url: '/clinic/c1/calendar/status' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ connected: false })
  })

  it('GET /status with stored tokens → { connected: true }', async () => {
    store.clinics.set('c2', {
      id: 'c2',
      name: 'Demo',
      settings: { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', calendarId: 'primary' } },
    })
    const res = await app.inject({ method: 'GET', url: '/clinic/c2/calendar/status' })
    expect(JSON.parse(res.body)).toEqual({ connected: true })
  })

  it('GET /status for unknown clinic → 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinic/missing/calendar/status' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /auth redirects to Google consent', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinic/c1/calendar/auth' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('accounts.google.com')
  })

  it('GET /callback exchanges the code and stores encrypted tokens', async () => {
    store.clinics.set('c3', { id: 'c3', name: 'Demo', settings: {} })
    const res = await app.inject({ method: 'GET', url: '/clinic/calendar/callback?code=abc&state=c3' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/admin/clinics/c3?calendar=connected')
    const gc = store.clinics.get('c3')!.settings['googleCalendar'] as Record<string, unknown>
    expect(gc.accessToken).toBe('enc:at-raw')
    expect(gc.refreshToken).toBe('enc:rt-raw')
    // expiry stored unencrypted so the worker can refresh before a 401
    expect(gc.expiryDate).toBe(1_900_000_000_000)
  })

  it('GET /callback without code → 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinic/calendar/callback?state=c3' })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /disconnect clears tokens', async () => {
    store.clinics.set('c4', {
      id: 'c4',
      name: 'Demo',
      settings: { googleCalendar: { accessToken: 'enc:at', refreshToken: 'enc:rt', calendarId: 'primary' }, other: 1 },
    })
    const res = await app.inject({ method: 'DELETE', url: '/clinic/c4/calendar/disconnect' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ disconnected: true })
    const settings = store.clinics.get('c4')!.settings
    expect(settings['googleCalendar']).toBeUndefined()
    expect(settings['other']).toBe(1)
  })
})
