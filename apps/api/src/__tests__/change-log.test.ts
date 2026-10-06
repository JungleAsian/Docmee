import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  log: vi.fn(),
  recheck: vi.fn(),
  workflows: [] as unknown[],
  clinic: { id: 'c0000000-0000-0000-0000-000000000001', name: 'Derma Paz', settings: { botTone: 'warm' } } as Record<string, unknown>,
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createChangeLogRepository: () => ({ log: h.log, list: vi.fn() }),
  createWorkflowsRepository: () => ({ findById: async () => h.workflows.shift() ?? null }),
  createClinicsRepository: () => ({ findById: async () => h.clinic }),
}))

vi.mock('../lib/setup-check.js', () => ({ scheduleSetupRecheck: h.recheck }))

import {
  deriveAction,
  diffValues,
  diffWorkflow,
  matchChangeRule,
  redact,
  registerChangeLog,
  type WorkflowSnapshot,
} from '../lib/change-log.js'

const CLINIC = 'c0000000-0000-0000-0000-000000000001'
const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

describe('change-log rules', () => {
  it('captures workflow, settings and configuration changes', () => {
    expect(matchChangeRule('PATCH', '/clinics/:id/workflows/:workflowId')?.area).toBe('workflow')
    expect(matchChangeRule('POST', '/clinics/:id/workflows')?.area).toBe('workflow')
    expect(matchChangeRule('PATCH', '/clinics/:id')?.area).toBe('clinic_settings')
    expect(matchChangeRule('PUT', '/clinics/:id/channels/:channel')?.area).toBe('channels')
    expect(matchChangeRule('POST', '/clinic/:clinicId/ai/:provider/connect')?.area).toBe('ai')
    expect(matchChangeRule('PATCH', '/clinics/:id/users/:userId')?.area).toBe('users')
    expect(matchChangeRule('PATCH', '/clinics/:id/kb/:entryId/governance')?.area).toBe('governance')
  })

  it('ignores reads, dry runs, tests and day-to-day patient operations', () => {
    expect(matchChangeRule('GET', '/clinics/:id/workflows/:workflowId')).toBeNull()
    expect(matchChangeRule('POST', '/clinics/:id/workflows/:workflowId/simulate')).toBeNull()
    expect(matchChangeRule('POST', '/clinics/:id/workflows/:workflowId/diagnostics')).toBeNull()
    expect(matchChangeRule('POST', '/clinics/:id/channels/whatsapp/validate')).toBeNull()
    expect(matchChangeRule('POST', '/clinics/:id/messenger/test')).toBeNull()
    expect(matchChangeRule('POST', '/conversations/:id/messages')).toBeNull()
    expect(matchChangeRule('POST', '/clinics/:id/appointments')).toBeNull()
  })

  it('names actions from the route when the verb is too generic', () => {
    expect(deriveAction('POST', '/clinics/:id/workflows/:workflowId/lifecycle')).toBe('lifecycle')
    expect(deriveAction('POST', '/clinics/:id/doctors')).toBe('created')
    expect(deriveAction('PATCH', '/clinics/:id')).toBe('updated')
    expect(deriveAction('DELETE', '/clinics/:id/doctors/:doctorId')).toBe('deleted')
  })
})

describe('change-log redaction and diffs', () => {
  it('masks secrets at any depth but keeps ordinary fields', () => {
    const out = redact({ name: 'WA', accessToken: 'EAAG-live', nested: { password: 'p', clientSecret: 's', keywords: 'hola' } })
    expect(out).toEqual({ name: 'WA', accessToken: '[redacted]', nested: { password: '[redacted]', clientSecret: '[redacted]', keywords: 'hola' } })
  })

  it('reports changed settings by path and never the secret value', () => {
    const fields = diffValues(
      { settings: { businessHours: { monday: { open: '09:00' } }, smtpPassword: 'old' } },
      { settings: { businessHours: { monday: { open: '10:00' } }, smtpPassword: 'new' } },
    )
    expect(fields).toEqual([
      { path: 'settings.businessHours.monday.open', before: '09:00', after: '10:00' },
      { path: 'settings.smtpPassword', before: '[redacted]', after: '[redacted]' },
    ])
  })

  it('describes workflow edits step by step', () => {
    const before: WorkflowSnapshot = {
      name: 'Booking',
      status: 'draft',
      nodes: [
        { id: 'a', type: 'trigger.message_keyword', config: { keywords: 'hola' }, x: 0, y: 0 },
        { id: 'b', type: 'action.send_message', config: { message: 'Hi' }, x: 0, y: 100 },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b' }],
    }
    const after: WorkflowSnapshot = {
      name: 'Booking',
      status: 'published',
      nodes: [
        { id: 'a', type: 'trigger.message_keyword', config: { keywords: 'hola, cita' }, x: 0, y: 0 },
        { id: 'c', type: 'action.ask_capture', config: { customLabel: 'Ask name' }, x: 0, y: 100 },
      ],
      edges: [{ id: 'e2', source: 'a', target: 'c' }],
    }
    expect(diffWorkflow(before, after)).toEqual({
      status: { before: 'draft', after: 'published' },
      stepsAdded: [{ id: 'c', type: 'action.ask_capture', label: 'Ask name' }],
      stepsRemoved: [{ id: 'b', type: 'action.send_message', label: 'action.send_message' }],
      stepsChanged: [{ id: 'a', type: 'trigger.message_keyword', label: 'trigger.message_keyword', fields: [{ path: 'keywords', before: 'hola', after: 'hola, cita' }] }],
      connectionsAdded: 1,
      connectionsRemoved: 1,
    })
  })
})

describe('change-log capture hook', () => {
  const app = Fastify()
  const prevDb = process.env['DATABASE_URL']

  beforeAll(async () => {
    process.env['DATABASE_URL'] = 'postgres://test/test'
    registerChangeLog(app)
    const asAdmin = async (request: { user?: unknown }) => {
      request.user = { userId: 'u0000000-0000-0000-0000-000000000009', clinicId: CLINIC, role: 'clinic_admin', email: 'admin@clinic.test' }
    }
    app.patch('/clinics/:id/workflows/:workflowId', { preHandler: asAdmin }, async () => ({ ok: true }))
    app.post('/clinics/:id/doctors', { preHandler: asAdmin }, async () => ({ doctor: { id: 'd-1', name: 'Dra. Paz' } }))
    app.put('/clinics/:id/channels/:channel', { preHandler: asAdmin }, async (_req, reply) => reply.code(422).send({ error: 'bad' }))
    app.post('/conversations/:id/messages', { preHandler: asAdmin }, async () => ({ ok: true }))
    app.patch('/clinics/:id/workflows/:workflowId/anon', async () => ({ ok: true }))
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    if (prevDb === undefined) delete process.env['DATABASE_URL']
    else process.env['DATABASE_URL'] = prevDb
  })

  beforeEach(() => {
    h.log.mockReset().mockResolvedValue(undefined)
    h.recheck.mockReset()
    h.workflows = []
  })

  it('records a workflow edit with who, where and a step-level diff', async () => {
    h.workflows = [
      { name: 'Booking', status: 'draft', nodes: [{ id: 'a', type: 't', config: { keywords: 'hola' } }], edges: [] },
      { name: 'Booking', status: 'draft', nodes: [{ id: 'a', type: 't', config: { keywords: 'cita' } }], edges: [] },
    ]
    const res = await app.inject({ method: 'PATCH', url: `/clinics/${CLINIC}/workflows/w-1`, payload: { nodes: [] } })
    expect(res.statusCode).toBe(200)
    await flush()
    expect(h.log).toHaveBeenCalledTimes(1)
    const entry = h.log.mock.calls[0]![0]
    expect(entry).toMatchObject({
      clinicId: CLINIC,
      clinicName: 'Derma Paz',
      actorEmail: 'admin@clinic.test',
      actorRole: 'clinic_admin',
      area: 'workflow',
      action: 'updated',
      resourceId: 'w-1',
      resourceName: 'Booking',
      outcome: 'succeeded',
    })
    expect(entry.summary).toBe('Workflow updated “Booking” — 1 step(s) edited')
    expect(entry.changes.stepsChanged[0].fields).toEqual([{ path: 'keywords', before: 'hola', after: 'cita' }])
  })

  it('records a created record with its id and name from the response', async () => {
    await app.inject({ method: 'POST', url: `/clinics/${CLINIC}/doctors`, payload: { name: 'Dra. Paz', apiKey: 'x' } })
    await flush()
    const entry = h.log.mock.calls[0]![0]
    expect(entry).toMatchObject({ area: 'doctors_services', action: 'created', resourceId: 'd-1', resourceName: 'Dra. Paz' })
    expect(entry.changes).toEqual({ submitted: { name: 'Dra. Paz', apiKey: '[redacted]' } })
  })

  it('records failed attempts as failed', async () => {
    await app.inject({ method: 'PUT', url: `/clinics/${CLINIC}/channels/whatsapp`, payload: { token: 't' } })
    await flush()
    expect(h.log.mock.calls[0]![0]).toMatchObject({ outcome: 'failed', statusCode: 422 })
    expect(h.recheck).not.toHaveBeenCalled()
  })

  it('re-checks the clinic setup after a successful change', async () => {
    await app.inject({ method: 'POST', url: `/clinics/${CLINIC}/doctors`, payload: { name: 'Dra. Paz' } })
    await flush()
    expect(h.recheck).toHaveBeenCalledWith(CLINIC, 'admin@clinic.test', expect.any(Function))
  })

  it('skips operational routes and unauthenticated requests', async () => {
    await app.inject({ method: 'POST', url: '/conversations/x/messages', payload: { text: 'hola' } })
    await app.inject({ method: 'PATCH', url: `/clinics/${CLINIC}/workflows/w-1/anon` })
    await flush()
    expect(h.log).not.toHaveBeenCalled()
  })

  it('never fails the request when logging fails', async () => {
    h.log.mockRejectedValueOnce(new Error('db down'))
    const res = await app.inject({ method: 'POST', url: `/clinics/${CLINIC}/doctors`, payload: { name: 'X' } })
    expect(res.statusCode).toBe(200)
    await flush()
  })
})
