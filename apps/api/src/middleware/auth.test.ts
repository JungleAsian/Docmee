import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { requireAuth, requireRole } from './auth.js'
import { signAccessToken, type JwtPayload } from '../auth/jwt.js'

const user: JwtPayload = { userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 's@demo.test' }

function buildTestApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  app.get('/protected', { preHandler: requireAuth }, async (request) => ({ user: request.user }))
  app.get(
    '/admin-only',
    { preHandler: [requireAuth, requireRole('clinic_admin', 'ia_studio_admin')] },
    async () => ({ ok: true }),
  )
  return app
}

describe('auth middleware', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'test-access-secret'
    app = buildTestApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('missing bearer → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })
    expect(res.statusCode).toBe(401)
  })

  it('invalid token → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not-a-jwt' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('valid token → request.user populated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${signAccessToken(user)}` },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).user.userId).toBe('u-1')
  })

  it('wrong role → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${signAccessToken(user)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('correct role → 200', async () => {
    const admin = signAccessToken({ ...user, role: 'clinic_admin' })
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${admin}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
