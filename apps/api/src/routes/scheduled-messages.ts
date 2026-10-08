import type { FastifyPluginAsync } from 'fastify'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { createAuditRepository, createClinicsRepository, createConversationsRepository, createScheduledMessagesRepository, type ScheduledMessage } from '@docmee/db'
import { scheduledMessagesQueue } from '@docmee/queue'
import { scheduledMessagesEnabled } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { validate } from '../lib/validate.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { loadScheduledContext } from '../lib/scheduled-message-context.js'

const editable = z.object({ kind: z.enum(['text', 'template']), content: z.string().trim().min(1).max(4096).optional(), templateId: z.string().min(1).optional(), scheduledAt: z.string().datetime({ offset: true }), timezone: z.string().min(1).max(100) })
const validPayload = (v: z.infer<typeof editable>) => v.kind === 'text' ? Boolean(v.content) && !v.templateId : Boolean(v.templateId) && !v.content
const createSchema = editable.extend({ idempotencyKey: z.string().min(1).max(128) }).strict().refine(validPayload, 'Supply text or a template, not both')
const editSchema = editable.extend({ version: z.number().int().positive() }).strict().refine(validPayload, 'Supply text or a template, not both')
const cancelSchema = z.object({ version: z.number().int().positive() }).strict()
type Params = { id: string; messageId: string }
function publicMessage(m: ScheduledMessage) {
  return { id: m.id, kind: m.kind, content: m.content, templateId: m.templateId, scheduledAt: m.scheduledAt, timezone: m.timezone, status: m.status, version: m.version, reasonCode: m.reasonCode, createdAt: m.createdAt }
}
async function wake(message: ScheduledMessage) {
  if (message.status !== 'pending') return
  await scheduledMessagesQueue.add('deliver', { clinicId: message.clinicId, messageId: message.id, version: message.version }, {
    jobId: `scheduled-${message.id}-v${message.version}`, delay: Math.max(0, Date.parse(message.scheduledAt) - Date.now()), attempts: 1, removeOnComplete: true, removeOnFail: true,
  })
}
function validTime(value: { scheduledAt: string; timezone: string }, clinicTimezone: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value.timezone }); return value.timezone === clinicTimezone && Date.parse(value.scheduledAt) > Date.now() } catch { return false }
}
function fingerprint(value: z.infer<typeof editable>): string {
  return createHash('sha256').update(JSON.stringify([value.kind, value.content ?? null, value.templateId ?? null, new Date(value.scheduledAt).toISOString(), value.timezone])).digest('hex')
}
const scheduledMessagesRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)
  app.addHook('preHandler', requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin'))
  const path = '/conversations/:id/scheduled-messages'
  app.get<{ Params: Params }>(path, async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const result = await withDb(async (sql) => {
      if (!await createConversationsRepository(sql).findById(clinicId, request.params.id)) return null
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      return { enabled: scheduledMessagesEnabled(clinic?.settings), timezone: clinic?.timezone ?? 'UTC', messages: (await createScheduledMessagesRepository(sql).list(clinicId, request.params.id)).map(publicMessage) }
    })
    return result ?? reply.code(404).send({ error: 'Conversation not found' })
  })
  for (const method of ['POST', 'PATCH'] as const) {
    app.route<{ Params: Params }>({ method, url: method === 'POST' ? path : `${path}/:messageId`, handler: async (request, reply) => {
      const parsed = validate(method === 'POST' ? createSchema : editSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const result = await withDb(async (sql) => {
        const repo = createScheduledMessagesRepository(sql)
        const requestFingerprint = fingerprint(parsed.data)
        if (method === 'POST') {
          const prior = await repo.findByIdempotencyKey(clinicId, request.params.id, request.user!.userId, (parsed.data as z.infer<typeof createSchema>).idempotencyKey)
          if (prior) return prior.requestFingerprint === requestFingerprint ? { code: 200, message: prior } : { code: 409, reason: 'idempotency_conflict' }
        }
        const existing = method === 'PATCH' ? await repo.find(clinicId, request.params.id, request.params.messageId) : null
        if (method === 'PATCH' && !existing) return { code: 404, reason: 'message_missing' }
        if (existing && existing.authorId !== request.user!.userId && request.user!.role !== 'clinic_admin' && request.user!.role !== 'ia_studio_admin') return { code: 403, reason: 'author_forbidden' }
        const context = await loadScheduledContext(sql, { clinicId, conversationId: request.params.id, authorId: existing?.authorId ?? request.user!.userId, kind: parsed.data.kind, templateId: parsed.data.templateId, ...(existing ? { expected: existing } : {}) })
        if (!scheduledMessagesEnabled(context.clinic?.settings)) return { code: 403, reason: 'clinic_disabled' }
        if (context.reason) return { code: context.reason === 'clinic_disabled' || context.reason === 'author_forbidden' ? 403 : 400, reason: context.reason }
        if (!context.clinic || !context.conversation?.patientId || !context.account) return { code: 400, reason: 'context_missing' }
        if (!validTime(parsed.data, context.clinic.timezone)) return { code: 400, reason: 'invalid_schedule_time' }
        const data = parsed.data.kind === 'template' ? { ...parsed.data, content: undefined } : parsed.data
        const message = method === 'POST'
          ? await repo.create({ ...data, clinicId, conversationId: request.params.id, patientId: context.conversation.patientId, authorId: request.user!.userId, accountId: context.account.id, providerAccountId: context.account.accountId, recipient: context.conversation.channelContactHandle, idempotencyKey: (parsed.data as z.infer<typeof createSchema>).idempotencyKey, requestFingerprint })
          : await repo.edit(clinicId, request.params.id, request.params.messageId, (parsed.data as z.infer<typeof editSchema>).version, data)
        if (!message) return { code: 409, reason: 'version_conflict' }
        if (method === 'POST' && message.requestFingerprint !== requestFingerprint) return { code: 409, reason: 'idempotency_conflict' }
        await createAuditRepository(sql).log({ clinicId, actorId: request.user!.userId, action: method === 'POST' ? 'scheduled_message.created' : 'scheduled_message.edited', resourceType: 'scheduled_message', resourceId: message.id, metadata: { version: message.version } })
        return { code: method === 'POST' ? 201 : 200, message }
      })
      if (!result.message) return reply.code(result.code).send({ error: result.reason, reasonCode: result.reason })
      // DB reconciliation recovers a failed wakeup without losing the durable request.
      await wake(result.message).catch(() => request.log.warn('Scheduled-message queue wakeup unavailable; DB reconciliation will recover'))
      return reply.code(result.code).send({ message: publicMessage(result.message) })
    } })
  }
  app.post<{ Params: Params }>(`${path}/:messageId/cancel`, async (request, reply) => {
    const parsed = validate(cancelSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const result = await withDb(async (sql) => {
      const repo = createScheduledMessagesRepository(sql)
      const existing = await repo.find(clinicId, request.params.id, request.params.messageId)
      if (!existing) return { code: 404, reason: 'message_missing' }
      if (existing.authorId !== request.user!.userId && request.user!.role !== 'clinic_admin' && request.user!.role !== 'ia_studio_admin') return { code: 403, reason: 'author_forbidden' }
      const message = await repo.cancel(clinicId, request.params.id, request.params.messageId, parsed.data.version)
      if (!message) return { code: 409, reason: 'version_conflict' }
      await createAuditRepository(sql).log({ clinicId, actorId: request.user!.userId, action: 'scheduled_message.cancelled', resourceType: 'scheduled_message', resourceId: message.id, metadata: { version: message.version } })
      return { code: 200, message }
    })
    return result.message ? { message: publicMessage(result.message) } : reply.code(result.code).send({ error: result.reason, reasonCode: result.reason })
  })
}
export default scheduledMessagesRoute
