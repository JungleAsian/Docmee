import Fastify from 'fastify'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { signAccessToken, type JwtPayload } from '../auth/jwt.js'

const state = vi.hoisted(() => ({ rows: [] as unknown[], fail: false }))
vi.mock('../lib/db.js', () => ({
  withDb: async (fn: (sql: unknown) => Promise<unknown>) => {
    if (state.fail) throw new Error('private database detail')
    return fn({})
  },
}))
vi.mock('@docmee/db', () => ({
  createLayaControlsRepository: () => ({ readForClinic: async () => state.rows }),
}))

import layaDiagnosticsRoute from './laya-diagnostics.js'

const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
const path = `/clinics/${clinicId}/laya`
const headers = (role: JwtPayload['role'] = 'ia_studio_admin') => ({
  authorization: `Bearer ${signAccessToken({ userId: 'operator', clinicId, role, email: 'test@example.test' })}`,
})

describe('superuser LAYA diagnostics', () => {
  let app = Fastify()
  let fetcher = vi.fn<typeof fetch>()
  beforeEach(async () => {
    state.rows = []
    state.fail = false
    fetcher = vi.fn<typeof fetch>().mockImplementation(async url => Response.json({
      status: String(url).endsWith('/health') ? 'alive' : 'ready',
    }))
    vi.stubGlobal('fetch', fetcher)
    app = Fastify()
    await app.register(layaDiagnosticsRoute)
    await app.ready()
  })
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers() })

  it('denies unauthenticated and all non-superuser roles without contacting LAYA', async () => {
    for (const method of ['GET', 'POST'] as const) {
      const url = `${path}/${method === 'GET' ? 'status' : 'test'}`
      expect((await app.inject({ method, url })).statusCode).toBe(401)
      for (const role of ['clinic_admin', 'doctor', 'secretary'] as const) {
        expect((await app.inject({ method, url, headers: headers(role), ...(method === 'POST' ? { payload: { language: 'en' } } : {}) })).statusCode).toBe(403)
      }
    }
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reports readiness separately from qualification and clinic opt-in, with no caching', async () => {
    const response = await app.inject({ url: `${path}/status`, headers: headers() })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({ clinicId, service: 'reachable', model: 'ready', clinicOptIn: 'disabled', qualification: 'unqualified', patientDecisions: 'blocked' })
    expect(Date.parse(response.json().checkedAt)).not.toBeNaN()
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['http://127.0.0.1:8767/health', 'http://127.0.0.1:8767/ready'])
    expect(fetcher.mock.calls.every(call => call[1]?.redirect === 'error')).toBe(true)
  })

  it('does not claim qualification even when global and clinic flags are live', async () => {
    state.rows = [null, clinicId].map(id => ({ name: 'docmee_laya', clinicId: id, enabled: true, rolloutPercentage: 100, metadata: { schemaVersion: 1, mode: 'live', tasks: ['administrative_intent'] } }))
    const response = await app.inject({ url: `${path}/status`, headers: headers() })
    expect(response.json()).toMatchObject({ clinicOptIn: 'enabled', qualification: 'unqualified', patientDecisions: 'blocked' })
  })

  it('reports unknown controls on database failure and redacts upstream failures', async () => {
    state.fail = true
    fetcher.mockRejectedValue(new Error('secret endpoint detail'))
    const response = await app.inject({ url: `${path}/status`, headers: headers() })
    expect(response.json()).toMatchObject({ service: 'unavailable', model: 'unknown', clinicOptIn: 'unknown' })
    expect(response.body).not.toMatch(/private|secret endpoint/)
  })

  it('reports a loaded-service readiness failure without treating it as an outage', async () => {
    fetcher.mockImplementation(async url => String(url).endsWith('/ready') ? Response.json({ error: 'unavailable' }, { status: 503 }) : Response.json({ status: 'alive' }))
    expect((await app.inject({ url: `${path}/status`, headers: headers() })).json()).toMatchObject({ service: 'reachable', model: 'not_ready' })
  })

  it('rejects arbitrary text, endpoints, unsupported languages and invalid clinic IDs', async () => {
    for (const payload of [{ language: 'en', text: 'patient data' }, { language: 'es', endpoint: 'https://example.test' }, { language: 'fr' }, {}]) {
      expect((await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload })).statusCode).toBe(400)
    }
    expect((await app.inject({ url: '/clinics/not-a-uuid/laya/status', headers: headers() })).statusCode).toBe(400)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['en', 'es'])('runs only a fixed %s synthetic request and returns validated results', async language => {
    fetcher.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(Object.keys(request).sort()).toEqual(['schemaVersion', 'requestId', 'task', 'language', 'text', 'candidates'].sort())
      expect(request.language).toBe(language)
      expect(request.text).toBe(language === 'en' ? 'I want to book an appointment.' : 'Quiero reservar una cita.')
      expect(JSON.stringify(request)).not.toContain(clinicId)
      return Response.json({ schemaVersion: 1, requestId: request.requestId, modelVersion: 'test-model', calibrationVersion: 'unqualified', choiceId: 'book', rawScore: 0.8, abstain: false })
    })
    const response = await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language } })
    expect(response.json()).toMatchObject({ clinicId, language, outcome: 'response', choice: 'book', expectedChoice: 'book', matchesExpected: true, qualification: 'unqualified' })
    expect(response.json().durationMs).toBeGreaterThanOrEqual(0)
    expect(response.body).not.toContain('test-model')
    expect(fetcher.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8767/v1/decision')
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')
  })

  it('does not label generic runtime 503 as a proven timeout', async () => {
    fetcher.mockResolvedValue(Response.json({ error: 'unavailable' }, { status: 503 }))
    const response = await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'en' } })
    expect(response.json()).toMatchObject({ outcome: 'unavailable' })
  })

  it('rejects malformed responses without exposing raw content', async () => {
    fetcher.mockResolvedValue(Response.json({ requestId: 'wrong', secret: 'not for browser' }))
    const response = await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'en' } })
    expect(response.json().outcome).toBe('invalid_response')
    expect(response.body).not.toContain('not for browser')
  })

  it.each(['correlation', 'score', 'null_choice', 'oversized', 'content_type', 'invalid_json'])('rejects %s runtime responses', async failure => {
    fetcher.mockImplementation(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      const valid = { schemaVersion: 1, requestId: request.requestId, modelVersion: 'test-model', calibrationVersion: 'unqualified', choiceId: 'book', rawScore: 0.8, abstain: false }
      if (failure === 'oversized') return Response.json({ ...valid, modelVersion: 'x'.repeat(9000) })
      if (failure === 'content_type') return new Response(JSON.stringify(valid), { headers: { 'content-type': 'text/plain' } })
      if (failure === 'invalid_json') return new Response('{private invalid json', { headers: { 'content-type': 'application/json' } })
      return Response.json({ ...valid, ...(failure === 'correlation' ? { requestId: '84a7f77f-2f4f-45aa-b057-124f94ae41c5' } : failure === 'score' ? { rawScore: 2 } : { choiceId: null }) })
    })
    const response = await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'en' } })
    expect(response.json().outcome).toBe('invalid_response')
    expect(response.body).not.toMatch(/test-model|private invalid/)
  })

  it('reports abstention without claiming a matching decision', async () => {
    fetcher.mockImplementation(async (_url, init) => Response.json({
      schemaVersion: 1, requestId: JSON.parse(String(init?.body)).requestId,
      modelVersion: 'test-model', calibrationVersion: 'unqualified', choiceId: 'book', rawScore: 0.8, abstain: true,
    }))
    const response = await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'es' } })
    expect(response.json()).toMatchObject({ outcome: 'response', choice: null, matchesExpected: false, qualification: 'unqualified' })
  })

  it('bounds stalled requests and prevents concurrent or immediate repeated tests across clinics', async () => {
    fetcher.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }))
    const first = app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'en' } })
    // Dispatch the first request before the competing request.
    const pending = first.then(response => response)
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    expect((await app.inject({ method: 'POST', url: '/clinics/84a7f77f-2f4f-45aa-b057-124f94ae41c5/laya/test', headers: headers(), payload: { language: 'es' } })).statusCode).toBe(429)
    expect((await pending).json().outcome).toBe('timeout')
    expect((await app.inject({ method: 'POST', url: `${path}/test`, headers: headers(), payload: { language: 'en' } })).statusCode).toBe(429)
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
