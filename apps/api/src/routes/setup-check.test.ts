import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
  createQueue: () => ({ add: vi.fn() }),
}))
vi.mock('@docmee/agents', async () => ({
  SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS,
  getOAuth2Client: () => ({}),
}))

const h = vi.hoisted(() => ({ runSetupCheck: vi.fn() }))
vi.mock('../lib/setup-check.js', () => ({
  runSetupCheck: h.runSetupCheck,
  scheduleSetupRecheck: vi.fn(),
  workflowLintContext: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  normalizeWorkflowStatus: (status: string) => status,
  createNotificationsRepository: () => ({
    listByClinic: async () => [
      { id: 'n1', alertType: 'setup_error', subject: 'Workflows will never answer patients', status: 'sent' },
      { id: 'n2', alertType: 'new_message', subject: 'New message', status: 'sent' },
    ],
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const CLINIC = 'c0000000-0000-0000-0000-000000000001'
const bearer = (role: 'secretary' | 'clinic_admin' | 'ia_studio_admin') => ({
  authorization: `Bearer ${signAccessToken({ userId: 'u-1', clinicId: CLINIC, role, email: `${role}@demo.test` })}`,
})

describe('setup check routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('returns the current problems to clinic admins', async () => {
    h.runSetupCheck.mockResolvedValue([{ key: 'workflows_never_run', code: 'workflows_never_run', severity: 'error' }])
    const res = await app.inject({ method: 'GET', url: `/clinics/${CLINIC}/setup-check`, headers: bearer('clinic_admin') })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).issues).toHaveLength(1)
    expect(h.runSetupCheck).toHaveBeenCalledWith(CLINIC)
  })

  it('is not available to secretaries', async () => {
    const res = await app.inject({ method: 'GET', url: `/clinics/${CLINIC}/setup-check`, headers: bearer('secretary') })
    expect(res.statusCode).toBe(403)
  })

  it('shows setup alerts in the bell to admins only', async () => {
    const admin = JSON.parse((await app.inject({ method: 'GET', url: '/notifications', headers: bearer('clinic_admin') })).body)
    const secretary = JSON.parse((await app.inject({ method: 'GET', url: '/notifications', headers: bearer('secretary') })).body)
    expect(admin.notifications.map((n: { id: string }) => n.id)).toEqual(['n1', 'n2'])
    expect(secretary.notifications.map((n: { id: string }) => n.id)).toEqual(['n2'])
  })
})
