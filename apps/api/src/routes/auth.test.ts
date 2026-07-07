import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
// Only the login path is exercised here, so the @docmee/db mock just needs the
// service-client factory (used by withDb) and createUsersRepository.findAuthByEmail.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  // Password is valid only when it matches the seeded credential.
  verifyPassword: (plain: string) => plain === 'correct-password',
}))

const store = vi.hoisted(() => ({
  // An active English-preferring user (panel_language persisted to 'en').
  user: {
    id: 'u-1',
    clinicId: 'c-1',
    email: 'enuser@demo.test',
    fullName: 'EN User',
    status: 'active' as const,
    passwordHash: 'scrypt-hash',
    panelLanguage: 'en' as const,
    role: 'secretary' as const,
  },
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createUsersRepository: () => ({
    findAuthByEmail: async (email: string) =>
      email.toLowerCase() === store.user.email ? store.user : null,
  }),
}))

import { buildApp } from '../app.js'

describe('auth login route', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('login returns the user\'s persisted panel language so the panel restores it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'enuser@demo.test', password: 'correct-password' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.user).toMatchObject({
      id: 'u-1',
      email: 'enuser@demo.test',
      role: 'secretary',
      clinicId: 'c-1',
      panelLanguage: 'en',
    })
  })

  it('login with a wrong password → 401 (no panel language leaked)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'enuser@demo.test', password: 'wrong-password' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('login for an unknown user → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@demo.test', password: 'correct-password' },
    })
    expect(res.statusCode).toBe(401)
  })
})
