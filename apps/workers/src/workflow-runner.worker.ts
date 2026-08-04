// Consumes: workflow-run queue (Rev 3 phase 2b — N8N-style automation workflows).
//
// Loads the active workflow, builds real executors over the clinic's channels +
// repositories, and walks the node graph via the pure engine (@docmee/agents). Send
// executors re-check consent + an active WhatsApp account at run time (the producer
// only wires the reactive message_keyword trigger today, so sends are inside Meta's
// care window). Delay nodes re-enqueue to resume; approval / ai_draft alert a
// secretary in v1 (full approve-and-resume round-trip is phase 3).
import {
  createGoogleCalendarOps,
  runWorkflow,
  validateWorkflowDefinition,
  WORKFLOW_CAPTURE_CONTEXT_KEY,
  type CalendarOps,
  type RefreshedTokens,
  type WorkflowCaptureState,
  type WorkflowContext,
  type WorkflowExecutors,
} from '@docmee/agents'
import { decryptValue, encryptValue } from '@docmee/shared'
import { randomUUID } from 'node:crypto'
import { sendWhatsAppInteractive, sendWhatsAppList, type WhatsAppListSection, type WhatsAppReplyButton } from '@docmee/channels'
import { chatComplete, defaultChatModel, type ChatProvider } from '@docmee/llm'
import { activeWhatsAppAccount, readMetaToken, resolveWhatsAppSender } from './meta-token.js'
import { extractVoiceBookingDetails } from './voice-booking.js'
import { resolveClinicAiKey } from './clinic-ai-key.js'
import { appendPatientHistoryEntry } from './voice-storage.js'
import { scheduleNoResponseFollowUp } from './follow-up.js'
import { type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createPatientsRepository,
  createChannelAccountsRepository,
  createConversationsRepository,
  createDoctorsRepository,
  createDoctorServicesRepository,
  createAppointmentsRepository,
  createMessagesRepository,
  createMessageTemplatesRepository,
  createNotificationsRepository,
  createWorkflowsRepository,
  createWorkflowExecutionsRepository,
  createWorkflowApprovalsRepository,
  type Patient,
  type PatientContact,
  type MessageTemplateCategory,
  type Clinic,
  type Doctor,
} from '@docmee/db'
import {
  WorkflowRunJobSchema,
  scheduleWorkflowResume,
  writePendingWorkflowRun,
  type WorkflowRunJobData,
} from './workflow-run.js'

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

async function persistOutbound(sql: Sql, clinicId: string, conversationId: string | undefined, text: string, wamid: string | null, metadata: Record<string, unknown> = {}): Promise<void> {
  if (!conversationId) return
  try {
    await createMessagesRepository(sql).create({
      conversationId,
      clinicId,
      role: 'assistant',
      content: text,
      contentType: metadata['contentType'] === 'interactive' ? 'interactive' : 'text',
      ...(wamid ? { channelMessageId: wamid } : {}),
      metadata: { channel: 'whatsapp', source: 'workflow', ...metadata },
    })
  } catch (err) {
    console.error('[workflow] failed to persist outbound message:', err)
  }
}

async function persistOutboundAttempt(
  sql: Sql,
  clinicId: string,
  conversationId: string | undefined,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<string | null> {
  if (!conversationId) return null
  try {
    const message = await createMessagesRepository(sql).create({
      conversationId,
      clinicId,
      role: 'assistant',
      content: text,
      contentType: metadata['contentType'] === 'interactive' ? 'interactive' : 'text',
      metadata: { channel: 'whatsapp', source: 'workflow', deliveryState: 'attempted', ...metadata },
    })
    return message.id
  } catch (err) {
    console.error('[workflow] failed to persist outbound attempt:', err)
    return null
  }
}

async function markOutboundAccepted(
  sql: Sql,
  clinicId: string,
  messageId: string | null,
  wamid: string | null,
): Promise<void> {
  if (!messageId || !wamid) return
  try {
    await createMessagesRepository(sql).markDelivered(clinicId, messageId, wamid)
  } catch (err) {
    console.error('[workflow] failed to mark outbound provider acceptance:', err)
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

type WorkflowSlot = { start: string; end: string }

interface AvailableWorkflowSlot extends WorkflowSlot {
  date: string
  displayLabel: string
  timezone: string
  doctorId: string
  serviceId: string
  bookingKey: string
}

interface InteractiveMenuOption {
  id: string
  title: string
  description?: string
  data?: Record<string, unknown>
}

function configField(node: { config?: Record<string, unknown> }, key: string, fallback: string): string {
  const configured = String(node.config?.[key] ?? '').trim()
  return configured || fallback
}

function contextString(ctx: WorkflowContext, field: string): string {
  return String(ctx[field] ?? '').trim()
}

function calendarTokens(value: unknown): { accessToken: string; refreshToken: string; calendarId: string; expiryDate?: number } | null {
  if (!isRecord(value)) return null
  const accessToken = value['accessToken']
  const refreshToken = value['refreshToken']
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  try {
    return {
      accessToken: decryptValue(accessToken),
      refreshToken: decryptValue(refreshToken),
      calendarId: typeof value['calendarId'] === 'string' ? value['calendarId'] : 'primary',
      ...(typeof value['expiryDate'] === 'number' ? { expiryDate: value['expiryDate'] } : {}),
    }
  } catch {
    return null
  }
}

function doctorCalendarTokens(doctor: Doctor): { accessToken: string; refreshToken: string; calendarId: string } | null {
  if (!doctor.googleCalendarAccessTokenEncrypted || !doctor.googleCalendarRefreshTokenEncrypted) return null
  try {
    return {
      accessToken: decryptValue(doctor.googleCalendarAccessTokenEncrypted),
      refreshToken: decryptValue(doctor.googleCalendarRefreshTokenEncrypted),
      calendarId: doctor.googleCalendarId ?? 'primary',
    }
  } catch {
    return null
  }
}

async function workflowCalendar(
  sql: Sql,
  clinic: Clinic,
  doctorId?: string,
): Promise<CalendarOps | null> {
  const doctors = createDoctorsRepository(sql)
  const doctor = doctorId ? await doctors.findById(clinic.id, doctorId) : null
  const doctorTokens = doctor ? doctorCalendarTokens(doctor) : null
  const googleCalendarSettings = isRecord(clinic.settings['googleCalendar']) ? clinic.settings['googleCalendar'] : {}
  const clinicTokens = calendarTokens(googleCalendarSettings)
  const schedulingSource = String(
    googleCalendarSettings['schedulingSource'] ?? clinic.settings['schedulingSource'] ?? '',
  ).trim().toLowerCase()
  const useClinicCalendar = schedulingSource === 'clinic' || schedulingSource === 'clinic_calendar'
  const tokens = useClinicCalendar ? clinicTokens : doctorTokens ?? clinicTokens
  if (!tokens) return null
  const usingDoctorTokens = Boolean(!useClinicCalendar && doctor && doctorTokens)

  const persistTokens = async (refreshed: RefreshedTokens) => {
    if (doctor && usingDoctorTokens) {
      await doctors.update(clinic.id, doctor.id, {
        googleCalendarAccessTokenEncrypted: encryptValue(refreshed.accessToken),
        ...(refreshed.refreshToken
          ? { googleCalendarRefreshTokenEncrypted: encryptValue(refreshed.refreshToken) }
          : {}),
      })
      return
    }
    const latest = await createClinicsRepository(sql).findById(clinic.id)
    const existing = latest && isRecord(latest.settings['googleCalendar'])
      ? latest.settings['googleCalendar']
      : {}
    if (!latest) return
    await createClinicsRepository(sql).update(clinic.id, {
      settings: {
        ...latest.settings,
        googleCalendar: {
          ...existing,
          ...(useClinicCalendar ? { schedulingSource } : {}),
          accessToken: encryptValue(refreshed.accessToken),
          ...(refreshed.refreshToken ? { refreshToken: encryptValue(refreshed.refreshToken) } : {}),
          ...(typeof refreshed.expiryDate === 'number' ? { expiryDate: refreshed.expiryDate } : {}),
        },
      },
    })
  }

  return createGoogleCalendarOps({
    ...tokens,
    timezone: clinic.timezone,
    onTokensRefreshed: persistTokens,
  })
}

async function resolveWorkflowDoctorId(sql: Sql, clinicId: string, value: string): Promise<string | undefined> {
  const raw = value.trim()
  if (!raw) return undefined
  const doctors = createDoctorsRepository(sql)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    return (await doctors.findById(clinicId, raw))?.id
  }
  const normalized = raw.toLowerCase().replace(/^(dr\.?|doctor|doctora)\s+/, '').trim()
  const matches = (await doctors.listByClinic(clinicId)).filter((doctor) => {
    const name = doctor.name.toLowerCase().replace(/^(dr\.?|doctor|doctora)\s+/, '').trim()
    return name === normalized
  })
  return matches.length === 1 ? matches[0]?.id : undefined
}

function dateRange(start: string, days: number): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return []
  const first = new Date(`${start}T00:00:00Z`)
  if (Number.isNaN(first.getTime()) || first.toISOString().slice(0, 10) !== start) return []
  return Array.from({ length: Math.min(Math.max(days, 1), 14) }, (_, index) => {
    const date = new Date(first)
    date.setUTCDate(date.getUTCDate() + index)
    return date.toISOString().slice(0, 10)
  })
}

function slotTime(slot: WorkflowSlot): string {
  return slot.start.slice(11, 16)
}

function slotDate(slot: WorkflowSlot): string {
  return slot.start.slice(0, 10)
}

function addMinutes(localStart: string, minutes: number): string {
  const value = new Date(`${localStart}Z`)
  value.setUTCMinutes(value.getUTCMinutes() + minutes)
  return value.toISOString().slice(0, 19)
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), min), max)
}

function slotsCoverRange(slots: WorkflowSlot[], start: string, end: string): boolean {
  let cursor = start
  for (const slot of [...slots].sort((a, b) => a.start.localeCompare(b.start))) {
    if (slot.start !== cursor) continue
    cursor = slot.end
    if (cursor >= end) return true
  }
  return false
}

function clinicDateTimeParts(timezone: string, now = new Date()): { date: string; time: string; dateTime: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
  const date = `${value('year')}-${value('month')}-${value('day')}`
  const time = `${value('hour')}:${value('minute')}:${value('second')}`
  return { date, time, dateTime: `${date}T${time}` }
}

function formatClinicSlotLabel(slot: WorkflowSlot, timezone: string): string {
  const date = slotDate(slot)
  const time = slotTime(slot)
  return `${date} ${time} ${timezone}`
}

function workflowBookingKey(input: { doctorId: string; serviceId: string; start: string; end: string; timezone: string }): string {
  return Buffer.from(JSON.stringify(input)).toString('base64url')
}

function selectedDataMap(ctx: WorkflowContext): Record<string, Record<string, unknown>> {
  const value = ctx['workflowSelectionMap']
  return isRecord(value) ? value as Record<string, Record<string, unknown>> : {}
}

function setSelectionData(ctx: WorkflowContext, id: string, data: Record<string, unknown>): void {
  ctx['workflowSelectionMap'] = { ...selectedDataMap(ctx), [id]: data }
}

function optionFromSlot(slot: AvailableWorkflowSlot): InteractiveMenuOption {
  return {
    id: slot.bookingKey,
    title: slotTime(slot),
    description: slot.displayLabel.slice(0, 72),
    data: {
      selected_date: slot.date,
      selected_time: slotTime(slot),
      selected_slot_start: slot.start,
      selected_slot_end: slot.end,
      selected_booking_key: slot.bookingKey,
      doctor_id: slot.doctorId,
      service_id: slot.serviceId,
      timezone: slot.timezone,
    },
  }
}

function compactTitle(value: string, fallback: string): string {
  const title = value.trim() || fallback
  return title.length <= 24 ? title : title.slice(0, 23).trimEnd() || fallback
}

function parseMenuOptions(raw: unknown): InteractiveMenuOption[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry, index) => {
    if (!isRecord(entry)) return []
    const id = typeof entry['id'] === 'string' ? entry['id'] : `opt_${index}`
    const title = typeof entry['title'] === 'string' ? entry['title'] : typeof entry['label'] === 'string' ? entry['label'] : ''
    if (!title.trim()) return []
    const description = typeof entry['description'] === 'string' ? entry['description'] : undefined
    const data = isRecord(entry['data']) ? entry['data'] as Record<string, unknown> : entry
    return [{ id, title, ...(description ? { description } : {}), data }]
  })
}

function optionGroupsByDate(slots: AvailableWorkflowSlot[]): InteractiveMenuOption[] {
  const dates = new Map<string, number>()
  for (const slot of slots) dates.set(slot.date, (dates.get(slot.date) ?? 0) + 1)
  return [...dates.entries()].map(([date, count]) => ({
    id: `date_${date}`,
    title: date,
    description: `${count} available time${count === 1 ? '' : 's'}`,
    data: { selected_date: date },
  }))
}

async function persistSelectionMap(sql: Sql, clinicId: string, conversationId: string | undefined, options: InteractiveMenuOption[]): Promise<void> {
  if (!conversationId) return
  const conversations = createConversationsRepository(sql)
  const conv = await conversations.findById(clinicId, conversationId)
  if (!conv) return
  const existing = isRecord(conv.metadata['workflowSelectionMap']) ? conv.metadata['workflowSelectionMap'] : {}
  const next = options.reduce<Record<string, unknown>>((acc, option) => {
    acc[option.id] = option.data ?? { id: option.id, title: option.title }
    return acc
  }, { ...existing })
  await conversations.update(clinicId, conversationId, {
    metadata: { ...conv.metadata, workflowSelectionMap: next },
  })
}

function captureState(ctx: WorkflowContext): WorkflowCaptureState | null {
  const value = ctx[WORKFLOW_CAPTURE_CONTEXT_KEY]
  if (!isRecord(value)) return null
  if (
    typeof value['nodeId'] !== 'string' ||
    typeof value['field'] !== 'string' ||
    typeof value['status'] !== 'string'
  ) return null
  return value as unknown as WorkflowCaptureState
}

function validCapturedReply(validation: string, raw: string): boolean {
  const value = raw.trim()
  if (!value) return false
  switch (validation) {
    case 'date': {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
      const parsed = new Date(`${value}T00:00:00Z`)
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    }
    case 'time': {
      const match = value.match(/^(\d{1,2}):(\d{2})$/)
      return Boolean(match && Number(match[1]) <= 23 && Number(match[2]) <= 59)
    }
    case 'phone':
      return /^\+?[1-9]\d{7,14}$/.test(value.replace(/[\s().-]/g, ''))
    case 'yes_no':
      return /^(yes|no|y|n|si|sí|confirm|cancel|confirmo|cancelar)$/i.test(value)
    case 'required':
    default:
      return value.length > 0
  }
}

function workflowExecutionKey(data: WorkflowRunJobData, nodeId: string): string {
  // The database unique constraint is the authority. This human-readable key is
  // retained in trace records to connect source event, queue job, run and node.
  return `${data.workflowId}/${data.trigger.sourceEventId}/${nodeId}`
}

function providerIdFromResult(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value
  if (isRecord(value) && typeof value['providerId'] === 'string') return value['providerId']
  return null
}

class WorkflowEffectReconciliationRequired extends Error {
  constructor(readonly executionKey: string) {
    super(`Workflow effect ${executionKey} has an uncertain prior provider outcome; manual reconciliation is required before retry.`)
  }
}

function buildExecutors(sql: Sql, data: WorkflowRunJobData, workflowRunId: string): WorkflowExecutors {
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

  const sendWorkflowMessage = async (text: string, ctx: WorkflowContext): Promise<string | null> => {
    if (!text.trim()) return null
    const target = await resolveTarget(sql, clinicId, ctx.patientId)
    if (!target) {
      console.log(`[workflow] no sendable WhatsApp target for clinic ${clinicId}; skipping send`)
      return null
    }
    const messageId = await persistOutboundAttempt(sql, clinicId, ctx.conversationId, text)
    const wamid = await target.send(text)
    if (messageId) await markOutboundAccepted(sql, clinicId, messageId, wamid)
    else await persistOutbound(sql, clinicId, ctx.conversationId, text, wamid)
    return wamid
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

  const extractBookingDetails = async (
    node: import('@docmee/db').WorkflowNode,
    ctx: WorkflowContext,
  ): Promise<void> => {
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
    ctx['booking_confidence'] = extraction.confidence === 'high' ? 0.9 : extraction.confidence === 'medium' ? 0.65 : 0.25
    ctx['voice_booking_source'] = extraction.source
    for (const [key, value] of Object.entries(extraction.extracted)) ctx[key] = value
    await persistVoiceBookingIntake(ctx, extraction)
    await persistVoiceBookingReview(ctx, extraction)
    const reviewTag = String(node.config?.['reviewTag'] ?? node.config?.['review_tag'] ?? '').trim()
    if (reviewTag && extraction.needsReview) await addConversationTag(reviewTag, ctx)
  }

  const buildAvailableSlots = async (node: { config?: Record<string, unknown> }, ctx: WorkflowContext): Promise<AvailableWorkflowSlot[]> => {
    const clinic = await createClinicsRepository(sql).findById(clinicId)
    if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
    const timezone = contextString(ctx, configField(node, 'timezoneField', 'clinic_timezone')) || clinic.timezone || 'UTC'
    const doctorValue = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
    const doctorId = await resolveWorkflowDoctorId(sql, clinicId, doctorValue)
    if (!doctorId) throw new Error('A selected doctor is required to calculate availability')
    const serviceId = contextString(ctx, configField(node, 'serviceIdField', 'service_id'))
    const services = await createDoctorServicesRepository(sql).listServicesForDoctor(clinicId, doctorId)
    const service = services.find((item) => item.id === serviceId)
    if (!service) throw new Error('The selected service is not enabled for this doctor')
    const duration = boundedInteger(service.durationMinutes, 30, 5, 480)
    const today = clinicDateTimeParts(timezone).date
    const nowLocal = clinicDateTimeParts(timezone).dateTime
    const dates = dateRange(today, boundedInteger(node.config?.['days'], 5, 1, 14))
    const calendar = await workflowCalendar(sql, clinic, doctorId)
    if (!calendar) throw new Error('Google Calendar is not connected for this doctor or clinic')
    const slots = (await Promise.all(dates.map((date) => calendar.listSlots(date)))).flat()
    return slots
      .filter((slot): slot is WorkflowSlot => isRecord(slot) && typeof slot['start'] === 'string' && typeof slot['end'] === 'string')
      .filter((slot) => slot.start >= nowLocal)
      .filter((slot) => (Date.parse(`${slot.end}Z`) - Date.parse(`${slot.start}Z`)) / 60_000 >= duration)
      .map((slot) => {
        const base = { doctorId, serviceId, start: slot.start, end: slot.end, timezone }
        return {
          ...slot,
          date: slotDate(slot),
          displayLabel: formatClinicSlotLabel(slot, timezone),
          timezone,
          doctorId,
          serviceId,
          bookingKey: workflowBookingKey(base),
        }
      })
  }

  const buildInteractiveOptions = async (node: { config?: Record<string, unknown> }, ctx: WorkflowContext): Promise<InteractiveMenuOption[]> => {
    const explicit = parseMenuOptions(ctx[configField(node, 'optionsField', 'menu_options')])
    if (explicit.length > 0) return explicit
    const menuType = String(node.config?.['menuType'] ?? '').trim()
    if (menuType === 'doctor') {
      return (await createDoctorsRepository(sql).listByClinic(clinicId)).map((doctor) => ({
        id: `doctor_${doctor.id}`,
        title: compactTitle(doctor.name, 'Doctor'),
        ...(doctor.specialty ? { description: doctor.specialty.slice(0, 72) } : {}),
        data: { doctor_id: doctor.id, selected_doctor_id: doctor.id, selected_doctor_name: doctor.name },
      }))
    }
    if (menuType === 'service') {
      const doctorId = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
      if (!doctorId) return []
      return (await createDoctorServicesRepository(sql).listServicesForDoctor(clinicId, doctorId)).map((service) => ({
        id: `service_${service.id}`,
        title: compactTitle(service.name, 'Service'),
        description: `${service.durationMinutes} min`,
        data: { service_id: service.id, selected_service_id: service.id, selected_service_name: service.name },
      }))
    }
    const slots = Array.isArray(ctx[configField(node, 'slotsField', 'available_slots')])
      ? (ctx[configField(node, 'slotsField', 'available_slots')] as unknown[]).filter((slot): slot is AvailableWorkflowSlot =>
          isRecord(slot) &&
          typeof slot['bookingKey'] === 'string' &&
          typeof slot['date'] === 'string' &&
          typeof slot['start'] === 'string' &&
          typeof slot['end'] === 'string' &&
          typeof slot['timezone'] === 'string' &&
          typeof slot['doctorId'] === 'string' &&
          typeof slot['serviceId'] === 'string',
        )
      : []
    if (menuType === 'date') return optionGroupsByDate(slots)
    if (menuType === 'time_slot') {
      const selectedDate = contextString(ctx, configField(node, 'dateField', 'selected_date'))
      return slots.filter((slot) => !selectedDate || slot.date === selectedDate).map(optionFromSlot)
    }
    if (menuType === 'confirm') {
      return [
        { id: 'confirm_booking', title: 'Confirm', data: { booking_confirmation: 'yes' } },
        { id: 'change_selection', title: 'Change', data: { booking_confirmation: 'change' } },
        { id: 'human_handoff', title: 'Talk to person', data: { booking_confirmation: 'handoff', route: 'human_handoff' } },
      ]
    }
    return []
  }

  const applyInteractiveReply = async (ctx: WorkflowContext): Promise<boolean> => {
    const numericReply = contextString(ctx, 'message').match(/^\s*(\d{1,2})\s*$/)
    const fallbackIds = Array.isArray(ctx['menuOptionIds']) ? ctx['menuOptionIds'].filter((id): id is string => typeof id === 'string') : []
    const replyId = contextString(ctx, 'interactiveReplyId') || (numericReply ? fallbackIds[Number(numericReply[1]) - 1] ?? '' : '')
    if (!replyId) return false
    let dataMap = selectedDataMap(ctx)
    if (!dataMap[replyId] && ctx.conversationId) {
      const conv = await createConversationsRepository(sql).findById(clinicId, ctx.conversationId)
      const stored = conv && isRecord(conv.metadata['workflowSelectionMap']) ? conv.metadata['workflowSelectionMap'] : {}
      dataMap = { ...(stored as Record<string, Record<string, unknown>>), ...dataMap }
    }
    const data = dataMap[replyId]
    if (!isRecord(data)) return false
    for (const [key, value] of Object.entries(data)) ctx[key] = value
    ctx['workflow_selection_id'] = replyId
    ctx['menu_status'] = 'selected'
    ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { nodeId: 'interactive_menu', field: 'workflow_selection_id', question: '', retryQuestion: '', validation: 'required', attempts: 0, maxAttempts: 1, status: 'captured' } satisfies WorkflowCaptureState
    return true
  }

  return {
    async runSideEffect(node, _ctx, invoke) {
      const executions = createWorkflowExecutionsRepository(sql)
      const executionKey = workflowExecutionKey(data, node.id)
      const claimed = await executions.claimEffect({
        workflowRunId,
        nodeId: node.id,
        nodeType: node.type,
        executionKey,
      })
      if (!claimed) {
        const existing = await executions.findEffect(executionKey)
        if (existing?.status === 'succeeded') return undefined as Awaited<ReturnType<typeof invoke>>
        if (existing?.status === 'in_progress' || existing?.status === 'uncertain') {
          if (existing.status === 'in_progress') {
            await executions.markEffectUncertain(existing.id, 'Worker retried after an interrupted side effect; provider outcome is unknown.')
          }
          throw new WorkflowEffectReconciliationRequired(executionKey)
        }
        // A prior failure may have occurred before reaching a provider. We do
        // not automatically replay it: no provider idempotency contract exists.
        throw new WorkflowEffectReconciliationRequired(executionKey)
      }
      try {
        const result = await invoke()
        await executions.succeedEffect(claimed.id, providerIdFromResult(result))
        return result
      } catch (error) {
        // A throw from a provider is not proof that it did not perform the
        // action. Preserve an uncertain terminal state and never auto-replay.
        await executions.markEffectUncertain(claimed.id, error instanceof Error ? error.message : String(error))
        throw error
      }
    },
    async sendMessage(text, ctx) {
      await sendWorkflowMessage(text, ctx)
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
      const messageId = await persistOutboundAttempt(sql, clinicId, ctx.conversationId, template.body)
      const wamid = await target.send(template.body)
      if (messageId) await markOutboundAccepted(sql, clinicId, messageId, wamid)
      else await persistOutbound(sql, clinicId, ctx.conversationId, template.body, wamid)
    },

    async notifySecretary(ctx) {
      await notify('A workflow flagged this conversation for attention.', ctx)
    },

    async addTag(tag, ctx) {
      await addConversationTag(tag, ctx)
    },

    async aiDraft(prompt, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      const ai = (clinic.settings as { aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string } }).aiAssistant ?? {}
      const provider: ChatProvider = ai.chatProvider === 'openai' || ai.chatProvider === 'custom' || ai.chatProvider === 'gemini' ? ai.chatProvider : 'claude'
      const content = await chatComplete({ provider, model: ai.model?.trim() || defaultChatModel(provider), baseURL: ai.baseURL?.trim() || undefined, apiKey: resolveClinicAiKey(clinic.settings, provider), history: [], maxTokens: 500,
        system: 'Write a staff-reviewable patient reply draft. Ground it only in the explicit workflow instruction and patient context. Never diagnose, prescribe, or claim unknown clinic facts. This is a draft only and must never be sent automatically.',
        message: `Workflow instruction: ${prompt || '(none)'}\nPatient context: ${String(ctx.message ?? ctx.transcript ?? '(none)')}` })
      await createWorkflowApprovalsRepository(sql).createDraft({ clinicId, workflowId: data.workflowId, nodeId: 'action.ai_draft', runKey: `${workflowRunId}:ai_draft:${prompt}`, conversationId: ctx.conversationId, patientId: ctx.patientId, prompt, content: content.trim() })
      await notify('A workflow generated an AI draft for staff review. It was not sent.', ctx)
    },

    async requestApproval(node, resumeNodeId, ctx) {
      const expiryMinutes = boundedInteger(node.config?.['expiresMinutes'], 1_440, 5, 43_200)
      const approval = await createWorkflowApprovalsRepository(sql).createPending({ clinicId, workflowId: data.workflowId, nodeId: node.id, runKey: workflowRunId, conversationId: ctx.conversationId, patientId: ctx.patientId, resumeNodeId, context: { ...ctx }, expiresAt: new Date(Date.now() + expiryMinutes * 60_000).toISOString() })
      if (approval.status === 'pending') await notify('A workflow step requires your approval before continuing.', ctx)
    },

    async transcribeBookingVoice(node, ctx) {
      await extractBookingDetails(node, ctx)
    },

    async extractBookingDetails(node, ctx) {
      await extractBookingDetails(node, ctx)
    },

    async classifyIntentConfidence(node, ctx) {
      const field = configField(node, 'confidenceField', 'booking_confidence')
      if (ctx[field] === undefined && contextString(ctx, 'message')) await extractBookingDetails(node, ctx)
      const raw = ctx[field] ?? ctx['voice_booking_confidence']
      const score = typeof raw === 'number'
        ? raw
        : raw === 'high'
          ? 0.9
          : raw === 'medium'
            ? 0.65
            : raw === 'low'
              ? 0.25
              : Number.NaN
      const highThreshold = Math.min(Math.max(Number(node.config?.['highThreshold'] ?? 0.8), 0), 1)
      const lowThreshold = Math.min(Math.max(Number(node.config?.['lowThreshold'] ?? 0.5), 0), highThreshold)
      const route = !Number.isFinite(score) ? 'error' : score >= highThreshold ? 'high' : 'low'
      ctx['classification_confidence'] = Number.isFinite(score) ? score : null
      ctx['confidence_route'] = route
      if (Number.isFinite(score) && score < lowThreshold) ctx['needs_clarification'] = true
      return route
    },

    async askAndCapture(node, ctx) {
      const existing = captureState(ctx)
      const field = configField(node, 'field', 'answer')
      if (existing?.nodeId === node.id && existing.status === 'pending') {
        const reply = contextString(ctx, 'message')
        if (validCapturedReply(existing.validation, reply)) {
          ctx[existing.field] = existing.validation === 'phone' ? reply.replace(/[\s().-]/g, '') : reply
          ctx['capture_status'] = 'captured'
          ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { ...existing, status: 'captured' }
          return
        }
        const attempts = existing.attempts + 1
        if (attempts >= existing.maxAttempts) {
          ctx['capture_status'] = 'error'
          ctx['capture_error'] = `invalid_${existing.validation}`
          ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { ...existing, attempts, status: 'error' }
          await notify(`Workflow could not capture a valid ${existing.field} after ${attempts} attempts.`, ctx)
          return
        }
        ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = { ...existing, attempts }
        await sendWorkflowMessage(existing.retryQuestion, ctx)
        return
      }

      const currentValue = contextString(ctx, field)
      const validation = String(node.config?.['validation'] ?? 'required')
      if (currentValue && validCapturedReply(validation, currentValue)) {
        ctx['capture_status'] = 'captured'
        ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = {
          nodeId: node.id,
          field,
          question: '',
          retryQuestion: '',
          validation,
          attempts: 0,
          maxAttempts: 1,
          status: 'captured',
        } satisfies WorkflowCaptureState
        return
      }
      if (currentValue) delete ctx[field]
      const question = String(node.config?.['question'] ?? `Please provide ${field.replaceAll('_', ' ')}.`).trim()
      const retryQuestion = String(node.config?.['retryQuestion'] ?? `I couldn't validate that. ${question}`).trim()
      const pending: WorkflowCaptureState = {
        nodeId: node.id,
        field,
        question,
        retryQuestion,
        validation,
        attempts: 0,
        maxAttempts: boundedInteger(node.config?.['maxAttempts'], 3, 1, 10),
        status: 'pending',
      }
      ctx['capture_status'] = 'pending'
      ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = pending
      await sendWorkflowMessage(question, ctx)
    },

    async waitForReply(node, _nextNodeId, ctx) {
      const capture = captureState(ctx)
      if (!capture || capture.status !== 'pending') {
        if (capture) delete ctx[WORKFLOW_CAPTURE_CONTEXT_KEY]
        return false
      }
      if (!ctx.conversationId) {
        ctx['capture_status'] = 'error'
        ctx['capture_error'] = 'conversation_required'
        await notify('Workflow cannot wait for a reply because no conversation is attached.', ctx)
        return false
      }
      const conversations = createConversationsRepository(sql)
      const conversation = await conversations.findById(clinicId, ctx.conversationId)
      if (!conversation) return false
      const timeoutMinutes = boundedInteger(node.config?.['timeoutMinutes'], 1_440, 5, 43_200)
      const metadata = writePendingWorkflowRun(conversation.metadata, {
        workflowId: data.workflowId,
        sourceEventId: data.trigger.sourceEventId,
        resumeNodeId: capture.nodeId,
        context: { ...ctx },
        expiresAt: new Date(Date.now() + timeoutMinutes * 60_000).toISOString(),
      })
      await conversations.update(clinicId, ctx.conversationId, { metadata })
      if (ctx.patientId) {
        await scheduleNoResponseFollowUp({
          clinicId,
          patientId: ctx.patientId,
          conversationId: ctx.conversationId,
          silentSinceIso: new Date().toISOString(),
          recoveryPrompt: capture.retryQuestion || capture.question,
        })
      }
      return true
    },

    async checkAvailability(node, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      const doctorValue = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
      const doctorId = await resolveWorkflowDoctorId(sql, clinicId, doctorValue)
      const dateField = configField(node, 'dateField', 'preferred_date')
      const dates = dateRange(contextString(ctx, dateField), boundedInteger(node.config?.['days'], 1, 1, 14))
      if (dates.length === 0) throw new Error(`Workflow availability date is invalid or missing in ${dateField}`)
      const calendar = await workflowCalendar(sql, clinic, doctorId)
      if (!calendar) throw new Error('Google Calendar is not connected for this doctor or clinic')
      const slots = (await Promise.all(dates.map((date) => calendar.listSlots(date)))).flat()
      ctx[configField(node, 'slotsField', 'available_slots')] = slots
      ctx['availability_count'] = slots.length
    },

    async availableSlots(node, ctx) {
      const slots = await buildAvailableSlots(node, ctx)
      const slotsField = configField(node, 'slotsField', 'available_slots')
      ctx[slotsField] = slots
      ctx['availability_count'] = slots.length
      ctx['availability_status'] = slots.length > 0 ? 'available' : 'none'
      for (const slot of slots) setSelectionData(ctx, slot.bookingKey, optionFromSlot(slot).data ?? {})
      if (slots.length === 0) {
        ctx['menu_options'] = [
          { id: 'refresh_date_range', title: 'Refresh dates', data: { route: 'refresh_slots' } },
          { id: 'human_handoff', title: 'Talk to person', data: { route: 'human_handoff' } },
        ]
      }
    },

    async offerSlots(node, ctx) {
      const slotsField = configField(node, 'slotsField', 'available_slots')
      const raw = ctx[slotsField]
      const slots = Array.isArray(raw)
        ? raw.filter((slot): slot is WorkflowSlot => isRecord(slot) && typeof slot['start'] === 'string' && typeof slot['end'] === 'string')
        : []
      const count = boundedInteger(node.config?.['count'], 3, 1, 10)
      const chosen = slots.slice(0, count)
      ctx['offered_slots'] = chosen
      const prefix = String(node.config?.['message'] ?? 'Available appointment times:').trim()
      const text = chosen.length
        ? `${prefix}\n${chosen.map((slot, index) => `${index + 1}. ${slotDate(slot)} ${slotTime(slot)}`).join('\n')}`
        : 'No appointment times are available in that date range.'
      await sendWorkflowMessage(text, ctx)
    },

    async interactiveMenu(node, ctx) {
      if (await applyInteractiveReply(ctx)) return
      const options = await buildInteractiveOptions(node, ctx)
      const menuType = String(node.config?.['menuType'] ?? 'list').trim()
      const title = String(node.config?.['title'] ?? '').trim()
      const body = String(node.config?.['body'] ?? title ?? '').trim()
      if (!body) throw new Error('Interactive Menu requires a non-empty body')
      if (!ctx.conversationId) throw new Error('Interactive Menu requires a conversation ID')
      const selectionField = configField(node, 'selectionField', 'workflow_selection_id')
      if (options.length === 0) {
        ctx['menu_status'] = 'empty'
        await sendWorkflowMessage(String(node.config?.['emptyMessage'] ?? 'No options are available right now. I can refresh the range or connect you with the clinic team.'), ctx)
        return
      }

      const target = await resolveTarget(sql, clinicId, ctx.patientId)
      if (!target) {
        console.log(`[workflow] no sendable WhatsApp target for clinic ${clinicId}; skipping interactive menu`)
        return
      }
      const accessToken = readMetaToken(target.account.accessTokenEnc)
      if (!accessToken) throw new Error('WhatsApp access token is unavailable for interactive menu')
      await persistSelectionMap(sql, clinicId, ctx.conversationId, options)
      for (const option of options) if (option.data) setSelectionData(ctx, option.id, option.data)

      const messageId = await persistOutboundAttempt(sql, clinicId, ctx.conversationId, body, {
        contentType: 'interactive',
        menuType,
        optionIds: options.map((option) => option.id),
      })
      try {
        let wamid: string | null
        if (menuType === 'confirm' && options.length <= 3) {
          const buttons: WhatsAppReplyButton[] = options.map((option) => ({ id: option.id, title: option.title.slice(0, 20) }))
          wamid = await sendWhatsAppInteractive(target.account.accountId, accessToken, target.handle, body, buttons)
        } else if (options.length <= 10) {
          const rows = options.map((option) => ({
            id: option.id,
            title: compactTitle(option.title, 'Option'),
            ...(option.description ? { description: option.description.slice(0, 72) } : {}),
          }))
          const sections: WhatsAppListSection[] = [{ ...(title ? { title: title.slice(0, 24) } : {}), rows }]
          wamid = await sendWhatsAppList(target.account.accountId, accessToken, target.handle, body, String(node.config?.['buttonLabel'] ?? 'Choose').slice(0, 20), sections)
        } else {
          throw new Error('interactive_limit_exceeded')
        }
        await markOutboundAccepted(sql, clinicId, messageId, wamid)
        ctx['menu_status'] = 'sent'
        ctx[selectionField] = ''
        ctx['menuOptionIds'] = options.map((option) => option.id)
        ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = {
          nodeId: node.id,
          field: selectionField,
          question: body,
          retryQuestion: body,
          validation: 'required',
          attempts: 0,
          maxAttempts: 1,
          status: 'pending',
        } satisfies WorkflowCaptureState
      } catch (error) {
        const fallback = `${body}\n${options.map((option, index) => `${index + 1}. ${option.title}`).join('\n')}`
        await sendWorkflowMessage(fallback, ctx)
        ctx['menu_status'] = 'fallback_text'
        ctx['menu_error'] = error instanceof Error ? error.message : String(error)
        ctx['menuOptionIds'] = options.map((option) => option.id)
        ctx[WORKFLOW_CAPTURE_CONTEXT_KEY] = {
          nodeId: node.id,
          field: selectionField,
          question: fallback,
          retryQuestion: fallback,
          validation: 'required',
          attempts: 0,
          maxAttempts: 1,
          status: 'pending',
        } satisfies WorkflowCaptureState
      }
    },

    async revalidateSlot(node, ctx) {
      const slots = await buildAvailableSlots(node, ctx)
      const bookingKey = contextString(ctx, configField(node, 'bookingKeyField', 'selected_booking_key'))
      const selected = slots.find((slot) => slot.bookingKey === bookingKey)
      if (!selected) {
        ctx['slot_revalidation_status'] = 'unavailable'
        throw new Error('The selected appointment time is no longer available')
      }
      ctx['slot_revalidation_status'] = 'available'
      ctx['preferred_date'] = selected.date
      ctx['preferred_time'] = slotTime(selected)
      ctx['selected_slot_start'] = selected.start
      ctx['selected_slot_end'] = selected.end
    },

    async createOrRescheduleBooking(node, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      if (!ctx.patientId) throw new Error('A patient is required to create or reschedule a booking')

      const doctorValue = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
      const doctorId = await resolveWorkflowDoctorId(sql, clinicId, doctorValue)
      const serviceId = contextString(ctx, configField(node, 'serviceIdField', 'service_id'))
      const date = contextString(ctx, configField(node, 'dateField', 'preferred_date'))
      const time = contextString(ctx, configField(node, 'timeField', 'preferred_time')).slice(0, 5)
      const hour = Number(time.slice(0, 2))
      const minute = Number(time.slice(3, 5))
      if (
        dateRange(date, 1).length === 0 ||
        !/^\d{2}:\d{2}$/.test(time) ||
        hour > 23 ||
        minute > 59
      ) {
        throw new Error('Booking date or time is missing or invalid')
      }

      const appointments = createAppointmentsRepository(sql)
      const services = await appointments.listServices(clinicId)
      const service = serviceId ? services.find((item) => item.id === serviceId) : undefined
      const duration = boundedInteger(node.config?.['durationMinutes'] ?? service?.durationMinutes, 30, 5, 480)
      const calendar = await workflowCalendar(sql, clinic, doctorId || undefined)
      if (!calendar) throw new Error('Google Calendar is not connected for this doctor or clinic')
      const title = String(node.config?.['title'] ?? `Appointment: ${contextString(ctx, 'patient_name') || 'Patient'}`)
      const startTime = `${date}T${time}:00`
      const endTime = addMinutes(startTime, duration)
      const availableSlots = await calendar.listSlots(date)
      if (!slotsCoverRange(availableSlots, startTime, endTime)) {
        throw new Error('The selected appointment time is no longer available for the required duration')
      }
      const mode = String(node.config?.['mode'] ?? 'create')

      if (mode === 'reschedule') {
        const appointmentId = contextString(ctx, configField(node, 'appointmentIdField', 'appointment_id'))
        if (!appointmentId) throw new Error('An appointment ID is required to reschedule a booking')
        const appointment = await appointments.findById(clinicId, appointmentId)
        if (!appointment) throw new Error(`Appointment not found: ${appointmentId}`)
        if (appointment.googleEventId) {
          await calendar.updateEvent({ eventId: appointment.googleEventId, title, date, time, durationMinutes: duration })
        }
        await appointments.update(clinicId, appointmentId, { startTime, endTime, status: 'confirmed' })
        await appointments.addEvent(clinicId, appointmentId, 'rescheduled')
        ctx['appointment_id'] = appointmentId
        ctx['booking_status'] = 'rescheduled'
        return
      }

      if (!doctorId) throw new Error('A unique active doctor is required to create a booking')
      const googleEventId = await calendar.createEvent({ title, date, time, durationMinutes: duration })
      let created: import('@docmee/db').Appointment
      try {
        created = await appointments.create({
          clinicId,
          patientId: ctx.patientId,
          doctorId,
          ...(serviceId ? { serviceId } : {}),
          ...(ctx.conversationId ? { conversationId: ctx.conversationId } : {}),
          startTime,
          endTime,
          metadata: { source: 'workflow', preferredDate: date, preferredTime: time },
        })
        await appointments.update(clinicId, created.id, { status: 'confirmed', googleEventId })
      } catch (error) {
        await calendar.deleteEvent(googleEventId).catch((cleanupError) => {
          console.error('[workflow] failed to roll back Google Calendar event after appointment persistence failed', cleanupError)
        })
        throw error
      }
      ctx['appointment_id'] = created.id
      ctx['google_event_id'] = googleEventId
      ctx['booking_status'] = 'created'
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
  const executions = createWorkflowExecutionsRepository(sql)
  let workflowRunId: string | null = null
  try {
    const workflow = await createWorkflowsRepository(sql).findById(data.clinicId, data.workflowId)
    if (!workflow || workflow.status !== 'active') {
      console.log(`[workflow] ${data.workflowId} not active; skipping run`)
      return
    }
    const graphErrors = validateWorkflowDefinition(workflow.nodes, workflow.edges, { requireTrigger: true })
    if (graphErrors.length > 0) {
      console.error(`[workflow] ${data.workflowId} has an invalid persisted graph: ${graphErrors.join('; ')}`)
      return
    }
    const sourceEventId = data.trigger.sourceEventId
    const run = data.startNodeId
      ? await executions.findRun(data.clinicId, data.workflowId, sourceEventId)
      : await executions.claimRun({
        clinicId: data.clinicId,
        workflowId: data.workflowId,
        sourceEventId,
        queueJobId: String(job.id ?? ''),
      })
    if (!run) {
      console.log(`[workflow] duplicate or terminal run ${data.workflowId}/${sourceEventId}; skipping`)
      return
    }
    workflowRunId = run.id
    await executions.setRunStatus(run.id, 'running', {
      sourceEventId,
      queueJobId: String(job.id ?? ''),
      startNodeId: data.startNodeId ?? null,
    })
    const approvals = createWorkflowApprovalsRepository(sql)
    if (data.approvalId && !(await approvals.claimResume(data.clinicId, data.approvalId))) return
    const ctx: WorkflowContext = { ...(data.context ?? {}), ...data.trigger }
    const exec = buildExecutors(sql, data, run.id)
    const trace = await runWorkflow(workflow, ctx, exec, data.startNodeId ? { startNodeId: data.startNodeId } : {})
    const terminal = trace[trace.length - 1]?.status === 'paused' ? 'paused' : 'completed'
    if (data.approvalId) await approvals.markResumed(data.clinicId, data.approvalId)
    await executions.setRunStatus(run.id, terminal, { trace, terminalState: terminal })
    console.log(`[workflow] ${workflow.name} ran ${trace.length} step(s) for clinic ${data.clinicId}`)
  } catch (error) {
    if (data.approvalId) await createWorkflowApprovalsRepository(sql).markFailed(data.clinicId, data.approvalId, error instanceof Error ? error.message : String(error)).catch(() => {})
    if (workflowRunId) {
      await executions.setRunStatus(workflowRunId, 'failed', {
        error: error instanceof Error ? error.message : String(error),
        terminalState: 'failed',
      }).catch((statusError) => console.error('[workflow] failed to record terminal state', statusError))
    }
    throw error
  } finally {
    await sql.end()
  }
}
