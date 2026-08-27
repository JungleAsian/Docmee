import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({
    findById: async () => ({ id: 'c-1', settings: {} }),
  }),
  createKnowledgeRepository: () => ({
    listEmbeddedChunks: async () => [],
    listActiveChunks: async () => [],
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
    useKb: false,
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
    const response = await app.inject({
      method: 'POST',
      url: '/assist/chat',
      payload: { message: 'Help me' },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().message).toContain('Docmee needs this clinic’s own AI provider key')
    expect(response.json().message).not.toMatch(/J\.zel|Jzel/i)
  })
})
