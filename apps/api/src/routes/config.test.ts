import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))
vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
}))

import { buildApp } from '../app.js'

describe('GET /config (Req 40 — public feature-flag discovery)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
    delete process.env['FEATURE_ADVANCED_ANALYTICS']
  })

  it('is reachable without auth and reports advancedAnalytics=false by default', async () => {
    delete process.env['FEATURE_ADVANCED_ANALYTICS']
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).features.advancedAnalytics).toBe(false)
  })

  it('reflects FEATURE_ADVANCED_ANALYTICS=true', async () => {
    process.env['FEATURE_ADVANCED_ANALYTICS'] = 'true'
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).features.advancedAnalytics).toBe(true)
  })

  it('treats the string "false" as disabled', async () => {
    process.env['FEATURE_ADVANCED_ANALYTICS'] = 'false'
    const res = await app.inject({ method: 'GET', url: '/config' })
    expect(JSON.parse(res.body).features.advancedAnalytics).toBe(false)
  })
})
