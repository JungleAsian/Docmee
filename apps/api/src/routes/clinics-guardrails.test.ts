import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', async () => ({
  SIMULATION_REPLAY_LIMITS: (await import('../../../../packages/agents/src/workflows/workflow-simulator.js')).SIMULATION_REPLAY_LIMITS,
  getOAuth2Client: () => ({}),
}))
vi.mock('@docmee/shared', () => ({ encryptValue: (value: string) => `enc:${value}` }))

const findById = vi.fn()
const update = vi.fn()
const auditLog = vi.fn()

vi.mock('@docmee/db', async () => ({
  normalizeWorkflowStatus: (await import('../../../../packages/db/src/workflows/workflow-lifecycle.js')).normalizeWorkflowStatus,
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({ findById, update, list: async () => [] }),
  createAuditRepository: () => ({ log: auditLog }),
  createUsersRepository: () => ({ getNotificationPrefs: async () => ({}) }),
  createConversationsRepository: () => ({}),
  createPatientsRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const clinicAdminAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'admin-1', clinicId: 'c-1', role: 'clinic_admin', email: 'admin@example.test' })}`,
}
const superuserAuth = {
  authorization: `Bearer ${signAccessToken({ userId: 'super-1', clinicId: 'c-1', role: 'ia_studio_admin', email: 'super@example.test' })}`,
}

const guardrails = (threshold = 0.78) => ({
  version: 1,
  contentBoundaries: { additionalBlockedTopics: [], customDeflectionMessage: { en: 'Our team will help.' } },
  groundingStrictness: { minKbConfidence: threshold, allowGeneralKnowledgeFallback: false },
  escalation: { customTriggerKeywords: ['billing dispute'] },
  toneGuardrails: { disallowEmojis: true },
})

describe('PATCH /clinics/:id guardrails', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => { await app.close() })
  beforeEach(() => {
    vi.clearAllMocks()
    findById.mockResolvedValue({ id: 'c-1', settings: {} })
    update.mockImplementation(async (id: string, data: { settings?: unknown }) => ({ id, settings: data.settings ?? {} }))
    auditLog.mockResolvedValue(undefined)
  })

  it('accepts a clinic-admin preset and records only changed field names in audit metadata', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1',
      headers: clinicAdminAuth,
      payload: { settings: { guardrails: guardrails() } },
    })

    expect(response.statusCode).toBe(200)
    expect(update).toHaveBeenCalledWith('c-1', expect.objectContaining({
      settings: expect.objectContaining({ guardrails: expect.objectContaining({ groundingStrictness: { minKbConfidence: 0.78, allowGeneralKnowledgeFallback: false } }) }),
    }))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ guardrails: { changedFields: expect.arrayContaining(['groundingStrictness.minKbConfidence']) } }),
    }))
    expect(JSON.stringify(auditLog.mock.calls)).not.toContain('Our team will help.')
  })

  it('rejects a raw advanced threshold for a clinic admin but permits it for a superuser', async () => {
    const payload = { settings: { guardrails: guardrails(0.72) } }
    const clinicAdminResponse = await app.inject({ method: 'PATCH', url: '/clinics/c-1', headers: clinicAdminAuth, payload })
    expect(clinicAdminResponse.statusCode).toBe(403)
    expect(JSON.parse(clinicAdminResponse.body)).toMatchObject({ error: 'guardrail_advanced_settings_forbidden' })
    expect(update).not.toHaveBeenCalled()

    const superuserResponse = await app.inject({ method: 'PATCH', url: '/clinics/c-1', headers: superuserAuth, payload })
    expect(superuserResponse.statusCode).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('allows only a superuser to select the managed Claude CLI transport', async () => {
    const payload = { settings: { aiAssistant: { chatProvider: 'claude_cli' } } }
    const clinicAdminResponse = await app.inject({ method: 'PATCH', url: '/clinics/c-1', headers: clinicAdminAuth, payload })
    expect(clinicAdminResponse.statusCode).toBe(403)
    expect(clinicAdminResponse.json()).toMatchObject({ error: 'claude_cli_superuser_required' })
    expect(update).not.toHaveBeenCalled()

    const superuserResponse = await app.inject({ method: 'PATCH', url: '/clinics/c-1', headers: superuserAuth, payload })
    expect(superuserResponse.statusCode).toBe(200)
    expect(update).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed or unsafe guardrail settings before updating the clinic', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1',
      headers: superuserAuth,
      payload: { settings: { guardrails: { ...guardrails(), groundingStrictness: { minKbConfidence: 0.59, allowGeneralKnowledgeFallback: false } } } },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ error: 'invalid_guardrails' })
    expect(update).not.toHaveBeenCalled()
  })
})
