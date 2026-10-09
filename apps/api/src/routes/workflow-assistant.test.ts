import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ provider: 'openai', enabled: true, reply: 'Structural checks passed; runtime readiness is unknown.', calls: [] as unknown[], missing: false, providerError: false }))
vi.mock('../lib/db.js', () => ({ withDb: async (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({ findById: async (id: string) => ({ id, settings: { aiAssistant: { enabled: state.enabled, chatProvider: state.provider, model: 'clinic-model' } } }) }),
  createWorkflowsRepository: () => ({ findById: async () => state.missing ? null : ({ id: 'workflow' }) }),
  createWorkflowExecutionsRepository: () => ({ listRuns: async () => [{ status: 'failed', context: { phone: 'PRIVATE' }, trace: { message: 'PRIVATE' } }] }),
}))
vi.mock('../lib/ai-assistant.js', async (original) => ({
  ...await original<typeof import('../lib/ai-assistant.js')>(),
  resolveChat: (config: unknown, _settings: unknown, clinicId: string, cli: boolean) => async (...args: unknown[]) => { state.calls.push({ config, clinicId, cli, args }); if (state.providerError) throw new Error('PRIVATE credential and patient content'); return state.reply },
}))
import route from './workflow-assistant.js'
import { signAccessToken } from '../auth/jwt.js'

const graph = { nodes: [
  { id: 'start', kind: 'trigger', type: 'trigger.message_keyword', config: { keywords: 'any words' }, x: 0, y: 0 },
  { id: 'end', kind: 'action', type: 'action.end', config: {}, x: 300, y: 0 },
], edges: [{ id: 'edge', source: 'start', target: 'end' }] }
let sequence = 0
async function request(body = { mode: 'diagnose', instruction: 'Check this workflow', graph }, role: 'clinic_admin' | 'ia_studio_admin' | null = 'ia_studio_admin') {
  const app = Fastify()
  await app.register(route)
  const headers = role ? { authorization: `Bearer ${signAccessToken({ userId: `assistant-${++sequence}`, clinicId: 'other', email: 'test@example.test', role })}`, 'x-clinic-id': 'other' } : {}
  try { return await app.inject({ method: 'POST', url: '/clinics/selected/workflows/assistant', headers, payload: body }) }
  finally { await app.close() }
}
afterEach(() => { state.provider = 'openai'; state.enabled = true; state.missing = false; state.providerError = false; state.calls = []; state.reply = 'Structural checks passed; runtime readiness is unknown.' })
describe('workflow assistant read-only API', () => {
  it('redacts provider failures without exposing private content', async () => {
    state.providerError = true
    const result = await request()
    expect(result.statusCode).toBe(502)
    expect(result.body).not.toContain('PRIVATE')
  })
  it('reports invalid structure without attempting a simulation', async () => {
    const result = await request({ mode: 'diagnose', instruction: 'Check', graph: { ...graph, edges: [{ id: 'bad', source: 'start', target: 'missing' }] } })
    expect(result.statusCode).toBe(200)
    expect(result.json().simulation).toBeNull()
    expect(result.json().checks.some((issue: { severity: string }) => issue.severity === 'error')).toBe(true)
  })
  it('requires authentication and superuser role', async () => {
    expect((await request(undefined, null)).statusCode).toBe(401)
    expect((await request(undefined, 'clinic_admin')).statusCode).toBe(403)
    expect(state.calls).toEqual([])
  })
  it('uses the selected clinic AI settings and mock-only evidence', async () => {
    const result = await request({ mode: 'diagnose', instruction: 'Check', graph, workflowId: 'workflow' } as never)
    expect(result.statusCode).toBe(200)
    expect(result.json().simulation.safety).toMatchObject({ externalCalls: 0, persistentWrites: 0, queuedJobs: 0 })
    expect(state.calls[0]).toMatchObject({ clinicId: 'selected', cli: false, config: { model: 'clinic-model', chatProvider: 'openai' } })
    expect(JSON.stringify(state.calls)).not.toContain('PRIVATE')
  })
  it('fails closed for disabled AI, CLI transport and missing scoped workflow', async () => {
    state.enabled = false
    expect((await request()).statusCode).toBe(503)
    state.enabled = true; state.provider = 'claude_cli'
    expect((await request()).statusCode).toBe(503)
    state.provider = 'openai'; state.missing = true
    expect((await request({ mode: 'diagnose', instruction: 'Check', graph, workflowId: 'foreign' } as never)).statusCode).toBe(404)
    expect(state.calls).toEqual([])
  })
  it('validates generated proposals and returns clarification safely', async () => {
    state.reply = JSON.stringify({ kind: 'proposal', summary: 'Draft', ...graph })
    expect((await request({ mode: 'build', instruction: 'Build', graph })).json().proposal.kind).toBe('proposal')
    state.reply = '{"kind":"clarification","question":"Which doctor?"}'
    expect((await request({ mode: 'build', instruction: 'Book', graph })).json().proposal.kind).toBe('clarification')
    state.reply = '{"kind":"proposal","publish":true}'
    expect((await request({ mode: 'build', instruction: 'Build', graph })).statusCode).toBe(422)
  })
  it('rejects oversized operator instructions', async () => {
    expect((await request({ mode: 'build', instruction: 'x'.repeat(4001), graph })).statusCode).toBe(400)
    expect(state.calls).toEqual([])
  })
})
