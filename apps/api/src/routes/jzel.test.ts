import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  embedded: [] as unknown[],
  active: [] as unknown[],
  kbClinics: [] as string[],
  clinicReads: [] as string[],
  systems: [] as string[],
  hasKey: false,
  user: {
    userId: 'u-1',
    clinicId: 'c-1',
    clinicIds: [] as string[],
    role: 'secretary',
    email: 'secretary@example.test',
    isGlobalSuperAdmin: false,
  },
}))

vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({
    findById: async (clinicId: string) => {
      state.clinicReads.push(clinicId)
      return { id: clinicId, settings: {} }
    },
  }),
  createKnowledgeRepository: () => ({
    searchChunks: async (_query: string, _embedding: number[], filters: { clinicId: string; doctorId: string | null }, limit: number) => {
      expect(limit).toBeLessThanOrEqual(40)
      state.kbClinics.push(filters.clinicId)
      state.embedded.push(filters.doctorId); state.active.push(filters.doctorId); return []
    },
  }),
}))

vi.mock('@docmee/agents', () => ({
  capPatientInput: (value: string) => value,
  detectPromptInjection: () => ({ detected: false }),
  screenPromptLeak: () => ({ safe: true }),
  searchKb: async () => [],
  expandKbQuery: (query: string) => query,
  detectLanguage: () => 'en',
  rerankHybridChunks: (rows: unknown[]) => rows,
  wrapUntrustedKb: (value: string) => value,
}))

vi.mock('../lib/ai-assistant.js', () => ({
  readAiAssistant: (clinic: { id: string }) => ({
    enabled: true,
    name: 'Docmee',
    persona: `${clinic.id}-persona`,
    useKb: true,
    useHelp: false,
    chatProvider: clinic.id === 'c-2' ? 'openai' : 'claude',
    embedProvider: 'openai',
    model: `${clinic.id}-model`,
  }),
  resolveChat: (config: { model: string }) => async (system: string) => {
    state.systems.push(system)
    if (system === 'You are a connectivity check.' && config.model === 'c-2-model') {
      throw new Error('c-2 provider unavailable')
    }
    return 'ok'
  },
  resolveEmbed: () => async () => [],
}))

vi.mock('../lib/clinic-ai-key.js', () => ({ resolveClinicAiKey: () => state.hasKey ? 'clinic-key' : undefined }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (request: { user?: Record<string, unknown> }) => {
    request.user = { ...state.user }
  },
}))
vi.mock('../lib/rate-limit.js', () => ({ rateLimitGuard: () => async () => undefined }))

const { default: jzelRoute } = await import('./jzel.js')

describe('Docmee assistant route branding', () => {
  const app = Fastify()

  beforeAll(async () => {
    await app.register(jzelRoute, { prefix: '/assist' })
    await app.ready()
  })

  beforeEach(() => {
    state.embedded.length = 0
    state.active.length = 0
    state.kbClinics.length = 0
    state.clinicReads.length = 0
    state.systems.length = 0
    state.hasKey = false
    state.user = {
      userId: 'u-1',
      clinicId: 'c-1',
      clinicIds: [],
      role: 'secretary',
      email: 'secretary@example.test',
      isGlobalSuperAdmin: false,
    }
  })

  afterAll(async () => {
    await app.close()
  })

  it('uses Docmee in the user-visible provider setup message', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toContain('Docmee needs this clinic’s own AI provider key')
    expect(response.json().message).not.toMatch(/J\.zel|Jzel/i)
    expect(state.embedded).toEqual([undefined])
    expect(state.active).toEqual([undefined])
  })

  it('scopes both embedded and lexical grounding to a selected doctor', async () => {
    const response = await app.inject({ method: 'POST', url: '/assist/chat', payload: { message: 'Help me', doctorId: 'doctor-1' } })
    expect(response.statusCode).toBe(409)
    expect(state.embedded).toEqual(['doctor-1'])
    expect(state.active).toEqual(['doctor-1'])
  })

  it('uses the selected authorized clinic for AI settings and KB grounding', async () => {
    state.user.clinicIds = ['c-2']

    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      headers: { 'x-clinic-id': 'c-2' },
      payload: { message: 'What are this clinic\'s hours?' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ provider: 'openai', model: 'c-2-model' })
    expect(response.json().message).toContain('clinic’s own AI provider key')
    expect(response.json().message).not.toContain('superuser')
    expect(state.clinicReads).toEqual(['c-2'])
    expect(state.kbClinics).toEqual(['c-2'])
  })

  it('applies the selected clinic persona for a global superuser', async () => {
    state.user.role = 'ia_studio_admin'
    state.user.email = 'docmeedev'
    state.user.isGlobalSuperAdmin = true
    state.hasKey = true

    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      headers: { 'x-clinic-id': 'c-2' },
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(200)
    expect(state.systems.at(-1)).toContain('Clinic-specific persona / rules:\nc-2-persona')
  })

  it('rejects a clinic selection the operator is not authorized to access', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      headers: { 'x-clinic-id': 'c-2' },
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(403)
    expect(state.clinicReads).toEqual([])
    expect(state.kbClinics).toEqual([])
  })

  it('uses a global superuser selected clinic instead of the home clinic', async () => {
    state.user.role = 'ia_studio_admin'
    state.user.email = 'docmeedev'
    state.user.isGlobalSuperAdmin = true

    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      headers: { 'x-clinic-id': 'c-2' },
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ provider: 'openai', model: 'c-2-model' })
    expect(state.clinicReads).toEqual(['c-2'])
    expect(state.kbClinics).toEqual(['c-2'])
  })

  it('keeps provider health cache entries isolated by selected clinic', async () => {
    state.user.role = 'ia_studio_admin'
    state.user.email = 'docmeedev'
    state.user.isGlobalSuperAdmin = true
    state.hasKey = true

    const home = await app.inject({ method: 'GET', url: '/assist/health', headers: { 'x-clinic-id': 'c-1' } })
    const selected = await app.inject({ method: 'GET', url: '/assist/health', headers: { 'x-clinic-id': 'c-2' } })

    expect(home.json()).toMatchObject({ status: 'connected', model: 'c-1-model' })
    expect(selected.json()).toMatchObject({ status: 'error', model: 'c-2-model' })
  })
})
