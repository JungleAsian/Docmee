import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'

// buildApp also wires the webhook/calendar/kb routes; stub their workspace deps so
// no real Redis/Google/crypto loads here. P08 added auth, so requests carry a token.
vi.mock('@docmee/queue', () => ({ whatsappInboundQueue: { add: vi.fn() }, kbEmbedQueue: { add: vi.fn() } }))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({ encryptValue: (v: string) => `enc:${v}`, verifyPassword: () => true }))

interface Notif { id: string; clinicId: string; status: string; acknowledgedAt: string | null }

const store = vi.hoisted(() => ({
  notifs: new Map<string, { id: string; clinicId: string; status: string; acknowledgedAt: string | null }>(),
  lastSeen: new Map<string, string>(),
  users: new Set<string>(),
  prefs: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({}),
  createConversationsRepository: () => ({}),
  createPatientsRepository: () => ({}),
  createKnowledgeRepository: () => ({}),
  createNotificationsRepository: () => ({
    listByClinic: async (clinicId: string, limit = 50) =>
      [...store.notifs.values()].filter((n) => n.clinicId === clinicId).slice(0, limit),
    acknowledge: async (id: string) => {
      const n = store.notifs.get(id)
      if (!n) return null
      n.status = 'acknowledged'
      n.acknowledgedAt = 'now'
      return n
    },
  }),
  createUsersRepository: () => ({
    touchLastSeen: async (id: string) => {
      if (!store.users.has(id)) return false
      store.lastSeen.set(id, 'now')
      return true
    },
    setPanelLanguage: async (id: string) => store.users.has(id),
    getNotificationPrefs: async (_clinicId: string, id: string) =>
      store.users.has(id) ? (store.prefs.get(id) ?? {}) : null,
    setNotificationPrefs: async (id: string, prefs: Record<string, unknown>) => {
      if (!store.users.has(id)) return false
      store.prefs.set(id, prefs)
      return true
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

// Secretary in clinic c1; userId is the clinic_users id used by heartbeat.
function authFor(userId: string, clinicId = 'c1') {
  const token = signAccessToken({ userId, clinicId, role: 'secretary', email: `${userId}@demo.test` })
  return { authorization: `Bearer ${token}` }
}

describe('notification + heartbeat routes (P08 auth)', () => {
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
    store.notifs.clear()
    store.lastSeen.clear()
    store.users.clear()
    store.prefs.clear()
  })

  const seed = (n: Notif) => store.notifs.set(n.id, n)

  it('GET /notifications without a token → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications?clinic_id=c1' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /notifications scopes to the caller clinic, newest first', async () => {
    seed({ id: 'a', clinicId: 'c1', status: 'pending', acknowledgedAt: null })
    seed({ id: 'b', clinicId: 'c2', status: 'pending', acknowledgedAt: null })
    const res = await app.inject({ method: 'GET', url: '/notifications?clinic_id=c1', headers: authFor('u1') })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.notifications).toHaveLength(1)
    expect(body.notifications[0].id).toBe('a')
  })

  it('GET /notifications for another clinic → 403', async () => {
    const res = await app.inject({ method: 'GET', url: '/notifications?clinic_id=c2', headers: authFor('u1') })
    expect(res.statusCode).toBe(403)
  })

  it('POST /notifications/:id/acknowledge → marks acknowledged', async () => {
    seed({ id: 'a', clinicId: 'c1', status: 'pending', acknowledgedAt: null })
    const res = await app.inject({ method: 'POST', url: '/notifications/a/acknowledge', headers: authFor('u1') })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).notification.status).toBe('acknowledged')
    expect(store.notifs.get('a')!.status).toBe('acknowledged')
  })

  it('POST /notifications/:id/acknowledge for unknown id → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/notifications/missing/acknowledge', headers: authFor('u1') })
    expect(res.statusCode).toBe(404)
  })

  it('POST /user/heartbeat updates last_seen for the authenticated user', async () => {
    store.users.add('u1')
    const res = await app.inject({ method: 'POST', url: '/user/heartbeat', headers: authFor('u1') })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
    expect(store.lastSeen.get('u1')).toBe('now')
  })

  it('POST /user/heartbeat without a token → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/user/heartbeat' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /user/heartbeat for an unknown user → 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/user/heartbeat', headers: authFor('ghost') })
    expect(res.statusCode).toBe(404)
  })

  it('POST /user/preferences sets the panel language', async () => {
    store.users.add('u1')
    const res = await app.inject({
      method: 'POST',
      url: '/user/preferences',
      headers: authFor('u1'),
      payload: { panel_language: 'en' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, panel_language: 'en' })
  })

  it('GET /user/notification-preferences returns normalized defaults for a new user', async () => {
    store.users.add('u1')
    const res = await app.inject({
      method: 'GET',
      url: '/user/notification-preferences',
      headers: authFor('u1'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ preferences: { emailEnabled: true, mutedTypes: [] } })
  })

  it('GET /user/notification-preferences for an unknown user → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/user/notification-preferences',
      headers: authFor('ghost'),
    })
    expect(res.statusCode).toBe(404)
  })

  it('PUT /user/notification-preferences persists normalized prefs', async () => {
    store.users.add('u1')
    const res = await app.inject({
      method: 'PUT',
      url: '/user/notification-preferences',
      headers: authFor('u1'),
      payload: { emailEnabled: false, mutedTypes: ['new_patient', 'new_patient'] },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      ok: true,
      preferences: { emailEnabled: false, mutedTypes: ['new_patient'] },
    })
    // Re-reading returns the persisted prefs.
    const get = await app.inject({
      method: 'GET',
      url: '/user/notification-preferences',
      headers: authFor('u1'),
    })
    expect(JSON.parse(get.body).preferences).toEqual({ emailEnabled: false, mutedTypes: ['new_patient'] })
  })

  it('PUT /user/notification-preferences rejects an unknown alert type → 400', async () => {
    store.users.add('u1')
    const res = await app.inject({
      method: 'PUT',
      url: '/user/notification-preferences',
      headers: authFor('u1'),
      payload: { emailEnabled: true, mutedTypes: ['not_a_real_type'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PUT /user/notification-preferences without a token → 401', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/user/notification-preferences',
      payload: { emailEnabled: true, mutedTypes: [] },
    })
    expect(res.statusCode).toBe(401)
  })
})
