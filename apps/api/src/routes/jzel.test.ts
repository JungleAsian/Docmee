import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const scopes = vi.hoisted(() => ({ embedded: [] as unknown[], active: [] as unknown[] }))

vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({
    findById: async () => ({ id: 'c-1', settings: {} }),
  }),
  createKnowledgeRepository: () => ({
    listEmbeddedChunks: async (_clinicId: string, doctorId?: string | null) => { scopes.embedded.push(doctorId); return [] },
    listActiveChunks: async (_clinicId: string, doctorId?: string | null) => { scopes.active.push(doctorId); return [] },
  }),
}))

vi.mock('@docmee/agents', () => ({
  capPatientInput: (value: string) => value,
  detectPromptInjection: () => ({ detected: false }),
  screenPromptLeak: () => ({ safe: true }),
  searchKb: async () => [],
  wrapUntrustedKb: (value: string) => value,
}))

vi.mock('../lib/ai-assistant.js', () => ({
  readAiAssistant: () => ({
    enabled: true,
    name: 'Docmee',
    persona: '',
    useKb: true,
    useHelp: false,
    chatProvider: 'openai',
    embedProvider: 'openai',
    model: 'test-model',
  }),
  resolveChat: () => async () => 'ok',
  resolveEmbed: () => async () => [],
}))

vi.mock('../lib/clinic-ai-key.js', () => ({ resolveClinicAiKey: () => null }))
vi.mock('../lib/db.js', () => ({ withDb: (fn: (sql: unknown) => unknown) => fn({}) }))
vi.mock('../middleware/auth.js', () => ({
  requireAuth: async (request: { user?: Record<string, unknown> }) => {
    request.user = {
      userId: 'u-1',
      clinicId: 'c-1',
      role: 'secretary',
      email: 'secretary@example.test',
    }
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

  afterAll(async () => {
    await app.close()
  })

  it('uses Docmee in the user-visible provider setup message', async () => {
    scopes.embedded.length = 0
    scopes.active.length = 0
    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toContain('Docmee needs this clinic’s own AI provider key')
    expect(response.json().message).not.toMatch(/J\.zel|Jzel/i)
    expect(scopes.embedded).toEqual([null])
    expect(scopes.active).toEqual([null])
  })

  it('scopes both embedded and lexical grounding to a selected doctor', async () => {
    scopes.embedded.length = 0
    scopes.active.length = 0
    const response = await app.inject({ method: 'POST', url: '/assist/chat', payload: { message: 'Help me', doctorId: 'doctor-1' } })
    expect(response.statusCode).toBe(409)
    expect(scopes.embedded).toEqual(['doctor-1'])
    expect(scopes.active).toEqual(['doctor-1'])
  })
})
