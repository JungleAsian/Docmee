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
  WORKFLOW_MENU_CONTEXT_KEY,
  WORKFLOW_SLOT_MENU_CONTEXT_KEY,
  SLOT_MENU_MORE_OPTION_ID,
  parseMenuOptions,
  resolveMenuHandle,
  parseAiAgentScenarios,
  isEmergencyMessage,
  screenMedicalSafety,
  medicalSafetyDeferral,
  screenPromptLeak,
  promptSafetyDeferral,
  injectionGuard,
  toneInstruction,
  detectLanguage,
  type BookingGrid,
  type CalendarOps,
  type GoogleCalendarConfig,
  type RefreshedTokens,
  type TimeSlot,
  type SlotMenuReplyOutcome,
  type AiAgentOutcome,
  type BotTone,
  type WorkflowCaptureState,
  type WorkflowContext,
  type WorkflowExecutors,
} from '@docmee/agents'
import { decryptValue, encryptValue } from '@docmee/shared'
import { randomUUID } from 'node:crypto'
import { chatComplete, defaultChatModel, type ChatProvider } from '@docmee/llm'
import { activeWhatsAppAccount, resolveWhatsAppInteractiveSender, resolveWhatsAppSender } from './meta-token.js'
import { extractVoiceBookingDetails } from './voice-booking.js'
import { resolveClinicAiKey } from './clinic-ai-key.js'
import { appendPatientHistoryEntry } from './voice-storage.js'
import { scheduleNoResponseFollowUp } from './follow-up.js'
import { pauseBotForHandoff } from './bot-handoff.js'
import { type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createPatientsRepository,
  createChannelAccountsRepository,
  createConversationsRepository,
  createDoctorsRepository,
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
  enqueueWorkflowRunByTarget,
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

export type WorkflowSlot = { start: string; end: string }

// Docmee branding for interactive workflow menus. WhatsApp only allows an
// image header on button-kind sends (list headers must stay text), so the
// logo appears there; every menu gets the branded text header, links, and a
// plain-text options listing baked into what's persisted for the Inbox.
const DOCMEE_LOGO_URL = 'https://app.docmeedevelopment.dev/icon-512.png'
const DOCMEE_LINKS_TEXT = [
  '🌐 Website: https://docmee.ai/',
  '❓ FAQ: https://docmee.ai/#faq',
  '💬 Contact Us: https://docmee.ai/#contact',
].join('\n')

function brandedMenuHeader(rawHeader: string): string {
  return rawHeader ? `Docmee | ${rawHeader}` : 'Docmee'
}

/** Numbered options listing shown under a menu's message — sent as part of
 *  the plain-text fallback (no interactive sender available) and always
 *  included in what's persisted to conversation_messages, so the Inbox shows
 *  exactly what the patient was offered even though a real interactive send
 *  carries the options as WhatsApp buttons/rows, not body text. */
function menuOptionsListText(options: { title: string; description?: string }[]): string {
  if (options.length === 0) return ''
  return [
    'Options:',
    ...options.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`),
  ].join('\n')
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

/**
 * Resolves which Google Calendar credentials a workflow should use (the
 * doctor's own, falling back to the clinic's shared one) without yet binding
 * a client — so a caller that needs several grids for the same doctor across
 * several dates (see doctorDayGrid) can build multiple CalendarOps from one
 * token resolution instead of re-fetching the doctor and re-authing per date.
 * Also returns the resolved `doctor` row so the caller can read availableDays.
 */
async function workflowCalendarConfig(
  sql: Sql,
  clinic: Clinic,
  doctorId?: string,
): Promise<{ doctor: Doctor | null; config: GoogleCalendarConfig } | null> {
  const doctors = createDoctorsRepository(sql)
  const doctor = doctorId ? await doctors.findById(clinic.id, doctorId) : null
  const doctorTokens = doctor ? doctorCalendarTokens(doctor) : null
  const clinicTokens = calendarTokens(clinic.settings['googleCalendar'])
  const tokens = doctorTokens ?? clinicTokens
  if (!tokens) return null

  const persistTokens = async (refreshed: RefreshedTokens) => {
    if (doctor && doctorTokens) {
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
          accessToken: encryptValue(refreshed.accessToken),
          ...(refreshed.refreshToken ? { refreshToken: encryptValue(refreshed.refreshToken) } : {}),
          ...(typeof refreshed.expiryDate === 'number' ? { expiryDate: refreshed.expiryDate } : {}),
        },
      },
    })
  }

  return { doctor, config: { ...tokens, timezone: clinic.timezone, onTokensRefreshed: persistTokens } }
}

async function workflowCalendar(
  sql: Sql,
  clinic: Clinic,
  doctorId?: string,
): Promise<CalendarOps | null> {
  const resolved = await workflowCalendarConfig(sql, clinic, doctorId)
  return resolved ? createGoogleCalendarOps(resolved.config) : null
}

// Sunday-first to match JS Date#getUTCDay().
const WEEKDAY_BY_INDEX = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * The doctor's configured working hours for a specific date, as a BookingGrid
 * — mirrors apps/api/src/lib/slots.ts's semantics (that module computes the
 * same thing for the panel's slot picker; this is a separate, worker-local
 * implementation since the two apps don't share a package for it today).
 * Multiple ranges in one day (e.g. a lunch-break split) collapse to their
 * outer span — BookingGrid only expresses one contiguous window — which is
 * exact for the common single-range case and a safe over-approximation
 * otherwise (a drag-to-book UI would still be needed to represent a true gap).
 *
 * Returns:
 * - `null` when the doctor has no availableDays configured at all, so the
 *   caller should fall back to the default 09:00–18:00 grid (today's only
 *   behavior) rather than treat every day as a day off.
 * - `'off'` when availableDays IS configured but has no ranges for this
 *   weekday — the doctor genuinely doesn't work this day; the caller should
 *   produce zero slots without even calling Google.
 * - a `BookingGrid` otherwise.
 */
export function doctorDayGrid(availableDays: unknown, date: string): BookingGrid | 'off' | null {
  if (!isRecord(availableDays) || Object.keys(availableDays).length === 0) return null
  const day = WEEKDAY_BY_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()]!
  const raw = availableDays[day]
  if (!Array.isArray(raw) || raw.length === 0) return 'off'
  let startMin = Infinity
  let endMin = -Infinity
  for (const entry of raw) {
    if (!isRecord(entry)) continue
    const start = entry['start']
    const end = entry['end']
    if (typeof start !== 'string' || typeof end !== 'string' || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue
    startMin = Math.min(startMin, Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)))
    endMin = Math.max(endMin, Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)))
  }
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) return 'off'
  // Round inward (start up, end down) so a partial-hour boundary never offers
  // time the doctor didn't actually make available.
  return { startHour: Math.ceil(startMin / 60), endHour: Math.floor(endMin / 60), slotMinutes: 30 }
}

/** listSlots for one date, honoring the doctor's real hours for that weekday
 *  when configured. Builds a fresh CalendarOps per distinct grid (cheap: at
 *  most one per requested date) rather than widening the shared CalendarOps
 *  interface with a per-call grid override. */
async function listSlotsForDate(
  config: GoogleCalendarConfig,
  availableDays: unknown,
  date: string,
): Promise<TimeSlot[]> {
  const grid = doctorDayGrid(availableDays, date)
  if (grid === 'off') return []
  return createGoogleCalendarOps(grid ? { ...config, grid } : config).listSlots(date)
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

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Current time as a naive `YYYY-MM-DDTHH:MM:SS` string in the same shape as
 *  WorkflowSlot's start/end (no trailing `Z`) — comparable to slot start
 *  times with a plain string comparison since same-shaped ISO strings sort
 *  chronologically. */
export function nowLocalIso(): string {
  return new Date().toISOString().slice(0, 19)
}

/** Drop slots that have already started — offering "9:00 AM today" at 2pm is
 *  not a bookable option regardless of what the doctor's grid allows. */
export function excludePastSlots(slots: WorkflowSlot[], now: string = nowLocalIso()): WorkflowSlot[] {
  return slots.filter((slot) => slot.start > now)
}

export function distinctSlotDates(slots: WorkflowSlot[]): string[] {
  return Array.from(new Set(slots.map(slotDate))).sort()
}

export function slotsOnDate(slots: WorkflowSlot[], date: string): WorkflowSlot[] {
  return slots.filter((slot) => slotDate(slot) === date).sort((a, b) => a.start.localeCompare(b.start))
}

export function formatDateLabel(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed)
}

export function formatTimeLabel(hhmm: string): string {
  const [hourStr, minuteStr] = hhmm.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return hhmm
  const period = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  return `${hour12}:${String(minute).padStart(2, '0')} ${period}`
}

/** One page of a slot menu's dynamic options — distinct dates in `mode:
 *  'date'`, or the chosen date's distinct times in `mode: 'time'`. Shared by
 *  `sendSlotMenu` (what to show) and `matchSlotMenuReply` (what a reply can
 *  match) so both compute the exact same page from the exact same context. */
export function slotMenuPage(
  node: import('@docmee/db').WorkflowNode,
  ctx: WorkflowContext,
  page: number,
): { items: { id: string; title: string }[]; hasMore: boolean } {
  const mode = String(node.config?.['pickerMode'] ?? 'date')
  const slotsField = configField(node, 'slotsField', 'available_slots')
  const raw = ctx[slotsField]
  const slots = Array.isArray(raw)
    ? raw.filter((slot): slot is WorkflowSlot => isRecord(slot) && typeof slot['start'] === 'string' && typeof slot['end'] === 'string')
    : []
  const pageSize = boundedInteger(node.config?.['pageSize'], 8, 1, 9)

  const ids =
    mode === 'time'
      ? Array.from(new Set(slotsOnDate(slots, contextString(ctx, configField(node, 'dateField', 'preferred_date'))).map(slotTime)))
      : distinctSlotDates(slots)

  const pageIds = ids.slice(page * pageSize, page * pageSize + pageSize)
  const hasMore = ids.length > (page + 1) * pageSize
  const items = pageIds.map((id) => ({ id, title: mode === 'time' ? formatTimeLabel(id) : formatDateLabel(id) }))
  return { items, hasMore }
}

/**
 * Resolve a slot-menu reply against the page of options `sendSlotMenu`
 * actually showed. Precedence mirrors the engine's `resolveMenuHandle` for
 * interactive_menu: footer "0"/"1" → the tapped row's id (interactiveReplyId)
 * → the tapped row's TITLE (the inbound webhook populates `message` with
 * `interactive.list_reply.title`, not its id — matching on id alone silently
 * dropped every real tap to `default` whenever interactiveReplyId wasn't the
 * value that round-tripped) → a 1-based numeric index (plain-text fallback).
 */
export function resolveSlotMenuReply(
  items: { id: string; title: string }[],
  replyId: string | undefined,
  text: string,
): { outcome: 'selected'; value: string } | { outcome: Exclude<SlotMenuReplyOutcome, 'selected'> } {
  const trimmed = text.trim()
  if (trimmed === '0') return { outcome: 'restart' }
  if (trimmed === '1') return { outcome: 'livechat' }
  const lower = trimmed.toLowerCase()
  if (replyId === SLOT_MENU_MORE_OPTION_ID || lower === 'see other schedules') return { outcome: 'more' }
  if (replyId) {
    const byId = items.find((item) => item.id === replyId)
    if (byId) return { outcome: 'selected', value: byId.id }
  }
  const byTitle = items.find((item) => item.title.trim().toLowerCase() === lower)
  if (byTitle) return { outcome: 'selected', value: byTitle.id }
  const index = Number(trimmed)
  if (Number.isInteger(index) && index >= 1 && index <= items.length) {
    return { outcome: 'selected', value: items[index - 1]!.id }
  }
  return { outcome: 'default' }
}

/** Build the AI Agent node's system prompt: clinic + tone + personality/custom
 *  instructions + an injection guard + the scenario list the model must pick
 *  from, with a strict output-format contract `parseAiAgentCompletion` relies
 *  on. Exported for direct testing (this session's established convention
 *  for worker-side prompt-building helpers). */
export function buildAiAgentSystemPrompt(input: {
  clinicName: string
  personality: string
  customInstructions: string
  style: BotTone
  scenarios: { id: string; description: string }[]
}): string {
  const scenarioLines = input.scenarios.length
    ? input.scenarios.map((s) => `- ${s.id}: ${s.description}`).join('\n')
    : '(no scenarios configured)'
  return [
    `You are the AI agent for ${input.clinicName}, deciding how to route this WhatsApp conversation.`,
    `Tone: ${toneInstruction(input.style)}`,
    input.personality ? `Personality: ${input.personality}` : '',
    input.customInstructions ? `Instructions: ${input.customInstructions}` : '',
    injectionGuard(input.clinicName),
    'Scenarios you can match the patient\'s message against (id: description):',
    scenarioLines,
    [
      'Respond in EXACTLY this format, nothing else:',
      'SCENARIO: <the id of the single best-matching scenario, or NONE if nothing fits>',
      'REPLY:',
      '<your reply to the patient, in their language — ONLY when the matched scenario is a reply scenario, otherwise leave this blank>',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

/** Parse the strict `SCENARIO: ...` / `REPLY: ...` completion format
 *  `buildAiAgentSystemPrompt` instructs the model to use. Defensive: any
 *  unparseable or `NONE` completion returns a null scenarioId — the caller
 *  treats that as "no match", never as an LLM failure (that's `error`,
 *  reserved for the chatComplete call itself throwing). */
export function parseAiAgentCompletion(raw: string): { scenarioId: string | null; reply: string } {
  const scenarioMatch = raw.match(/SCENARIO:\s*(\S+)/i)
  const scenarioId = scenarioMatch && scenarioMatch[1]!.toUpperCase() !== 'NONE' ? scenarioMatch[1]!.trim() : null
  const replyMatch = raw.match(/REPLY:\s*([\s\S]*)$/i)
  const reply = replyMatch ? replyMatch[1]!.trim() : ''
  return { scenarioId, reply }
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
    const wamid = await target.send(text)
    await persistOutbound(sql, clinicId, ctx.conversationId, text, wamid)
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
      const wamid = await target.send(template.body)
      await persistOutbound(sql, clinicId, ctx.conversationId, template.body, wamid)
    },

    async notifySecretary(ctx) {
      await notify('A workflow flagged this conversation for attention.', ctx)
    },

    async addTag(tag, ctx) {
      await addConversationTag(tag, ctx)
    },

    async aiDraft(node, ctx) {
      const prompt = String(node.config?.['prompt'] ?? '')
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      const ai = (clinic.settings as { aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string } }).aiAssistant ?? {}
      const provider: ChatProvider = ai.chatProvider === 'openai' || ai.chatProvider === 'custom' || ai.chatProvider === 'gemini' ? ai.chatProvider : 'claude'
      const queryLimit = boundedInteger(node.config?.['queryLimit'], 500, 50, 4_000)
      const responseBuffer = boundedInteger(node.config?.['responseBuffer'], 0, 0, queryLimit - 1)
      const maxTokens = Math.max(1, queryLimit - responseBuffer)
      const content = await chatComplete({ provider, model: ai.model?.trim() || defaultChatModel(provider), baseURL: ai.baseURL?.trim() || undefined, apiKey: resolveClinicAiKey(clinic.settings, provider), history: [], maxTokens,
        system: 'Write a staff-reviewable patient reply draft. Ground it only in the explicit workflow instruction and patient context. Never diagnose, prescribe, or claim unknown clinic facts. This is a draft only and must never be sent automatically.',
        message: `Workflow instruction: ${prompt || '(none)'}\nPatient context: ${String(ctx.message ?? ctx.transcript ?? '(none)')}` })
      await createWorkflowApprovalsRepository(sql).createDraft({ clinicId, workflowId: data.workflowId, nodeId: node.id, runKey: `${workflowRunId}:${node.id}:ai_draft`, conversationId: ctx.conversationId, patientId: ctx.patientId, prompt, content: content.trim() })
      await notify('A workflow generated an AI draft for staff review. It was not sent.', ctx)
    },

    async aiAgent(node, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      const message = contextString(ctx, 'message')
      const language = detectLanguage(message)

      const currentMetadata = async (): Promise<Record<string, unknown> | undefined> => {
        if (!ctx.conversationId) return undefined
        const conv = await createConversationsRepository(sql).findById(clinicId, ctx.conversationId)
        return conv?.metadata
      }

      // Pre-LLM deterministic guard — same emergency check the main clinic
      // bot runs before ever calling the model; a true emergency should
      // never wait on (or be talked out of escalating by) an LLM call.
      if (isEmergencyMessage(message)) {
        await pauseBotForHandoff(sql, clinicId, ctx.conversationId, await currentMetadata(), 'emergency')
        await notify('The AI Agent workflow detected a possible emergency and paused the bot.', ctx)
        ctx['ai_agent_action'] = 'handoff'
        return 'handoff'
      }

      const scenarios = parseAiAgentScenarios(node.config)
      const styleRaw = String(node.config?.['communicationStyle'] ?? 'professional')
      const style: BotTone = styleRaw === 'friendly' || styleRaw === 'brief' ? styleRaw : 'professional'
      const personality = String(node.config?.['personality'] ?? '').trim()
      const customInstructions = String(node.config?.['customInstructions'] ?? '').trim()

      const system = buildAiAgentSystemPrompt({ clinicName: clinic.name, personality, customInstructions, style, scenarios })
      const ai = (clinic.settings as { aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string } }).aiAssistant ?? {}
      const provider: ChatProvider = ai.chatProvider === 'openai' || ai.chatProvider === 'custom' || ai.chatProvider === 'gemini' ? ai.chatProvider : 'claude'

      let raw: string
      try {
        raw = await chatComplete({
          provider,
          model: ai.model?.trim() || defaultChatModel(provider),
          baseURL: ai.baseURL?.trim() || undefined,
          apiKey: resolveClinicAiKey(clinic.settings, provider),
          history: [],
          maxTokens: 512,
          system,
          message,
        })
      } catch (err) {
        console.error('[workflow] ai_agent LLM call failed:', err)
        return 'error'
      }

      const { scenarioId, reply } = parseAiAgentCompletion(raw)
      const matched = scenarios.find((s) => s.id === scenarioId)
      ctx['ai_agent_matched_scenario'] = matched?.id ?? ''
      if (!matched) {
        ctx['ai_agent_action'] = 'none'
        return 'no_match'
      }

      if (matched.action === 'handoff') {
        ctx['ai_agent_action'] = 'handoff'
        await pauseBotForHandoff(sql, clinicId, ctx.conversationId, await currentMetadata(), 'ai_agent_handoff')
        await notify('The AI Agent handed this conversation off to the team.', ctx)
        return 'handoff'
      }

      if (matched.action === 'route') {
        ctx['ai_agent_action'] = 'route'
        if (matched.targetWorkflowId) {
          await enqueueWorkflowRunByTarget(sql, clinicId, matched.targetWorkflowId, 'workflow.ai_agent_route', {
            sourceEventId: `${workflowRunId}:${node.id}:route`,
            conversationId: ctx.conversationId,
            patientId: ctx.patientId,
            message,
          })
        }
        return 'routed'
      }

      // action === 'reply': run the same output-side safety screens the main
      // clinic bot applies before any auto-send — this node can now speak
      // for real, so it inherits the same defense-in-depth.
      const safety = screenMedicalSafety(reply)
      if (!safety.safe) {
        await pauseBotForHandoff(sql, clinicId, ctx.conversationId, await currentMetadata(), 'medical_safety')
        await sendWorkflowMessage(medicalSafetyDeferral(language), ctx)
        ctx['ai_agent_action'] = 'handoff'
        return 'handoff'
      }
      const leak = screenPromptLeak(reply)
      if (!leak.safe) {
        await pauseBotForHandoff(sql, clinicId, ctx.conversationId, await currentMetadata(), 'prompt_safety')
        await sendWorkflowMessage(promptSafetyDeferral(language), ctx)
        ctx['ai_agent_action'] = 'handoff'
        return 'handoff'
      }
      await sendWorkflowMessage(reply, ctx)
      ctx['ai_agent_action'] = 'reply'
      return 'replied'
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

    async sendInteractiveMenu(node, ctx) {
      const options = parseMenuOptions(node.config)
      const variant = String(node.config?.['variant'] ?? 'list')
      const rawHeader = String(node.config?.['header'] ?? '').trim()
      const rawMessage = String(node.config?.['message'] ?? '').trim()
      const footer = String(node.config?.['footer'] ?? '').trim()
      const isButton = variant === 'button' && options.length <= 3

      const brandedHeader = brandedMenuHeader(rawHeader)
      const message = [rawMessage, DOCMEE_LINKS_TEXT].filter(Boolean).join('\n\n')
      // What actually reaches conversation_messages (and the plain-text
      // fallback when no interactive sender is available) — always includes
      // the option list so the Inbox shows exactly what the patient was
      // offered, even though a real send carries options as WhatsApp
      // buttons/rows rather than body text.
      const fullText = [
        brandedHeader,
        message,
        ...(options.length ? [menuOptionsListText(options)] : []),
        ...(footer ? [footer] : []),
      ].join('\n\n')

      const target = await resolveTarget(sql, clinicId, ctx.patientId)
      if (target) {
        const sender = resolveWhatsAppInteractiveSender(target.account, target.handle)
        if (sender) {
          try {
            const wamid = await sender({
              kind: isButton ? 'buttons' : 'list',
              // A button send shows the Docmee logo as its header image
              // instead — WhatsApp allows only one header (image or text)
              // per interactive message, and only button-kind sends support
              // an image header at all (list headers must stay text).
              header: isButton ? undefined : brandedHeader,
              headerImageUrl: isButton ? DOCMEE_LOGO_URL : undefined,
              body: message,
              footer: footer || undefined,
              buttonLabel: isButton ? undefined : String(node.config?.['buttonLabel'] ?? 'Options'),
              options: options.map((o) => ({ id: o.optionId, title: o.title, description: o.description })),
            })
            await persistOutbound(sql, clinicId, ctx.conversationId, fullText, wamid)
          } catch (err) {
            console.error('[workflow] failed to send interactive menu:', err)
            await sendWorkflowMessage(fullText, ctx)
          }
        } else {
          await sendWorkflowMessage(fullText, ctx)
        }
      } else {
        await sendWorkflowMessage(fullText, ctx)
      }

      if (!ctx.conversationId) {
        console.log('[workflow] no conversation attached; cannot pause interactive menu')
        return false
      }

      ctx[WORKFLOW_MENU_CONTEXT_KEY] = { nodeId: node.id, status: 'pending' }
      const conversations = createConversationsRepository(sql)
      const conversation = await conversations.findById(clinicId, ctx.conversationId)
      if (!conversation) return false

      const timeoutMinutes = boundedInteger(node.config?.['timeoutMinutes'], 1_440, 5, 43_200)
      const metadata = writePendingWorkflowRun(conversation.metadata, {
        workflowId: data.workflowId,
        sourceEventId: data.trigger.sourceEventId,
        resumeNodeId: node.id,
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
          recoveryPrompt: message || 'Please choose an option.',
        })
      }
      return true
    },

    matchMenuReply(node, ctx) {
      const replyId = typeof ctx['interactiveReplyId'] === 'string' ? ctx['interactiveReplyId'] : undefined
      return resolveMenuHandle(parseMenuOptions(node.config), replyId, contextString(ctx, 'message'))
    },

    async sendSlotMenu(node, ctx, page) {
      const { items, hasMore } = slotMenuPage(node, ctx, page)
      if (items.length === 0) return false

      const mode = String(node.config?.['pickerMode'] ?? 'date')
      const rawHeader = String(node.config?.['header'] ?? '').trim()
      const rawMessage = String(
        node.config?.['message'] ?? (mode === 'time' ? 'What time works for you?' : 'Here are the available dates:'),
      ).trim()
      const footer = String(node.config?.['footer'] ?? '').trim()
      const options = [
        ...items.map((item) => ({ id: item.id, title: item.title })),
        ...(hasMore ? [{ id: SLOT_MENU_MORE_OPTION_ID, title: 'See other schedules' }] : []),
      ]

      const brandedHeader = brandedMenuHeader(rawHeader)
      const message = [rawMessage, DOCMEE_LINKS_TEXT].filter(Boolean).join('\n\n')
      const fullText = [brandedHeader, message, menuOptionsListText(options), ...(footer ? [footer] : [])].join('\n\n')

      const target = await resolveTarget(sql, clinicId, ctx.patientId)
      if (target) {
        const sender = resolveWhatsAppInteractiveSender(target.account, target.handle)
        if (sender) {
          try {
            const wamid = await sender({
              kind: 'list',
              header: brandedHeader,
              body: message,
              footer: footer || undefined,
              buttonLabel: String(node.config?.['buttonLabel'] ?? 'Options'),
              options,
            })
            await persistOutbound(sql, clinicId, ctx.conversationId, fullText, wamid)
          } catch (err) {
            console.error('[workflow] failed to send slot menu:', err)
            await sendWorkflowMessage(fullText, ctx)
          }
        } else {
          await sendWorkflowMessage(fullText, ctx)
        }
      } else {
        await sendWorkflowMessage(fullText, ctx)
      }

      if (!ctx.conversationId) {
        console.log('[workflow] no conversation attached; cannot pause slot menu')
        return false
      }

      ctx[WORKFLOW_SLOT_MENU_CONTEXT_KEY] = { nodeId: node.id, page, status: 'pending' }
      const conversations = createConversationsRepository(sql)
      const conversation = await conversations.findById(clinicId, ctx.conversationId)
      if (!conversation) return false

      const timeoutMinutes = boundedInteger(node.config?.['timeoutMinutes'], 1_440, 5, 43_200)
      const metadata = writePendingWorkflowRun(conversation.metadata, {
        workflowId: data.workflowId,
        sourceEventId: data.trigger.sourceEventId,
        resumeNodeId: node.id,
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
          recoveryPrompt: message || 'Please choose an option.',
        })
      }
      return true
    },

    matchSlotMenuReply(node, ctx, page) {
      const replyId = typeof ctx['interactiveReplyId'] === 'string' ? ctx['interactiveReplyId'] : undefined
      const { items } = slotMenuPage(node, ctx, page)
      const resolved = resolveSlotMenuReply(items, replyId, contextString(ctx, 'message'))
      if (resolved.outcome === 'selected') {
        const mode = String(node.config?.['pickerMode'] ?? 'date')
        const selectField = configField(node, 'selectField', mode === 'time' ? 'preferred_time' : 'preferred_date')
        ctx[selectField] = resolved.value
        return 'selected'
      }
      return resolved.outcome
    },

    async checkAvailability(node, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      const doctorValue = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
      const doctorId = await resolveWorkflowDoctorId(sql, clinicId, doctorValue)
      // A doctor WAS named but couldn't be matched — do not silently fall
      // through to the clinic's shared calendar (a different doctor's or a
      // generic calendar), which looks like "availability" but isn't the
      // selected doctor's. Fail loudly instead.
      if (doctorValue.trim() && !doctorId) {
        throw new Error(`Could not identify the selected doctor from "${doctorValue}"`)
      }
      const dateField = configField(node, 'dateField', 'preferred_date')
      const requestedStart = contextString(ctx, dateField)
      const startDate = requestedStart || todayIso()
      const dates = dateRange(startDate, boundedInteger(node.config?.['days'], 1, 1, 14))
      if (dates.length === 0) throw new Error(`Workflow availability date is invalid in ${dateField}: "${requestedStart}"`)
      const resolved = await workflowCalendarConfig(sql, clinic, doctorId)
      if (!resolved) throw new Error('Google Calendar is not connected for this doctor or clinic')
      const availableDays = resolved.doctor?.availableDays
      const slots = excludePastSlots(
        (await Promise.all(dates.map((date) => listSlotsForDate(resolved.config, availableDays, date)))).flat(),
      )
      ctx[configField(node, 'slotsField', 'available_slots')] = slots
      ctx['availability_count'] = slots.length
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

    async createOrRescheduleBooking(node, ctx) {
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      if (!clinic) throw new Error(`Clinic not found: ${clinicId}`)
      if (!ctx.patientId) throw new Error('A patient is required to create or reschedule a booking')

      const doctorValue = contextString(ctx, configField(node, 'doctorIdField', 'doctor_id'))
      const doctorId = await resolveWorkflowDoctorId(sql, clinicId, doctorValue)
      if (doctorValue.trim() && !doctorId) {
        throw new Error(`Could not identify the selected doctor from "${doctorValue}"`)
      }
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
      const resolvedCalendar = await workflowCalendarConfig(sql, clinic, doctorId || undefined)
      if (!resolvedCalendar) throw new Error('Google Calendar is not connected for this doctor or clinic')
      const calendar = createGoogleCalendarOps(resolvedCalendar.config)
      const title = String(node.config?.['title'] ?? `Appointment: ${contextString(ctx, 'patient_name') || 'Patient'}`)
      const startTime = `${date}T${time}:00`
      const endTime = addMinutes(startTime, duration)
      // Same grid the offered slots were computed with (the doctor's real
      // hours for this weekday, when configured) — otherwise a slot correctly
      // offered outside the default 09:00–18:00 window would be rejected here
      // as "no longer available" even though nothing actually changed.
      const availableSlots = await listSlotsForDate(resolvedCalendar.config, resolvedCalendar.doctor?.availableDays, date)
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
