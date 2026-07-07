// WhatsApp message template routes (P16 — Gap #29). Actual submission to Meta is
// manual; these routes only track the catalog and approval status the panel shows.
//   GET   /clinics/:id/message-templates              (clinic_admin, ia_studio_admin)
//   POST  /clinics/:id/message-templates              (clinic_admin, ia_studio_admin — "submit")
//   PATCH /clinics/:id/message-templates/:templateId  (ia_studio_admin — set approval status)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createChannelAccountsRepository, createMessageTemplatesRepository, type MessageTemplateStatus } from '@docmee/db'
import { decryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const createSchema = z.object({
  name: z.string().min(1),
  category: z.enum([
    'appointment_confirmation',
    'appointment_reminder',
    'human_handoff_notification',
    'review_request',
  ]),
  language: z.string().min(2).optional(),
  body: z.string().min(1),
})

const patchSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']),
})

interface MetaGraphBody {
  id?: string
  status?: string
  data?: Array<{ id?: string; status?: string }>
  error?: { message?: string }
}

function readToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

function mapMetaStatus(status: string | null | undefined): MessageTemplateStatus | undefined {
  const normalized = status?.toUpperCase()
  if (normalized === 'APPROVED') return 'approved'
  if (normalized === 'REJECTED' || normalized === 'PAUSED' || normalized === 'DISABLED') return 'rejected'
  if (normalized === 'PENDING' || normalized === 'IN_APPEAL') return 'pending'
  return undefined
}

async function activeWhatsAppMeta(clinicId: string) {
  return withDb(async (sql) => {
    const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
    return accounts.find((account) => account.channel === 'whatsapp' && account.status === 'active') ?? null
  })
}

async function submitTemplateToMeta(clinicId: string, template: { id: string; name: string; category: string; language: string; body: string }) {
  const account = await activeWhatsAppMeta(clinicId)
  const token = readToken(account?.accessTokenEnc)
  const wabaId = account?.settings && typeof account.settings['wabaId'] === 'string' ? account.settings['wabaId'] : null
  if (!account || !token || !wabaId) {
    return { error: 'Meta WhatsApp account, WABA ID, or access token is missing.' }
  }
  const response = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: template.name,
      language: template.language,
      category: template.category === 'review_request' ? 'MARKETING' : 'UTILITY',
      components: [{ type: 'BODY', text: template.body }],
    }),
  })
  const body = await response.json().catch(() => ({} as MetaGraphBody)) as MetaGraphBody
  if (!response.ok) return { error: body?.error?.message ?? `Meta template submit failed: ${response.status}` }
  return { id: typeof body.id === 'string' ? body.id : null, status: typeof body.status === 'string' ? body.status : 'PENDING' }
}

const templatesRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ── List submitted templates ──
  app.get<{ Params: { id: string } }>(
    '/clinics/:id/message-templates',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const templates = await withDb(async (sql) =>
        createMessageTemplatesRepository(sql).listByClinic(clinicId),
      )
      return { templates }
    },
  )

  // ── Submit a new template (tracked as pending) ──
  app.post<{ Params: { id: string } }>(
    '/clinics/:id/message-templates',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const template = await withDb(async (sql) =>
        createMessageTemplatesRepository(sql).create({
          clinicId,
          name: parsed.data.name,
          category: parsed.data.category,
          language: parsed.data.language,
          body: parsed.data.body,
        }),
      )
      const meta = await submitTemplateToMeta(clinicId, template)
      const synced = await withDb((sql) =>
        createMessageTemplatesRepository(sql).setMetaState(clinicId, template.id, {
          metaTemplateId: 'id' in meta ? meta.id : null,
          metaStatus: 'status' in meta ? meta.status : null,
          metaLastError: 'error' in meta ? meta.error : null,
          status: 'status' in meta ? mapMetaStatus(meta.status) : undefined,
        }),
      )
      return reply.code(201).send({ template: synced ?? template })
    },
  )

  app.post<{ Params: { id: string; templateId: string } }>(
    '/clinics/:id/message-templates/:templateId/sync',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const [template, account] = await withDb(async (sql) => {
        const templates = await createMessageTemplatesRepository(sql).listByClinic(clinicId)
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        return [
          templates.find((t) => t.id === request.params.templateId) ?? null,
          accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active') ?? null,
        ] as const
      })
      if (!template) return reply.code(404).send({ error: 'Template not found' })
      const token = readToken(account?.accessTokenEnc)
      const wabaId = account?.settings && typeof account.settings['wabaId'] === 'string' ? account.settings['wabaId'] : null
      if (!token || !wabaId) return reply.code(409).send({ error: 'Meta WhatsApp account is not ready' })
      const response = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/message_templates?name=${encodeURIComponent(template.name)}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const body = await response.json().catch(() => ({} as MetaGraphBody)) as MetaGraphBody
      const found = Array.isArray(body?.data) ? body.data[0] : null
      const status = typeof found?.status === 'string' ? found.status : null
      const updated = await withDb((sql) =>
        createMessageTemplatesRepository(sql).setMetaState(clinicId, template.id, {
          metaTemplateId: typeof found?.id === 'string' ? found.id : null,
          metaStatus: status,
          metaLastError: response.ok ? null : body?.error?.message ?? `Meta sync failed: ${response.status}`,
          status: mapMetaStatus(status),
        }),
      )
      return { template: updated ?? template }
    },
  )

  // ── Update approval status (admins reconcile Meta's decision) ──
  app.patch<{ Params: { id: string; templateId: string } }>(
    '/clinics/:id/message-templates/:templateId',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const template = await withDb(async (sql) =>
        createMessageTemplatesRepository(sql).setStatus(
          clinicId,
          request.params.templateId,
          parsed.data.status,
        ),
      )
      if (!template) return reply.code(404).send({ error: 'Template not found' })
      return { template }
    },
  )
}

export default templatesRoute
