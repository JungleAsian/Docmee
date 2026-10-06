import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
  createQueue: () => ({ add: vi.fn() }),
}))
vi.mock('@docmee/agents', async () => ({
  ...(await import('../../../../packages/agents/src/workflows/workflow-lint.js')),
  SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS,
  getOAuth2Client: () => ({}),
}))

const facts = vi.hoisted(() => ({
  clinicSettings: {} as Record<string, unknown>,
  doctors: [] as Array<{ id: string; googleCalendarRefreshTokenEncrypted: string | null }>,
  approved: [] as Array<{ category: string }>,
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({ findById: async (id: string) => ({ id, name: 'Derma Paz', settings: facts.clinicSettings }) }),
  createDoctorsRepository: () => ({ listByClinic: async () => facts.doctors }),
  createMessageTemplatesRepository: () => ({ listApproved: async () => facts.approved }),
  normalizeWorkflowStatus: (status: string) => status,
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const bearer = (role: 'secretary' | 'clinic_admin' | 'ia_studio_admin', clinicId = 'c-1') => ({
  authorization: `Bearer ${signAccessToken({ userId: 'u-1', clinicId, role, email: `${role}@demo.test` })}`,
})

const n = (id: string, type: string, config: Record<string, unknown> = {}) => ({ id, type, kind: type.split('.')[0], config, x: 0, y: 0 })
const e = (source: string, target: string, sourceHandle?: string) => ({ id: `${source}-${target}-${sourceHandle ?? ''}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

const graph = {
  nodes: [
    n('start', 'trigger.message_keyword', { keywords: '' }),
    n('ask', 'action.ask_capture', { field: '', question: '¿Nombre?' }),
    n('check', 'action.check_availability'),
    n('book', 'action.create_booking', { resultRouting: 'single' }),
    n('end', 'action.end'),
  ],
  edges: [e('start', 'ask'), e('ask', 'check'), e('check', 'book'), e('book', 'end')],
}

describe('POST /clinics/:id/workflows/check', () => {
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
    facts.clinicSettings = {}
    facts.doctors = []
    facts.approved = []
  })

  it('returns blocking errors and warnings for the unsaved graph without saving anything', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/check', headers: bearer('clinic_admin'), payload: { graph } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { errors: Array<{ code: string; nodeId?: string }>; warnings: Array<{ code: string; nodeId?: string }> }
    expect(body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'incomplete_node', nodeId: 'ask' })]))
    expect(body.warnings.map((w) => `${w.code}@${w.nodeId}`)).toEqual(expect.arrayContaining([
      'trigger_matches_everything@start',
      'booking_failure_unhandled@book',
      'calendar_not_connected@book',
    ]))
  })

  it('knows the calendar is connected when a doctor has it', async () => {
    facts.doctors = [{ id: 'd-1', googleCalendarRefreshTokenEncrypted: 'enc' }]
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/check', headers: bearer('clinic_admin'), payload: { graph } })
    const body = JSON.parse(res.body) as { warnings: Array<{ code: string }> }
    expect(body.warnings.some((w) => w.code === 'calendar_not_connected')).toBe(false)
  })

  it('is limited to clinic admins and superusers', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/check', headers: bearer('secretary'), payload: { graph } })
    expect(res.statusCode).toBe(403)
  })

  it("does not let a clinic admin check against another clinic's data", async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-2/workflows/check', headers: bearer('clinic_admin'), payload: { graph } })
    expect(res.statusCode).toBe(403)
  })

  it('rejects a malformed graph', async () => {
    const res = await app.inject({ method: 'POST', url: '/clinics/c-1/workflows/check', headers: bearer('clinic_admin'), payload: { graph: { nodes: 'nope' } } })
    expect(res.statusCode).toBe(400)
  })
})
