import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp registers the webhook route, which imports @docmee/queue. Stub it so the
// real queue (and its Redis connections) never load during these HTTP tests.
vi.mock('@docmee/queue', () => ({ whatsappInboundQueue: { add: vi.fn() } }))

import { buildApp } from '../app.js'

describe('health routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true, service: 'docmee-api' })
  })

  it('GET /heartbeat returns ok with timestamp', async () => {
    const res = await app.inject({ method: 'GET', url: '/heartbeat' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { ok: boolean; ts: string }
    expect(body.ok).toBe(true)
    expect(typeof body.ts).toBe('string')
  })
})
