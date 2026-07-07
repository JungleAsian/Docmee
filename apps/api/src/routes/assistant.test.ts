import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// Req 41 — Internal AI Assistant route tests. buildApp wires every route; stub the
// workspace deps so no real Redis/DB/Google/LLM loads. The real summarize/suggest
// agent logic is covered by packages/agents; here we assert the ROUTE contract:
// auth, role gating, clinic scope, 404, and the response shape.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/llm', () => ({
  claudeComplete: vi.fn(async () => 'unused (agent mocked)'),
  embedText: vi.fn(async () => []),
}))
vi.mock('@docmee/agents', () => ({
  getOAuth2Client: () => ({}),
  detectLanguage: () => 'es',
  searchKb: vi.fn(async () => []),
  summarizeConversation: vi.fn(async (messages: unknown[]) => ({
    summary: `SUMMARY of ${messages.length} messages`,
  })),
  suggestReplies: vi.fn(async () => ({
    suggestions: ['Draft one', 'Draft two'],
    sources: [{ title: 'Pricing FAQ', similarity: 0.92 }],
  })),
  suggestNextStep: vi.fn(async () => ({
    action: 'book_appointment',
    rationale: 'Patient wants a Friday slot.',
  })),
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

const store = vi.hoisted(() => ({
  conversations: new Map<string, Record<string, unknown>>([
    [
      'conv-1',
      {
        id: 'conv-1',
        clinicId: 'c-1',
        patientId: 'p-1',
        channel: 'whatsapp',
        channelContactHandle: '+50212345678',
        status: 'open',
        metadata: {},
      },
    ],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createConversationsRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const c = store.conversations.get(id)
      return c && c.clinicId === clinicId ? c : null
    },
  }),
  createMessagesRepository: () => ({
    listByConversation: async () => [
      { role: 'user', content: '¿Cuánto cuesta una limpieza?' },
      { role: 'assistant', content: 'Con gusto le ayudo.' },
    ],
  }),
  createPatientsRepository: () => ({
    findById: async () => ({ id: 'p-1', metadata: { language: 'es' } }),
  }),
  createKnowledgeRepository: () => ({
    listEmbeddedChunks: async () => [],
  }),
  createClinicsRepository: () => ({
    findById: async (id: string) =>
      id === 'c-1' ? { id: 'c-1', name: 'Clínica Sol', settings: { clinicRules: 'Sé amable' } } : null,
  }),
  createNotificationsRepository: () => ({}),
  createUsersRepository: () => ({}),
  createErrorReviewsRepository: () => ({}),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const tokenFor = (role: 'clinic_admin' | 'secretary' | 'doctor' | 'ia_studio_admin') =>
  signAccessToken({ userId: 'u-1', clinicId: 'c-1', role, email: `${role}@demo.test` })
const authHeader = (role: Parameters<typeof tokenFor>[0]) => ({
  authorization: `Bearer ${tokenFor(role)}`,
})

describe('internal AI assistant routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('POST /assist/summary without auth → 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/conversations/conv-1/assist/summary' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /assist/summary as ia_studio_admin → 403 (not an inbox role)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/conv-1/assist/summary',
      headers: authHeader('ia_studio_admin'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST /assist/summary → 200 returns a summary (secretary)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/conv-1/assist/summary',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).summary).toBe('SUMMARY of 2 messages')
  })

  it('POST /assist/summary on unknown conversation → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/nope/assist/summary',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /assist/suggestions → 200 returns suggestions + sources (doctor)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/conv-1/assist/suggestions',
      headers: authHeader('doctor'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.suggestions).toEqual(['Draft one', 'Draft two'])
    expect(body.sources).toEqual([{ title: 'Pricing FAQ', similarity: 0.92 }])
  })

  it('POST /assist/suggestions on unknown conversation → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/nope/assist/suggestions',
      headers: authHeader('clinic_admin'),
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /assist/next-step as ia_studio_admin → 403 (not an inbox role)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/conv-1/assist/next-step',
      headers: authHeader('ia_studio_admin'),
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST /assist/next-step → 200 returns action + rationale (secretary)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/conv-1/assist/next-step',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.action).toBe('book_appointment')
    expect(body.rationale).toBe('Patient wants a Friday slot.')
  })

  it('POST /assist/next-step on unknown conversation → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/nope/assist/next-step',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(404)
  })
})
