// P17 — Auth flow integration test (Gap #40).
//
//   POST /auth/login           → access + refresh tokens
//   GET  /conversations (token)        → 200
//   GET  /conversations (expired token) → 401
//   POST /auth/refresh          → a fresh access token
//
// Login + refresh are exercised against the real fast-jwt signer/verifier and a
// real Fastify app. The DB-backed login path is skipped when the test DB is
// unreachable; the token-lifecycle assertions always run.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createSigner } from 'fast-jwt'
import { dbAvailable, redisAvailable, serviceDb } from './_infra.js'

// Auth never enqueues; stub @docmee/queue so importing buildApp doesn't eagerly
// open (and endlessly retry) real Redis queue connections when Redis is absent.
// The refresh-token blacklist uses an in-memory store under NODE_ENV=test, so the
// whole auth flow runs without any live Redis.
vi.mock('@docmee/queue', () => {
  const q = () => ({ add: vi.fn(), getJobs: vi.fn(async () => []), close: vi.fn() })
  return {
    whatsappInboundQueue: q(),
    transcriptionQueue: q(),
    agentQueue: q(),
    schedulingQueue: q(),
    notificationQueue: q(),
    licenseHeartbeatQueue: q(),
    kbEmbedQueue: q(),
    followUpQueue: q(),
    createQueue: () => q(),
    createWorker: () => ({}),
    createQueueEvents: () => ({}),
    createRedisConnection: () => ({}),
  }
})

import { buildApp } from '../../app.js'
import { signRefreshToken } from '../../auth/jwt.js'

// Mirror plugins/env.ts so signAccessToken/verifyAccessToken share this key.
const JWT_KEY = 'integration-access-secret'
const LOGIN_EMAIL = 'int-auth@docmee.test'
const LOGIN_PASSWORD = 'integration-pass-123'

const hasDb = await dbAvailable()
// The refresh-token blacklist is Redis-backed unless token-store loaded under
// NODE_ENV=test (CI does; a dev shell with NODE_ENV=development does not), so gate
// the refresh case on Redis to keep a local headless run green either way.
const hasRedis = await redisAvailable()

describe('auth integration', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let clinicId: string | undefined

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    process.env['JWT_SECRET'] = JWT_KEY
    app = await buildApp()
    await app.ready()

    if (hasDb) {
      // Seed a clinic + active user whose scrypt hash matches LOGIN_PASSWORD.
      const { hashPassword } = await import('@docmee/shared')
      const sql = serviceDb()
      try {
        await sql`DELETE FROM clinic_users WHERE email = ${LOGIN_EMAIL}`
        await sql`DELETE FROM clinics WHERE slug = 'int-auth-clinic'`
        const [clinic] = await sql<{ id: string }[]>`
          INSERT INTO clinics (name, slug, plan, status)
          VALUES ('Auth Integration Clinic', 'int-auth-clinic', 'pro', 'active')
          RETURNING id
        `
        clinicId = clinic?.id
        const hash = hashPassword(LOGIN_PASSWORD)
        await sql`
          INSERT INTO clinic_users (clinic_id, email, full_name, role, status, password_hash)
          VALUES (${clinicId!}, ${LOGIN_EMAIL}, 'Auth Int', 'secretary', 'active', ${hash})
        `
      } finally {
        await sql.end()
      }
    }
  })

  afterAll(async () => {
    if (hasDb && clinicId) {
      const sql = serviceDb()
      try {
        await sql`DELETE FROM clinic_users WHERE email = ${LOGIN_EMAIL}`
        await sql`DELETE FROM clinics WHERE id = ${clinicId}`
      } finally {
        await sql.end()
      }
    }
    await app.close()
  })

  it('rejects a request with no token (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations?clinic_id=any' })
    expect(res.statusCode).toBe(401)
  })

  it('rejects an expired access token (401)', async () => {
    const expired = createSigner({ key: JWT_KEY, expiresIn: -1000 })({
      userId: 'u1',
      clinicId: 'c1',
      role: 'secretary',
      email: LOGIN_EMAIL,
    })
    const res = await app.inject({
      method: 'GET',
      url: '/conversations?clinic_id=c1',
      headers: { authorization: `Bearer ${expired}` },
    })
    expect(res.statusCode).toBe(401)
  })

  it.skipIf(!hasRedis)('refresh returns a usable new access token', async () => {
    const refresh = signRefreshToken({
      userId: 'u1',
      clinicId: 'c1',
      role: 'secretary',
      email: LOGIN_EMAIL,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: refresh },
    })
    expect(res.statusCode).toBe(200)
    const { accessToken } = JSON.parse(res.body)
    expect(typeof accessToken).toBe('string')
  })

  it.skipIf(!hasDb)('login issues tokens and the access token authorizes /conversations', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: LOGIN_EMAIL, password: LOGIN_PASSWORD },
    })
    expect(login.statusCode).toBe(200)
    const body = JSON.parse(login.body)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user.email).toBe(LOGIN_EMAIL)

    const authed = await app.inject({
      method: 'GET',
      url: `/conversations?clinic_id=${clinicId}`,
      headers: { authorization: `Bearer ${body.accessToken}` },
    })
    expect(authed.statusCode).toBe(200)
    expect(Array.isArray(JSON.parse(authed.body).conversations)).toBe(true)
  })

  it.skipIf(!hasDb)('login with a wrong password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: LOGIN_EMAIL, password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
  })
})
