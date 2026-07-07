import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))

const store = vi.hoisted(() => ({
  // endpoint -> { userId, clinicId, userEmail, p256dh, auth }
  subs: new Map<string, Record<string, unknown>>(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createPushSubscriptionsRepository: () => ({
    upsert: async (input: { endpoint: string; userId: string }) => {
      store.subs.set(input.endpoint, { ...input })
      return { id: 'p-1', ...input }
    },
    deleteByEndpoint: async (userId: string, endpoint: string) => {
      const row = store.subs.get(endpoint)
      if (!row || row['userId'] !== userId) return false
      store.subs.delete(endpoint)
      return true
    },
  }),
  // Touched by other routes registered in buildApp, but never invoked here.
  createUsersRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const token = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const auth = { authorization: `Bearer ${token}` }
const otherToken = signAccessToken({ userId: 'u-2', clinicId: 'c-1', role: 'secretary', email: 'bob@demo.test' })
const otherAuth = { authorization: `Bearer ${otherToken}` }

const ENDPOINT = 'https://push.example.com/sub/abc123'
const subPayload = { endpoint: ENDPOINT, keys: { p256dh: 'BPpublic', auth: 'authsecret' } }

describe('Web Push subscription routes (Req 39)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['VAPID_PUBLIC_KEY'] = 'BTestVapidPublicKey'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    delete process.env['VAPID_PUBLIC_KEY']
  })

  it('GET /user/push/public-key returns the configured VAPID public key', async () => {
    const res = await app.inject({ method: 'GET', url: '/user/push/public-key', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).publicKey).toBe('BTestVapidPublicKey')
  })

  it('GET /user/push/public-key without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/user/push/public-key' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /user/push/subscriptions stores the device for the caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/user/push/subscriptions',
      headers: auth,
      payload: subPayload,
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).ok).toBe(true)
    expect(store.subs.get(ENDPOINT)).toMatchObject({
      userId: 'u-1',
      clinicId: 'c-1',
      userEmail: 'ana@demo.test',
      p256dh: 'BPpublic',
      auth: 'authsecret',
    })
  })

  it('POST without auth → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/user/push/subscriptions', payload: subPayload })
    expect(res.statusCode).toBe(401)
  })

  it('POST with a malformed endpoint → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/user/push/subscriptions',
      headers: auth,
      payload: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE only removes the caller’s own subscription', async () => {
    // A different user cannot delete u-1's subscription.
    const denied = await app.inject({
      method: 'DELETE',
      url: '/user/push/subscriptions',
      headers: otherAuth,
      payload: { endpoint: ENDPOINT },
    })
    expect(denied.statusCode).toBe(200)
    expect(JSON.parse(denied.body).removed).toBe(false)
    expect(store.subs.has(ENDPOINT)).toBe(true)

    // The owner can.
    const ok = await app.inject({
      method: 'DELETE',
      url: '/user/push/subscriptions',
      headers: auth,
      payload: { endpoint: ENDPOINT },
    })
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body).removed).toBe(true)
    expect(store.subs.has(ENDPOINT)).toBe(false)
  })
})
