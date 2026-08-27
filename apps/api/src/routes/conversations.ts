// Conversation, message, tag and note routes (P08). All require auth; clinic
// access is scoped to the caller's clinic (ia_studio_admin may target any).
//   GET    /conversations                      (filters: clinic_id, status, assigned_to)
//   GET    /conversations/:id
//   POST   /conversations/:id/assign           (secretary, doctor, clinic_admin)
//   POST   /conversations/:id/close
//   POST   /conversations/:id/status           (Req 11 — set any of the 7 statuses)
//   DELETE /conversations/:id                   (hard delete, admin-only, password re-check)
//   POST   /conversations/:id/resume-bot        (secretary, doctor, clinic_admin) — return to bot
//   POST   /conversations/:id/reopen           → CREATES A NEW conversation (Decision 4)
//   GET    /conversations/:id/messages
//   POST   /conversations/:id/messages         (secretary, doctor, clinic_admin)
//   GET/POST/DELETE /conversations/:id/tags…   (Gap #13)
//   GET/POST        /conversations/:id/notes        (Gap #14 — internal, never sent to patient)
//   PATCH/DELETE    /conversations/:id/notes/:noteId (Req 13 — author-only edit/delete)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Clinic } from '@docmee/db'
import {
  createAuditRepository,
  createConversationsRepository,
  createMessagesRepository,
  createChannelAccountsRepository,
  createClinicsRepository,
  createErrorReviewsRepository,
  createMessageTemplatesRepository,
  createPatientsRepository,
  createUsersRepository,
} from '@docmee/db'
import type { ConversationStatus } from '@docmee/db'
import { decryptValue, verifyPassword } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { createVoiceReviewAudioUrl } from '../lib/voice-storage.js'

// Meta Page tokens are now stored encrypted (iv:tag:ciphertext). Decrypt for use,
// but tolerate any legacy plaintext token (no colon-triple) so existing rows still
// send until the clinic re-saves and they get encrypted.
function readMetaToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}
import { fetchWhatsAppMedia } from '../lib/whatsapp-media.js'
import {
  sendWhatsAppText,
  sendWhatsAppTemplate,
  sendWhatsAppInteractive,
  sendWhatsAppList,
  sendMessengerText,
  sendInstagramText,
} from '../lib/channel-send.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

// Req 11: the 7-state conversation lifecycle.
const STATUS_VALUES = [
  'open',
  'pending',
  'assigned',
  'handoff',
  'snoozed',
  'resolved',
  'archived',
] as const
const ASSIGNABLE_ROLES = ['secretary', 'doctor', 'clinic_admin'] as const
type RolePermission = 'inbox' | 'calendar' | 'patients' | 'templates' | 'voice_review' | 'analytics' | 'exports' | 'billing' | 'staff'
const DEFAULT_ROLE_PERMISSIONS = {
  inbox: ['secretary', 'doctor', 'clinic_admin'],
  calendar: ['secretary', 'doctor', 'clinic_admin'],
  patients: ['secretary', 'doctor', 'clinic_admin'],
  templates: ['clinic_admin'],
  voice_review: ['secretary', 'doctor', 'clinic_admin'],
  analytics: ['clinic_admin'],
  exports: ['clinic_admin'],
  billing: ['clinic_admin'],
  staff: ['clinic_admin'],
} satisfies Record<RolePermission, Array<(typeof ASSIGNABLE_ROLES)[number]>>

const listQuerySchema = z.object({
  clinic_id: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  assigned_to: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})
const assignSchema = z.object({ userId: z.string().optional() })
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['assign', 'resolve', 'archive']),
  userId: z.string().uuid().optional(),
})
const NON_ADMIN_ASSIGNABLE_ROLES = new Set(['secretary', 'doctor'])
const statusSchema = z.object({
  status: z.enum(STATUS_VALUES),
  // CRE-60: how long to snooze (minutes); only used when status === 'snoozed'. Default 3h.
  snoozeMinutes: z.number().int().positive().max(43_200).optional(),
})
// Hard delete — genuinely irreversible, so it requires a fresh password check
// (mirrors DELETE /clinics/:id), not just role gating.
const deleteConversationSchema = z.object({ password: z.string().min(1) })
const messageSchema = z.object({
  content: z.string().min(1),
  contentType: z.enum(['text', 'audio', 'image', 'template', 'interactive']).optional(),
})
const sendTemplateSchema = z.object({ templateId: z.string().min(1) })
// Req 3: an interactive reply-button menu — a body plus 1–3 buttons (WhatsApp's
// limit), each title ≤ 20 chars (Meta rejects longer titles).
const sendInteractiveSchema = z.object({
  body: z.string().min(1).max(1024),
  buttons: z.array(z.string().min(1).max(20)).min(1).max(3),
})
// Req 3: an interactive LIST message — a body, the menu button label and 1–10
// sections each holding 1+ selectable rows. WhatsApp's limits: button ≤ 20 chars,
// ≤ 10 sections, section title ≤ 24 chars, row title ≤ 24 chars, row description
// ≤ 72 chars, and at most 10 rows total across all sections (the cross-section
// cap is enforced with a refinement since zod can't express it per-field).
const sendListSchema = z
  .object({
    body: z.string().min(1).max(1024),
    button: z.string().min(1).max(20),
    sections: z
      .array(
        z.object({
          title: z.string().max(24).optional(),
          rows: z
            .array(
              z.object({
                title: z.string().min(1).max(24),
                description: z.string().max(72).optional(),
              }),
            )
            .min(1)
            .max(10),
        }),
      )
      .min(1)
      .max(10),
  })
  .refine((v) => v.sections.reduce((n, s) => n + s.rows.length, 0) <= 10, {
    message: 'A list message may contain at most 10 rows in total',
    path: ['sections'],
  })
const tagSchema = z.object({
  tag: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
})
const noteSchema = z.object({ content: z.string().min(1) })
// Req 29: a secretary flags a bad bot reply from the inbox; it surfaces in the
// Admin Studio Error Review area as a `bad_response` entry.
const flagResponseSchema = z.object({
  messageId: z.string().optional(),
  content: z.string().min(1),
  note: z.string().optional(),
})
const voiceReviewStatusSchema = z.enum(['pending_review', 'approved', 'rejected', 'edited'])
const voiceReviewUpdateSchema = z
  .object({
    status: voiceReviewStatusSchema.optional(),
    notes: z.string().max(4000).nullable().optional(),
    correctedFields: z.record(z.string()).optional(),
  })
  .refine((value) => value.status !== undefined || value.notes !== undefined || value.correctedFields !== undefined, {
    message: 'No review fields to update',
  })

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function roleList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const allowed = new Set<string>(ASSIGNABLE_ROLES)
  const roles = value.filter((role): role is string => typeof role === 'string' && allowed.has(role))
  return roles.length ? roles : fallback
}

function readVoiceReviewRoles(settings: Clinic['settings']): string[] {
  const root = isRecord(settings) ? settings : {}
  const saved = isRecord(root['rolePermissions']) ? root['rolePermissions'] : {}
  return roleList(saved['voice_review'], DEFAULT_ROLE_PERMISSIONS.voice_review)
}

function canReviewVoice(role: string | undefined, settings: Clinic['settings']): boolean {
  return role === 'ia_studio_admin' || (typeof role === 'string' && readVoiceReviewRoles(settings).includes(role))
}

function readVoiceBookingReview(metadata: unknown): Record<string, unknown> | null {
  if (!isRecord(metadata)) return null
  return isRecord(metadata['voiceBookingReview']) ? metadata['voiceBookingReview'] : null
}

const conversationsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ── List ──
  app.get('/', async (request, reply) => {
    const parsed = validate(listQuerySchema, request.query, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request, parsed.data.clinic_id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

    const result = await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      const usePagedSearch =
        parsed.data.q !== undefined ||
        parsed.data.limit !== undefined ||
        parsed.data.offset !== undefined
      const searchResult = usePagedSearch
        ? await repo.searchByClinic(clinicId, {
            q: parsed.data.q,
            status: parsed.data.status as ConversationStatus | undefined,
            assignedTo:
              parsed.data.assigned_to && parsed.data.assigned_to !== 'unassigned'
                ? parsed.data.assigned_to
                : undefined,
            limit: parsed.data.limit,
            offset: parsed.data.offset,
          })
        : null
      const rows = searchResult?.rows ?? (await repo.listByClinic(clinicId, parsed.data.status as ConversationStatus | undefined))
      const assignedTo = parsed.data.assigned_to
      const filtered = !assignedTo
        ? rows
        : assignedTo === 'unassigned'
          ? // `unassigned` is a reserved sentinel for "no assignee"; any other value
            // is a user id (filter assigned work by user — Rev1 #35).
            rows.filter((c) => c.assignedTo == null)
          : rows.filter((c) => c.assignedTo === assignedTo)

      // Req 20: attach each conversation's tag names so the list can flag urgent /
      // safety threads at a glance. One grouped query instead of an N+1 per row.
      const tagRows = await repo.listTagNamesByClinic(clinicId)
      const tagsByConversation = new Map<string, string[]>()
      for (const { conversationId, name } of tagRows) {
        const list = tagsByConversation.get(conversationId)
        if (list) list.push(name)
        else tagsByConversation.set(conversationId, [name])
      }

      // Req 4/35: attach each thread's most recent message so the list row can show
      // a preview (the inbox's row preview line). One DISTINCT ON query, not an
      // N+1 per row — mirrors the tag-name fan-in above.
      const lastMessageRows = await repo.listLastMessageByClinic(clinicId)
      const lastByConversation = new Map<string, { content: string; contentType: string; role: string }>()
      for (const { conversationId, content, contentType, role } of lastMessageRows) {
        lastByConversation.set(conversationId, { content, contentType, role })
      }

      // Attach each thread's patient name so the list row (and thread header) can show
      // who the patient is rather than the raw phone/handle. One join query, not an
      // N+1 — mirrors the tag-name fan-in above. Absent for unnamed/unlinked patients.
      const patientNameRows = await repo.listPatientNamesByClinic(clinicId)
      const patientNameByConversation = new Map<string, string>()
      for (const { conversationId, patientName } of patientNameRows) {
        patientNameByConversation.set(conversationId, patientName)
      }

      return {
        conversations: filtered.map((c) => ({
          ...c,
          tags: tagsByConversation.get(c.id) ?? [],
          lastMessage: lastByConversation.get(c.id) ?? null,
          patientName: patientNameByConversation.get(c.id) ?? null,
        })),
        page: usePagedSearch
          ? {
              limit: parsed.data.limit ?? 50,
              offset: parsed.data.offset ?? 0,
              total: assignedTo === 'unassigned' ? filtered.length : searchResult?.total ?? filtered.length,
            }
          : undefined,
      }
    })
    return result
  })

  app.post('/bulk', { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(bulkSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const count = await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      if (parsed.data.action === 'assign') {
        return repo.bulkUpdate(clinicId, parsed.data.ids, { assignedTo: parsed.data.userId ?? null, status: 'assigned' })
      }
      if (parsed.data.action === 'resolve') {
        return repo.bulkUpdate(clinicId, parsed.data.ids, { status: 'resolved' })
      }
      return repo.bulkUpdate(clinicId, parsed.data.ids, { status: 'archived' })
    })
    return { updated: count }
  })

  // ── Detail ──
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const conversation = await withDb(async (sql) => {
      const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
      if (!convo) return null
      // Enrich with the patient's name (mirrors the list fan-in) so the thread header
      // can show who the patient is rather than the raw phone/handle.
      let patientName: string | null = null
      if (convo.patientId) {
        const patient = await createPatientsRepository(sql).findById(clinicId, convo.patientId)
        patientName = patient?.fullName?.trim() ? patient.fullName : null
      }
      return { ...convo, patientName }
    })
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })
    return { conversation }
  })

  app.get<{ Params: { id: string } }>('/:id/voice-booking-review/audio-url', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

    const result = await withDb(async (sql) => {
      const [clinic, conversation] = await Promise.all([
        createClinicsRepository(sql).findById(clinicId),
        createConversationsRepository(sql).findById(clinicId, request.params.id),
      ])
      if (!clinic || !conversation) return { code: 404 as const }
      if (!canReviewVoice(request.user?.role, clinic.settings)) return { code: 403 as const }
      const review = readVoiceBookingReview(conversation.metadata)
      const objectKey = typeof review?.['audioObjectKey'] === 'string' ? review['audioObjectKey'] : null
      if (!objectKey) return { code: 404 as const }
      const url = await createVoiceReviewAudioUrl(objectKey)
      if (!url) return { code: 503 as const }
      return { code: 200 as const, url }
    })

    if (result.code !== 200) {
      const error =
        result.code === 403
          ? 'Forbidden'
          : result.code === 503
            ? 'Voice storage is not configured'
            : 'Voice review audio not found'
      return reply.code(result.code).send({ error })
    }
    return { url: result.url }
  })

  app.post<{ Params: { id: string } }>(
    '/:id/voice-booking-review',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(voiceReviewUpdateSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const clinics = createClinicsRepository(sql)
        const conversations = createConversationsRepository(sql)
        const [clinic, conversation] = await Promise.all([
          clinics.findById(clinicId),
          conversations.findById(clinicId, request.params.id),
        ])
        if (!clinic || !conversation) return { code: 404 as const }
        if (!canReviewVoice(request.user?.role, clinic.settings)) return { code: 403 as const }

        const review = readVoiceBookingReview(conversation.metadata)
        if (!review) return { code: 404 as const }

        const correctedFields =
          parsed.data.correctedFields !== undefined
            ? Object.fromEntries(
                Object.entries(parsed.data.correctedFields).map(([key, value]) => [key, value.trim()]),
              )
            : isRecord(review['correctedFields'])
              ? Object.fromEntries(
                  Object.entries(review['correctedFields']).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                )
              : {}

        const now = new Date().toISOString()
        const nextReview = {
          ...review,
          status: parsed.data.status ?? review['status'] ?? 'pending_review',
          notes:
            parsed.data.notes !== undefined
              ? parsed.data.notes?.trim() || null
              : typeof review['notes'] === 'string'
                ? review['notes']
                : null,
          correctedFields,
          reviewerId: request.user!.userId,
          reviewerName: request.user!.email,
          reviewerRole: request.user!.role,
          reviewedAt: now,
          updatedAt: now,
        }

        const metadata = isRecord(conversation.metadata) ? conversation.metadata : {}
        const updated = await conversations.update(clinicId, request.params.id, {
          metadata: {
            ...metadata,
            voiceBookingReview: nextReview,
          },
        })
        return { code: 200 as const, conversation: updated }
      })

      if (result.code !== 200) {
        const error = result.code === 403 ? 'Forbidden' : 'Voice booking review not found'
        return reply.code(result.code).send({ error })
      }
      return { conversation: result.conversation }
    },
  )

  // ── Assign ──
  app.post<{ Params: { id: string } }>(
    '/:id/assign',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(assignSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const assignee = parsed.data.userId ?? request.user!.userId

      const result = await withDb(async (sql) => {
        const conversations = createConversationsRepository(sql)
        const existing = await conversations.findById(clinicId, request.params.id)
        if (!existing) return { notFound: true as const }

        const target = (await createUsersRepository(sql).listWithRoles(clinicId)).find((member) => member.id === assignee)
        if (!target || target.status !== 'active') return { invalidAssignee: true as const }
        if (
          request.user!.role !== 'clinic_admin' &&
          request.user!.role !== 'ia_studio_admin' &&
          !NON_ADMIN_ASSIGNABLE_ROLES.has(target.role)
        ) {
          return { forbiddenAssignee: true as const }
        }

        const conversation = await conversations.update(clinicId, request.params.id, { assignedTo: assignee, status: 'assigned' })
        return { conversation }
      })
      if ('notFound' in result) return reply.code(404).send({ error: 'Conversation not found' })
      if ('invalidAssignee' in result) return reply.code(400).send({ error: 'Assignee must be an active clinic user' })
      if ('forbiddenAssignee' in result) return reply.code(403).send({ error: 'Non-admin users can only assign conversations to secretaries or doctors' })
      const conversation = result.conversation
      return { conversation }
    },
  )

  // ── Close ──
  app.post<{ Params: { id: string } }>('/:id/close', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const conversation = await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      const existing = await repo.findById(clinicId, request.params.id)
      if (!existing) return null
      return repo.update(clinicId, request.params.id, { status: 'resolved' })
    })
    if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })
    return { conversation }
  })

  // ── Set status (Req 11) — generic lifecycle transition ──
  // Moves a conversation to any of the 7 statuses (pending/snoozed/archived plus
  // open/resolved). Handoff records an explicit bot pause marker, while setting it
  // back to `open` clears that metadata so the bot truly resumes. The dedicated
  // assign/close/resume-bot routes remain
  // the one-click paths for the common transitions.
  app.post<{ Params: { id: string } }>(
    '/:id/status',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(statusSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const conversation = await withDb(async (sql) => {
        const repo = createConversationsRepository(sql)
        const existing = await repo.findById(clinicId, request.params.id)
        if (!existing) return null
        const metadata: Record<string, unknown> = {
          ...existing.metadata,
          statusChangedAt: new Date().toISOString(),
        }
        if (parsed.data.status === 'open') {
          delete metadata.botPausedAt
          delete metadata.handoffReason
        } else if (parsed.data.status === 'handoff') {
          // Keep an explicit pause marker for one-click secretary handoff. The
          // status drives routing; metadata drives audit/safety surfaces.
          metadata.botPausedAt = new Date().toISOString()
          metadata.handoffReason = 'manual_pause'
        }
        // CRE-60: snoozing parks the thread until snooze_until (default 3h); any other
        // transition clears it so a reopened/resolved thread never auto-wakes.
        const snoozeUntil =
          parsed.data.status === 'snoozed'
            ? new Date(Date.now() + (parsed.data.snoozeMinutes ?? 180) * 60_000).toISOString()
            : null
        return repo.update(clinicId, request.params.id, { status: parsed.data.status, snoozeUntil, metadata })
      })
      if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })
      return { conversation }
    },
  )

  // ── Hard delete (destructive, irreversible) ──
  // Real DELETE FROM conversations — every dependent table is handled by
  // existing FK constraints (ON DELETE CASCADE for messages/tags/notes, ON
  // DELETE SET NULL for appointments/usage-events/etc.), so a single delete
  // is sufficient (see ConversationsRepository.delete doc comment). Gated to
  // admins only — front-line roles can archive but not permanently destroy
  // patient communication records — and re-checks the caller's own password,
  // mirroring DELETE /clinics/:id.
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(deleteConversationSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const result = await withDb(async (sql) => {
        const auth = await createUsersRepository(sql).findAuthByEmail(request.user!.email)
        if (!auth || !auth.passwordHash || !verifyPassword(parsed.data.password, auth.passwordHash)) {
          return { code: 'bad-password' as const }
        }
        const repo = createConversationsRepository(sql)
        const existing = await repo.findById(clinicId, request.params.id)
        if (!existing) return { code: 'not-found' as const }
        const deleted = await repo.delete(clinicId, request.params.id)
        if (!deleted) return { code: 'not-found' as const }
        await createAuditRepository(sql).log({
          clinicId,
          actorId: request.user?.userId,
          actorEmail: request.user?.email,
          action: 'conversation.deleted',
          resourceType: 'conversation',
          resourceId: request.params.id,
          metadata: {
            previousStatus: existing.status,
            channel: existing.channel,
            patientId: existing.patientId,
            channelContactHandle: existing.channelContactHandle,
          },
          ipAddress: request.ip,
        })
        return { code: 'ok' as const }
      })
      if (result.code === 'bad-password') return reply.code(401).send({ error: 'Incorrect password' })
      if (result.code === 'not-found') return reply.code(404).send({ error: 'Conversation not found' })
      return reply.code(204).send()
    },
  )

  // ── Return to bot (Rev1 #5/#6) — manual reactivation of a paused bot ──
  // Flips a human-owned conversation back to `open` so the bot resumes auto-
  // replying, and unassigns it. The counterpart to the human-takeover pause.
  app.post<{ Params: { id: string } }>(
    '/:id/resume-bot',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const conversation = await withDb(async (sql) => {
        const repo = createConversationsRepository(sql)
        const existing = await repo.findById(clinicId, request.params.id)
        if (!existing) return null
        const metadata: Record<string, unknown> = {
          ...existing.metadata,
          botReactivatedAt: new Date().toISOString(),
        }
        delete metadata.botPausedAt
        delete metadata.handoffReason
        return repo.update(clinicId, request.params.id, {
          status: 'open',
          assignedTo: null,
          metadata,
        })
      })
      if (!conversation) return reply.code(404).send({ error: 'Conversation not found' })
      return { conversation }
    },
  )

  // ── Reopen → NEW conversation (Decision 4) ──
  app.post<{ Params: { id: string } }>('/:id/reopen', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const created = await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      const old = await repo.findById(clinicId, request.params.id)
      if (!old) return null
      return repo.create({
        clinicId,
        patientId: old.patientId ?? undefined,
        channel: old.channel,
        channelContactHandle: old.channelContactHandle,
        iaProfileId: old.iaProfileId ?? undefined,
        metadata: { reopenedFrom: old.id },
      })
    })
    if (!created) return reply.code(404).send({ error: 'Conversation not found' })
    return reply.code(201).send({ conversation: created })
  })

  // ── Messages ──
  app.get<{ Params: { id: string } }>('/:id/messages', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const messages = await withDb(async (sql) => {
      const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
      if (!convo) return null
      return createMessagesRepository(sql).listByConversation(clinicId, request.params.id)
    })
    if (messages === null) return reply.code(404).send({ error: 'Conversation not found' })
    return { messages }
  })

  // ── Inbound media proxy (Req 3) — authenticated, on-demand WhatsApp image ──
  // A patient's image lives behind a short-lived, bearer-gated Meta URL, and the
  // browser can't attach the panel's JWT to an <img src>, so the inbox fetches the
  // image through this clinic-scoped proxy. The bytes are downloaded on demand and
  // streamed straight back — never persisted. Image messages only.
  app.get<{ Params: { id: string; messageId: string } }>(
    '/:id/messages/:messageId/media',
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }
        const message = await createMessagesRepository(sql).findById(clinicId, request.params.messageId)
        if (!message || message.conversationId !== request.params.id || message.contentType !== 'image') {
          return { code: 404 as const }
        }
        const mediaId = (message.metadata as { mediaId?: unknown }).mediaId
        if (typeof mediaId !== 'string') return { code: 404 as const }
        // The bearer token for the Graph media fetch lives on the clinic's active
        // WhatsApp channel account (same credential the inbound/outbound path uses).
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
        if (!account?.accessTokenEnc) return { code: 502 as const }
        const token = readMetaToken(account.accessTokenEnc)
        if (!token) return { code: 502 as const }
        return { code: 200 as const, mediaId, token }
      })

      if (resolved.code !== 200) {
        return reply
          .code(resolved.code)
          .send({ error: resolved.code === 404 ? 'Media not found' : 'Channel not configured' })
      }

      try {
        const media = await fetchWhatsAppMedia(resolved.mediaId, resolved.token)
        return reply
          .header('content-type', media.mimeType)
          .header('cache-control', 'private, max-age=300')
          .send(Buffer.from(media.buffer))
      } catch (err) {
        request.log.error(`[media] download failed: ${(err as Error).message}`)
        return reply.code(502).send({ error: 'Media download failed' })
      }
    },
  )

  // A secretary's manual reply is DELIVERED to the patient over the conversation's
  // channel (Req 3/33/34) — not merely persisted. Mirrors the agent worker's send
  // transport: resolve the channel credentials, send, capture the provider message
  // id (wamid / Messenger+Instagram mid) and persist it as channel_message_id so
  // the delivery-status pipeline + the inbox ✓/✓✓/read indicator track this manual
  // reply exactly like a bot reply.
  app.post<{ Params: { id: string } }>(
    '/:id/messages',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(messageSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      // Resolve the conversation and build the channel send transport. The Meta
      // send itself happens OUTSIDE the db callback so we don't hold a connection
      // across the network round-trip (mirrors the inbound media proxy). The
      // closure captures only primitives + a module-level sender, so it is safe to
      // call after the connection is released.
      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }

        let send: ((text: string) => Promise<string | null>) | null = null
        const recipient = convo.channelContactHandle
        if (convo.channel === 'messenger' || convo.channel === 'instagram') {
          // Messenger/Instagram tokens live on the clinic row (Req 33/34).
          const clinic = await createClinicsRepository(sql).findById(clinicId)
          if (convo.channel === 'messenger') {
            const token = clinic?.messengerEnabled ? readMetaToken(clinic.messengerPageAccessTokenEncrypted) : null
            if (token) send = (text) => sendMessengerText(token, recipient, text)
          } else {
            const token = clinic?.instagramEnabled ? readMetaToken(clinic.instagramPageAccessTokenEncrypted) : null
            if (token) send = (text) => sendInstagramText(token, recipient, text)
          }
        } else {
          // WhatsApp credentials live on the active channel account (Req 3).
          const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
          const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
          if (account?.accessTokenEnc) {
            const phoneNumberId = account.accountId
            const token = readMetaToken(account.accessTokenEnc)
            if (token) send = (text) => sendWhatsAppText(phoneNumberId, token, recipient, text)
          }
        }
        return { code: 200 as const, convo, recipient, send }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      // No usable credentials for this channel (WhatsApp account inactive, or
      // Messenger/Instagram not connected) — there is no way to reach the patient.
      if (!resolved.send) return reply.code(502).send({ error: 'Channel not configured' })

      // Deliver to the patient. A failed send (expired/invalid token, rate limit,
      // a send rejected outside the 24-hour window) is recorded to the Error Review
      // area as `meta_send_failure` (Req 19/29) and surfaced to the secretary as a
      // 502 — the reply is NOT persisted, so the draft can be retried rather than
      // leaving a phantom "sent" bubble that never arrived.
      let channelMessageId: string | null = null
      try {
        channelMessageId = await resolved.send(parsed.data.content)
      } catch (err) {
        request.log.error(`[messages] channel send failed: ${(err as Error).message}`)
        await withDb((sql) =>
          createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: err instanceof Error ? err.message : String(err),
            context: {
              conversationId: request.params.id,
              channel: resolved.convo.channel,
              recipient: resolved.recipient,
              sentBy: request.user!.userId,
            },
          }),
        ).catch((logErr) =>
          request.log.error(`[messages] failed to log send error: ${(logErr as Error).message}`),
        )
        return reply.code(502).send({ error: 'Message send failed' })
      }

      const message = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: parsed.data.content,
          contentType: parsed.data.contentType ?? 'text',
          channelMessageId: channelMessageId ?? undefined,
          metadata: { authorId: request.user!.userId },
        })
        // Bot Interruption Rule (Rev1 #6): a manual human reply takes the
        // conversation over, so pause the bot. Only escalate an `open`
        // conversation — `assigned`/`handoff` are already human-owned, and
        // `resolved` stays closed.
        if (resolved.convo.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.convo.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        return created
      })
      return reply.code(201).send({ message })
    },
  )

  // ── Approved templates a secretary may send by hand (Req 3) ──
  // The clinic's APPROVED WhatsApp HSM templates — the only copy that can reach a
  // patient outside Meta's 24-hour customer-care window. Scoped to the
  // conversation's clinic so the inbox composer needn't hit the admin /clinics
  // routes (which a secretary can't). Templates are a WhatsApp concept; for a
  // Messenger/Instagram thread the picker simply shows nothing.
  app.get<{ Params: { id: string } }>(
    '/:id/templates',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const result = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return null
        if (convo.channel !== 'whatsapp') return []
        return createMessageTemplatesRepository(sql).listApproved(clinicId)
      })
      if (result === null) return reply.code(404).send({ error: 'Conversation not found' })
      return { templates: result }
    },
  )

  // ── Send an approved HSM template to the patient (Req 3) ──
  // A secretary re-engages a patient who is outside the 24h window by sending one
  // of the clinic's approved WhatsApp templates. Mirrors the manual-reply send: a
  // real `type:'template'` Meta message goes out, its wamid is captured so the
  // delivery-status pipeline + the inbox ✓/✓✓/read indicator track it, the
  // template body is persisted as the bubble text, and the Bot Interruption Rule
  // pauses the bot. Templates are WhatsApp-only (Messenger/Instagram → 400). A
  // pending/rejected/unknown template can never be sent (→ 404).
  app.post<{ Params: { id: string } }>(
    '/:id/send-template',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(sendTemplateSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }
        // HSM templates are a WhatsApp-only mechanism.
        if (convo.channel !== 'whatsapp') return { code: 400 as const }
        const template = await createMessageTemplatesRepository(sql).findApprovedById(
          clinicId,
          parsed.data.templateId,
        )
        if (!template) return { code: 404 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
        if (!account?.accessTokenEnc) return { code: 502 as const }
        return {
          code: 200 as const,
          convo,
          template,
          phoneNumberId: account.accountId,
          token: readMetaToken(account.accessTokenEnc)!,
          recipient: convo.channelContactHandle,
        }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Not found' })
      if (resolved.code === 400) {
        return reply.code(400).send({ error: 'Templates are only supported on WhatsApp' })
      }
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      // Deliver the template. A failed send (expired/invalid token, an unapproved
      // template name, a rate limit) is recorded to the Error Review area as
      // `meta_send_failure` (Req 19/29) and surfaced as a 502 — nothing is persisted.
      let channelMessageId: string | null = null
      try {
        channelMessageId = await sendWhatsAppTemplate(
          resolved.phoneNumberId,
          resolved.token,
          resolved.recipient,
          resolved.template.name,
          resolved.template.language,
        )
      } catch (err) {
        request.log.error(`[send-template] channel send failed: ${(err as Error).message}`)
        await withDb((sql) =>
          createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: err instanceof Error ? err.message : String(err),
            context: {
              conversationId: request.params.id,
              channel: 'whatsapp',
              recipient: resolved.recipient,
              templateName: resolved.template.name,
              sentBy: request.user!.userId,
            },
          }),
        ).catch((logErr) =>
          request.log.error(`[send-template] failed to log send error: ${(logErr as Error).message}`),
        )
        return reply.code(502).send({ error: 'Template send failed' })
      }

      const message = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: resolved.template.body,
          contentType: 'template',
          channelMessageId: channelMessageId ?? undefined,
          metadata: {
            authorId: request.user!.userId,
            templateId: resolved.template.id,
            templateName: resolved.template.name,
          },
        })
        // Bot Interruption Rule (Rev1 #6): sending a template is a human takeover.
        if (resolved.convo.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.convo.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        return created
      })
      return reply.code(201).send({ message })
    },
  )

  // ── Send an interactive reply-button menu to the patient (Req 3) ──
  // A secretary offers the patient a small set of tappable choices (e.g. "Sí,
  // confirmar" / "Reprogramar" / "Cancelar"). Mirrors the manual-reply send: a real
  // `type:'interactive'` WhatsApp message goes out, its wamid is captured so the
  // delivery-status pipeline + the inbox ✓/✓✓/read indicator track it, the body is
  // persisted as the bubble text (the offered buttons in metadata), and the Bot
  // Interruption Rule pauses the bot. When the patient taps a button the inbound
  // webhook's interactive parsing feeds the tapped title back as ordinary message
  // text, closing the loop. WhatsApp-only (Messenger/Instagram → 400).
  app.post<{ Params: { id: string } }>(
    '/:id/send-interactive',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(sendInteractiveSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }
        // Interactive button menus are a WhatsApp-only mechanism here.
        if (convo.channel !== 'whatsapp') return { code: 400 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
        if (!account?.accessTokenEnc) return { code: 502 as const }
        return {
          code: 200 as const,
          convo,
          phoneNumberId: account.accountId,
          token: readMetaToken(account.accessTokenEnc)!,
          recipient: convo.channelContactHandle,
        }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      if (resolved.code === 400) {
        return reply.code(400).send({ error: 'Interactive menus are only supported on WhatsApp' })
      }
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      // Deliver the menu. A failed send (expired/invalid token, a send rejected
      // outside the 24h window, rate limit) is recorded to the Error Review area as
      // `meta_send_failure` (Req 19/29) and surfaced as a 502 — nothing is persisted.
      let channelMessageId: string | null = null
      try {
        channelMessageId = await sendWhatsAppInteractive(
          resolved.phoneNumberId,
          resolved.token,
          resolved.recipient,
          parsed.data.body,
          parsed.data.buttons,
        )
      } catch (err) {
        request.log.error(`[send-interactive] channel send failed: ${(err as Error).message}`)
        await withDb((sql) =>
          createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: err instanceof Error ? err.message : String(err),
            context: {
              conversationId: request.params.id,
              channel: 'whatsapp',
              recipient: resolved.recipient,
              sentBy: request.user!.userId,
            },
          }),
        ).catch((logErr) =>
          request.log.error(`[send-interactive] failed to log send error: ${(logErr as Error).message}`),
        )
        return reply.code(502).send({ error: 'Interactive send failed' })
      }

      const message = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: parsed.data.body,
          contentType: 'interactive',
          channelMessageId: channelMessageId ?? undefined,
          metadata: {
            authorId: request.user!.userId,
            buttons: parsed.data.buttons,
          },
        })
        // Bot Interruption Rule (Rev1 #6): offering a menu is a human takeover.
        if (resolved.convo.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.convo.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        return created
      })
      return reply.code(201).send({ message })
    },
  )

  // ── Send an interactive LIST menu to the patient (Req 3) ──
  // The >3-options counterpart to the reply-button menu: a body plus a menu button
  // that opens a single-select list of rows (e.g. available time slots, specialties).
  // Mirrors send-interactive: a real `type:'interactive'` list message goes out, its
  // wamid is captured so the delivery-status pipeline + the inbox ✓/✓✓/read indicator
  // track it, the body is persisted as the bubble text (the offered rows in metadata),
  // and the Bot Interruption Rule pauses the bot. When the patient picks a row the
  // inbound webhook's interactive parsing feeds the chosen row title back as ordinary
  // message text, closing the loop. WhatsApp-only (Messenger/Instagram → 400).
  app.post<{ Params: { id: string } }>(
    '/:id/send-list',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(sendListSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const resolved = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return { code: 404 as const }
        // Interactive list menus are a WhatsApp-only mechanism here.
        if (convo.channel !== 'whatsapp') return { code: 400 as const }
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        const account = accounts.find((a) => a.channel === 'whatsapp' && a.status === 'active')
        if (!account?.accessTokenEnc) return { code: 502 as const }
        return {
          code: 200 as const,
          convo,
          phoneNumberId: account.accountId,
          token: readMetaToken(account.accessTokenEnc)!,
          recipient: convo.channelContactHandle,
        }
      })

      if (resolved.code === 404) return reply.code(404).send({ error: 'Conversation not found' })
      if (resolved.code === 400) {
        return reply.code(400).send({ error: 'List menus are only supported on WhatsApp' })
      }
      if (resolved.code === 502) return reply.code(502).send({ error: 'Channel not configured' })

      // Deliver the list. A failed send (expired/invalid token, a send rejected
      // outside the 24h window, rate limit) is recorded to the Error Review area as
      // `meta_send_failure` (Req 19/29) and surfaced as a 502 — nothing is persisted.
      let channelMessageId: string | null = null
      try {
        channelMessageId = await sendWhatsAppList(
          resolved.phoneNumberId,
          resolved.token,
          resolved.recipient,
          parsed.data.body,
          parsed.data.button,
          parsed.data.sections,
        )
      } catch (err) {
        request.log.error(`[send-list] channel send failed: ${(err as Error).message}`)
        await withDb((sql) =>
          createErrorReviewsRepository(sql).create({
            clinicId,
            errorType: 'meta_send_failure',
            errorMessage: err instanceof Error ? err.message : String(err),
            context: {
              conversationId: request.params.id,
              channel: 'whatsapp',
              recipient: resolved.recipient,
              sentBy: request.user!.userId,
            },
          }),
        ).catch((logErr) =>
          request.log.error(`[send-list] failed to log send error: ${(logErr as Error).message}`),
        )
        return reply.code(502).send({ error: 'List send failed' })
      }

      const message = await withDb(async (sql) => {
        const created = await createMessagesRepository(sql).create({
          conversationId: request.params.id,
          clinicId,
          role: 'agent',
          content: parsed.data.body,
          contentType: 'interactive',
          channelMessageId: channelMessageId ?? undefined,
          metadata: {
            authorId: request.user!.userId,
            listButton: parsed.data.button,
            sections: parsed.data.sections,
          },
        })
        // Bot Interruption Rule (Rev1 #6): offering a menu is a human takeover.
        if (resolved.convo.status === 'open') {
          await createConversationsRepository(sql).update(clinicId, request.params.id, {
            status: 'handoff',
            metadata: {
              ...resolved.convo.metadata,
              botPausedAt: new Date().toISOString(),
              handoffReason: 'human_reply',
            },
          })
        }
        return created
      })
      return reply.code(201).send({ message })
    },
  )

  // ── Flag a bad bot response (Req 29 Error Review) ──
  // A secretary marks a specific bot reply as wrong/inappropriate from the inbox;
  // it lands in the Admin Studio Error Review queue as a `bad_response` entry where an
  // operator can review it and (Add-to-KB) correct the underlying knowledge.
  app.post<{ Params: { id: string } }>(
    '/:id/flag-response',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(flagResponseSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const error = await withDb(async (sql) => {
        const convo = await createConversationsRepository(sql).findById(clinicId, request.params.id)
        if (!convo) return null
        return createErrorReviewsRepository(sql).create({
          clinicId,
          errorType: 'bad_response',
          errorMessage: parsed.data.content,
          context: {
            conversationId: request.params.id,
            messageId: parsed.data.messageId ?? null,
            note: parsed.data.note ?? null,
            channel: convo.channel,
            flaggedBy: request.user!.userId,
          },
        })
      })
      if (!error) return reply.code(404).send({ error: 'Conversation not found' })
      return reply.code(201).send({ error })
    },
  )

  // ── Tags (Gap #13) ──
  app.get<{ Params: { id: string } }>('/:id/tags', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const tags = await withDb(async (sql) =>
      createConversationsRepository(sql).listTagsForConversation(clinicId, request.params.id),
    )
    return { tags }
  })

  app.post<{ Params: { id: string } }>('/:id/tags', async (request, reply) => {
    const parsed = validate(tagSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const tag = await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      const created = await repo.createTag({ clinicId, name: parsed.data.tag, color: parsed.data.color })
      await repo.addTag(clinicId, request.params.id, created.id)
      return created
    })
    return reply.code(201).send({ tag })
  })

  app.delete<{ Params: { id: string; tag: string } }>('/:id/tags/:tag', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    await withDb(async (sql) => {
      const repo = createConversationsRepository(sql)
      const tag = await repo.findTagByName(clinicId, request.params.tag)
      if (tag) await repo.removeTag(clinicId, request.params.id, tag.id)
    })
    return { removed: true }
  })

  // ── Notes (Gap #14 — internal only, never delivered to the patient) ──
  app.get<{ Params: { id: string } }>('/:id/notes', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const notes = await withDb(async (sql) =>
      createConversationsRepository(sql).listNotes(clinicId, request.params.id),
    )
    return { notes }
  })

  app.post<{ Params: { id: string } }>('/:id/notes', async (request, reply) => {
    const parsed = validate(noteSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const note = await withDb(async (sql) =>
      createConversationsRepository(sql).addNote({
        conversationId: request.params.id,
        clinicId,
        authorId: request.user!.userId,
        content: parsed.data.content,
      }),
    )
    return reply.code(201).send({ note })
  })

  // Edit / delete are restricted to the note's own author — a note belongs to the
  // person who wrote it. (Still never reaches the patient; internal_notes is wholly
  // separate from conversation_messages / the WhatsApp send path.)
  app.patch<{ Params: { id: string; noteId: string } }>(
    '/:id/notes/:noteId',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(noteSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const repo = createConversationsRepository(sql)
        const existing = await repo.findNoteById(clinicId, request.params.noteId)
        if (!existing) return { code: 404 as const }
        if (existing.authorId !== request.user!.userId) return { code: 403 as const }
        const note = await repo.updateNote(clinicId, request.params.noteId, parsed.data.content)
        return { code: 200 as const, note }
      })
      if (result.code !== 200) return reply.code(result.code).send({ error: result.code === 404 ? 'Note not found' : 'Forbidden' })
      return { note: result.note }
    },
  )

  app.delete<{ Params: { id: string; noteId: string } }>(
    '/:id/notes/:noteId',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const repo = createConversationsRepository(sql)
        const existing = await repo.findNoteById(clinicId, request.params.noteId)
        if (!existing) return { code: 404 as const }
        if (existing.authorId !== request.user!.userId) return { code: 403 as const }
        await repo.deleteNote(clinicId, request.params.noteId)
        return { code: 200 as const }
      })
      if (result.code !== 200) return reply.code(result.code).send({ error: result.code === 404 ? 'Note not found' : 'Forbidden' })
      return { deleted: true }
    },
  )
}

export default conversationsRoute
