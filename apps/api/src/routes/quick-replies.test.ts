import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB/Google loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

let nextId = 1
const store = vi.hoisted(() => ({
  templates: new Map<string, Record<string, unknown>>([
    ['t-1', { id: 't-1', clinicId: 'c-1', title: 'Saludo', content: 'Hola, ¿en qué puedo ayudar?' }],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createQuickReplyTemplatesRepository: () => ({
    listByClinic: async (clinicId: string) =>
      [...store.templates.values()].filter((t) => t.clinicId === clinicId),
    create: async (data: { clinicId: string; title: string; content: string }) => {
      const id = `t-new-${nextId++}`
      const row = { id, ...data }
      store.templates.set(id, row)
      return row
    },
    update: async (
      clinicId: string,
      id: string,
      data: { title: string; content: string },
    ) => {
      const row = store.templates.get(id)
      if (!row || row.clinicId !== clinicId) return null
      const updated = { ...row, ...data }
      store.templates.set(id, updated)
      return updated
    },
    delete: async (clinicId: string, id: string) => {
      const row = store.templates.get(id)
      if (!row || row.clinicId !== clinicId) return false
      store.templates.delete(id)
      return true
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const secretaryToken = signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'ana@demo.test' })
const secretaryAuth = { authorization: `Bearer ${secretaryToken}` }
const clinicAdminToken = signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@demo.test' })
const clinicAdminAuth = { authorization: `Bearer ${clinicAdminToken}` }

describe('Quick reply template routes (Req 15)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET lists the clinic templates for any clinic user (picker)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/quick-reply-templates',
      headers: secretaryAuth,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).templates.length).toBeGreaterThanOrEqual(1)
  })

  it('GET without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/clinics/c-1/quick-reply-templates' })
    expect(res.statusCode).toBe(401)
  })

  it('POST (clinic_admin) creates a template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/quick-reply-templates',
      headers: clinicAdminAuth,
      payload: { title: 'Horario', content: 'Atendemos de 9 a 18h.' },
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).template.title).toBe('Horario')
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/quick-reply-templates',
      headers: secretaryAuth,
      payload: { title: 'x', content: 'y' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST with empty content → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/quick-reply-templates',
      headers: clinicAdminAuth,
      payload: { title: 'x', content: '' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('PATCH (clinic_admin) updates an existing template', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/quick-reply-templates/t-1',
      headers: clinicAdminAuth,
      payload: { title: 'Saludo editado', content: '¡Hola! ¿Cómo le ayudo?' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.template.title).toBe('Saludo editado')
    expect(body.template.content).toBe('¡Hola! ¿Cómo le ayudo?')
  })

  it('PATCH for unknown template → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/quick-reply-templates/missing',
      headers: clinicAdminAuth,
      payload: { title: 'x', content: 'y' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('PATCH (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/clinics/c-1/quick-reply-templates/t-1',
      headers: secretaryAuth,
      payload: { title: 'x', content: 'y' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('DELETE (clinic_admin) removes a template, unknown → 404', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/quick-reply-templates',
      headers: clinicAdminAuth,
      payload: { title: 'temp', content: 'borrar' },
    })
    const id = JSON.parse(created.body).template.id
    const del = await app.inject({
      method: 'DELETE',
      url: `/clinics/c-1/quick-reply-templates/${id}`,
      headers: clinicAdminAuth,
    })
    expect(del.statusCode).toBe(200)
    expect(JSON.parse(del.body).removed).toBe(true)

    const again = await app.inject({
      method: 'DELETE',
      url: `/clinics/c-1/quick-reply-templates/${id}`,
      headers: clinicAdminAuth,
    })
    expect(again.statusCode).toBe(404)
  })
})
