// Consumes: workflow-run queue (Rev 3 phase 2b — N8N-style automation workflows).
//
// Loads the active workflow, builds real executors over the clinic's channels +
// repositories, and walks the node graph via the pure engine (@docmee/agents). Send
// executors re-check consent + an active WhatsApp account at run time (the producer
// only wires the reactive message_keyword trigger today, so sends are inside Meta's
// care window). Delay nodes re-enqueue to resume; approval / ai_draft alert a
// secretary in v1 (full approve-and-resume round-trip is phase 3).
import { runWorkflow, type WorkflowContext, type WorkflowExecutors } from '@docmee/agents'
import { randomUUID } from 'node:crypto'
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'
import { extractVoiceBookingDetails } from './voice-booking.js'
import { appendPatientHistoryEntry } from './voice-storage.js'
import { type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createPatientsRepository,
  createChannelAccountsRepository,
  createConversationsRepository,
  createMessagesRepository,
  createMessageTemplatesRepository,
  createNotificationsRepository,
  createWorkflowsRepository,
  type Patient,
  type PatientContact,
  type MessageTemplateCategory,
} from '@docmee/db'
import { WorkflowRunJobSchema, scheduleWorkflowResume, type WorkflowRunJobData } from './workflow-run.js'

type Sql = ReturnType<typeof createServiceDbClient>
type ReviewFieldMap = Record<string, string>

interface VoiceBookingReviewRecord {
  reviewId: string
  status: 'pending_review' | 'approved' | 'rejected' | 'edited'
  reviewRequired: boolean
  reviewReason: string | null
  transcript: string
  extractedFields: ReviewFieldMap
  correctedFields: ReviewFieldMap
  confidence: string
  source: string
  containsDisallowedMedicalContent: boolean
  audioObjectKey: string | null
  voiceMessageId: string | null
  waMessageId: string | null
  notes: string | null
  reviewerId: string | null
  reviewerName: string | null
  reviewerRole: string | null
  reviewedAt: string | null
  createdAt: string
  updatedAt: string
}

function isPatientOptedOut(patient: Patient): boolean {
  return (patient.metadata as { optedOut?: unknown }).optedOut === true
}
function primaryWhatsAppHandle(contacts: PatientContact[]): string | null {
  const whatsapp = contacts.filter((c) => c.channel === 'whatsapp')
  return (whatsapp.find((c) => c.isPrimary) ?? whatsapp[0])?.contactHandle ?? null
}

/** Resolve a sendable WhatsApp target for the trigger's patient, or null when we
 *  must not send (opted out, no active account, no handle). */
async function resolveTarget(
  sql: Sql,
  clinicId: string,
  patientId: string | undefined,
): Promise<{ account: import('@docmee/db').ChannelAccount; handle: string; send: (text: string) => Promise<string | null> } | null> {
  if (!patientId) return null
  const patient = await createPatientsRepository(sql).findById(clinicId, patientId)
  if (!patient || isPatientOptedOut(patient)) return null
  const account = activeWhatsAppAccount(await createChannelAccountsRepository(sql).listByClinic(clinicId))
  if (!account) return null
  const handle = primaryWhatsAppHandle(await createPatientsRepository(sql).listContacts(clinicId, patientId))
  if (!handle) return null
  const send = resolveWhatsAppSender(account, handle)
  if (!send) return null
  return { account, handle, send }
}

async function persistOutbound(sql: Sql, clinicId: string, conversationId: string | undefined, text: string, wamid: string | null): Promise<void> {
  if (!conversationId) return
  try {
    await createMessagesRepository(sql).create({
      conversationId,
      clinicId,
      role: 'assistant',
      content: text,
      ...(wamid ? { channelMessageId: wamid } : {}),
      metadata: { channel: 'whatsapp', source: 'workflow' },
    })
  } catch (err) {
    console.error('[workflow] failed to persist outbound message:', err)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function fieldMap(value: unknown): ReviewFieldMap {
  if (!isRecord(value)) return {}
  return Object.entries(value).reduce<ReviewFieldMap>((acc, [key, raw]) => {
    if (typeof raw === 'string' && raw.trim()) acc[key] = raw.trim()
    return acc
  }, {})
}

function reviewReasonForExtraction(input: {
  needsReview: boolean
  containsDisallowedMedicalContent: boolean
  extracted: ReviewFieldMap
}): string | null {
  if (input.containsDisallowedMedicalContent) return 'medical_content_detected'
  if (Object.keys(input.extracted).length === 0) return 'no_booking_fields_detected'
  if (input.needsReview) return 'booking_details_need_human_review'
  return null
}

function buildExecutors(sql: Sql, data: WorkflowRunJobData): WorkflowExecutors {
  const { clinicId } = data
  const notify = async (content: string, ctx: WorkflowContext) =>
    void (await createNotificationsRepository(sql).create({
      clinicId,
      alertType: 'workflow',
      recipient: 'secretary',
      content,
      ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
    }))

  const addConversationTag = async (tag: string, ctx: WorkflowContext) => {
    if (!tag || !ctx.conversationId) return
    const conversations = createConversationsRepository(sql)
    const conv = await conversations.findById(clinicId, ctx.conversationId)
    if (!conv) return
    const existing = ((conv.metadata as { tags?: unknown }).tags as string[] | undefined) ?? []
    if (existing.includes(tag)) return
    await conversations.update(clinicId, ctx.conversationId, {
      metadata: { ...conv.metadata, tags: [...existing, tag] },
    })
  }

  const persistVoiceBookingReview = async (
    ctx: WorkflowContext,
    input: Awaited<ReturnType<typeof extractVoiceBookingDetails>>,
  ) => {
    if (!ctx.conversationId) return

    const conversations = createConversationsRepository(sql)
    const convo = await conversations.findById(clinicId, ctx.conversationId)
    if (!convo) return

    const patient =
      ctx.patientId ? await createPatientsRepository(sql).findById(clinicId, ctx.patientId) : null
    const metadata = isRecord(convo.metadata) ? convo.metadata : {}
    const existing = isRecord(metadata['voiceBookingReview']) ? metadata['voiceBookingReview'] : null
    const now = new Date().toISOString()
    const voiceMessageId = typeof ctx['voiceMessageId'] === 'string' ? ctx['voiceMessageId'] : null
    const audioObjectKey = typeof ctx['audioObjectKey'] === 'string' ? ctx['audioObjectKey'] : null
    const transcript = String(ctx.message ?? ctx.transcript ?? '').trim()
    const createNewReview =
      !existing ||
      existing['voiceMessageId'] !== voiceMessageId ||
      existing['audioObjectKey'] !== audioObjectKey ||
      existing['transcript'] !== transcript

    const review: VoiceBookingReviewRecord = {
      reviewId:
        !createNewReview && typeof existing?.['reviewId'] === 'string' && existing['reviewId']
          ? existing['reviewId']
          : randomUUID(),
      status: 'pending_review',
      reviewRequired: input.needsReview,
      reviewReason: reviewReasonForExtraction({
        needsReview: input.needsReview,
        containsDisallowedMedicalContent: input.containsDisallowedMedicalContent,
        extracted: input.extracted,
      }),
      transcript,
      extractedFields: fieldMap(input.extracted),
      correctedFields: !createNewReview ? fieldMap(existing?.['correctedFields']) : {},
      confidence: input.confidence,
      source: input.source,
      containsDisallowedMedicalContent: input.containsDisallowedMedicalContent,
      audioObjectKey,
      voiceMessageId,
      waMessageId: typeof ctx['waMessageId'] === 'string' ? ctx['waMessageId'] : null,
      notes: !createNewReview && typeof existing?.['notes'] === 'string' ? existing['notes'] : null,
      reviewerId: !createNewReview && typeof existing?.['reviewerId'] === 'string' ? existing['reviewerId'] : null,
      reviewerName:
        !createNewReview && typeof existing?.['reviewerName'] === 'string' ? existing['reviewerName'] : null,
      reviewerRole:
        !createNewReview && typeof existing?.['reviewerRole'] === 'string' ? existing['reviewerRole'] : null,
      reviewedAt: !createNewReview && typeof existing?.['reviewedAt'] === 'string' ? existing['reviewedAt'] : null,
      createdAt: !createNewReview && typeof existing?.['createdAt'] === 'string' ? existing['createdAt'] : now,
      updatedAt: now,
    }

    await conversations.update(clinicId, ctx.conversationId, {
      metadata: {
        ...metadata,
        voiceBookingReview: review,
      },
    })

    if (!createNewReview || !ctx.patientId) return

    await appendPatientHistoryEntry({
      clinicId,
      patientId: ctx.patientId,
      patientName: patient?.fullName ?? null,
      entry: {
        reviewId: review.reviewId,
        createdAt: review.createdAt,
        transcript: review.transcript,
        status: review.status,
        confidence: review.confidence,
        extractedFields: {
          ...review.extractedFields,
          ...(review.reviewReason ? { review_reason: review.reviewReason } : {}),
        },
      },
    }).catch((err) => {
      console.error('[workflow] failed to append patient voice history:', err)
    })
  }

  const persistVoiceBookingIntake = async (
    ctx: WorkflowContext,
    input: Awaited<ReturnType<typeof extractVoiceBookingDetails>>,
  ) => {
    if (!ctx.patientId) return
    const patients = createPatientsRepository(sql)
    const patient = await patients.findById(clinicId, ctx.patientId)
    if (!patient) return

    const metadata = (patient.metadata ?? {}) as Record<string, unknown>
    const intake = ((metadata['intake'] as Record<string, unknown> | undefined) ?? {})
    const extracted = input.extracted
    const now = new Date().toISOString()

    await patients.update(clinicId, ctx.patientId, {
      ...(extracted.patient_name && !patient.fullName ? { fullName: extracted.patient_name } : {}),
      metadata: {
        ...metadata,
        intake: {
          ...intake,
          ...(extracted.patient_name ? { patientName: extracted.patient_name } : {}),
          ...(extracted.phone_number ? { phoneNumber: extracted.phone_number } : {}),
          ...(extracted.preferred_date ? { preferredDate: extracted.preferred_date } : {}),
          ...(extracted.preferred_time ? { preferredTime: extracted.preferred_time } : {}),
          ...(extracted.clinic_location ? { clinicLocation: extracted.clinic_location } : {}),
          ...(extracted.doctor_preference
            ? { doctorPreference: extracted.doctor_preference, doctorName: extracted.doctor_preference }
            : {}),
          source: 'voice_note',
          lastVoiceBookingAt: now,
        },
        voiceBooking: {
          confidence: input.confidence,
          needsReview: input.needsReview,
          containsDisallowedMedicalContent: input.containsDisallowedMedicalContent,
          updatedAt: now,
        },
      },
    })
  }

  return {
    async sendMessage(text, ctx) {
      if (!text.trim()) return
      const target = await resolveTarget(sql, clinicId, ctx.patientId)
      if (!target) {
        console.log(`[workflow] no sendable WhatsApp target for clinic ${clinicId}; skipping send`)
        return
      }
      const wamid = await target.send(text)
      await persistOutbound(sql, clinicId, ctx.conversationId, text, wamid)
    },

    async sendTemplate(category, ctx) {
      if (!category) return
      const template = await createMessageTemplatesRepository(sql).findApprovedByCategory(
        clinicId,
        category as MessageTemplateCategory,
      )
      if (!template) {
        console.log(`[workflow] no approved template for category "${category}"; skipping`)
        return
      }
      const target = await resolveTarget(sql, clinicId, ctx.patientId)
      if (!target) return
      const wamid = await target.send(template.body)
      await persistOutbound(sql, clinicId, ctx.conversationId, template.body, wamid)
    },

    async notifySecretary(ctx) {
      await notify('A workflow flagged this conversation for attention.', ctx)
    },

    async addTag(tag, ctx) {
      await addConversationTag(tag, ctx)
    },

    async aiDraft(prompt, ctx) {
      // v1: surface the draft instruction to a secretary. Phase 3 runs the bot to
      // produce a draft reply and parks it for approval.
      await notify(`Workflow requests an AI draft: ${prompt || '(no prompt)'}`, ctx)
    },

    async requestApproval(_node, ctx) {
      // v1: alert a secretary. Phase 3 stores a resumable pending-approval row.
      await notify('A workflow step requires your approval before continuing.', ctx)
    },

    async transcribeBookingVoice(node, ctx) {
      const transcript = String(ctx.message ?? ctx.transcript ?? '').trim()
      if (!transcript) {
        ctx['needs_review'] = true
        ctx['voice_booking_confidence'] = 'low'
        return
      }

      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) return

      const extraction = await extractVoiceBookingDetails({
        transcript,
        clinicSettings: clinic.settings,
        allowedFields: String(node.config?.['allowedFields'] ?? node.config?.['allowed_fields'] ?? ''),
        provider: String(node.config?.['provider'] ?? ''),
      })

      ctx['needs_review'] = extraction.needsReview
      ctx['contains_disallowed_medical_content'] = extraction.containsDisallowedMedicalContent
      ctx['voice_booking_confidence'] = extraction.confidence
      ctx['voice_booking_source'] = extraction.source

      for (const [key, value] of Object.entries(extraction.extracted)) {
        ctx[key] = value
      }

      await persistVoiceBookingIntake(ctx, extraction)
      await persistVoiceBookingReview(ctx, extraction)

      const reviewTag = String(node.config?.['reviewTag'] ?? node.config?.['review_tag'] ?? '').trim()
      if (reviewTag && extraction.needsReview) {
        await addConversationTag(reviewTag, ctx)
      }
    },

    async scheduleResume(nodeId, ms) {
      if (!nodeId) return
      await scheduleWorkflowResume(data, nodeId, ms)
    },
  }
}

export async function processWorkflowRunJob(job: Job): Promise<void> {
  const data = WorkflowRunJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const workflow = await createWorkflowsRepository(sql).findById(data.clinicId, data.workflowId)
    if (!workflow || workflow.status !== 'active') {
      console.log(`[workflow] ${data.workflowId} not active; skipping run`)
      return
    }
    const ctx: WorkflowContext = { ...data.trigger }
    const exec = buildExecutors(sql, data)
    const trace = await runWorkflow(workflow, ctx, exec, data.startNodeId ? { startNodeId: data.startNodeId } : {})
    console.log(`[workflow] ${workflow.name} ran ${trace.length} step(s) for clinic ${data.clinicId}`)
  } finally {
    await sql.end()
  }
}
