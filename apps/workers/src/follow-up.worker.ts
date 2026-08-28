// Consumes: follow-up queue (Rev1 #14 — Follow-up Automation).
//
// A producer schedules a delayed job for one of the seven follow-up types (see
// follow-up.ts); when it fires this worker delivers the matching WhatsApp message —
// but only after re-checking, at send time, everything that may have changed since
// it was scheduled:
//   • consent       — never message a patient who has opted out
//   • appointment    — skip when the linked appointment was cancelled
//   • no_response    — skip when the patient has since replied (self-cancel)
//   • 24h window     — inside Meta's customer-care window send free text; outside it
//                      a proactive send requires an approved template, else we skip
//   • idempotency    — claim a follow_ups row so a re-fired job never double-sends
import {
  FollowUpJobSchema,
  FOLLOW_UP_TYPES,
  followUpMessage,
  isWithinCustomerCareWindow,
  templateCategoryForType,
  type FollowUpContext,
} from './follow-up.js'
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'
import { resolveAutomationEligiblePatient } from './automation-patient-guard.js'
import { type Job } from '@docmee/queue'
import { patientAllowsAutomation } from './automation-boundary.js'
import {
  createServiceDbClient,
  createClinicsRepository,
  createPatientsRepository,
  createChannelAccountsRepository,
  createAppointmentsRepository,
  createConversationsRepository,
  createFollowUpsRepository,
  createMessagesRepository,
  createMessageTemplatesRepository,
  type Patient,
  type Appointment,
  type PatientContact,
} from '@docmee/db'

// Re-export so existing importers (and tests) keep working from one entry point.
export { FOLLOW_UP_TYPES, scheduleFollowUp } from './follow-up.js'
export type { FollowUpType, FollowUpJobData } from './follow-up.js'

type Language = 'es' | 'en'

// Outbound anti-spam (Req 19 Meta Compliance). Cap how many PROACTIVE messages one
// patient may receive in a rolling window so an over-eager schedule (or a scheduling
// bug) can never flood a patient — repeated unsolicited messages are the fastest way
// to get a WhatsApp Business number quality-flagged or banned by Meta. Reactive bot
// replies (agent worker, answering an inbound message) are unaffected; this guards
// only the proactive follow-up surface. Tunable via env, default 5 / 24h.
const ANTI_SPAM_WINDOW_HOURS = 24
function maxProactivePerPatient(): number {
  const raw = Number(process.env['FOLLOWUP_MAX_PER_PATIENT_PER_DAY'])
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5
}

function getPatientLanguage(patient: Patient): Language {
  return (patient.metadata as { language?: unknown }).language === 'en' ? 'en' : 'es'
}

/** Screen 12: a follow-up type is disabled only when clinic.settings.automations
 *  carries an explicit `false`. Anything else (no config, true) means enabled. */
function isFollowUpTypeDisabled(settings: unknown, type: string): boolean {
  const automations = (settings as { automations?: { followUps?: Record<string, unknown> } } | null)
    ?.automations
  return automations?.followUps?.[type] === false
}

/** Rev 2 Approval node: the clinic requires secretary sign-off before sending this
 *  follow-up type when clinic.settings.automations.requireApproval[type] === true. */
function requiresApproval(settings: unknown, type: string): boolean {
  const automations = (settings as { automations?: { requireApproval?: Record<string, unknown> } } | null)
    ?.automations
  return automations?.requireApproval?.[type] === true
}

function isPatientOptedOut(patient: Patient): boolean {
  return (patient.metadata as { optedOut?: unknown }).optedOut === true
}

function primaryWhatsAppHandle(contacts: PatientContact[]): string | null {
  const whatsapp = contacts.filter((c) => c.channel === 'whatsapp')
  return (whatsapp.find((c) => c.isPrimary) ?? whatsapp[0])?.contactHandle ?? null
}

/** A friendly localized "Mon 21 at 14:30"-style label from an appointment start. */
function formatWhen(appointment: Appointment | null, language: Language): FollowUpContext {
  if (!appointment) return {}
  try {
    const d = new Date(appointment.startTime)
    const when = d.toLocaleString(language === 'en' ? 'en-US' : 'es-ES', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })
    return { when }
  } catch {
    return {}
  }
}

/**
 * Unified Inbox (Req 4/14): persist a delivered proactive follow-up as an
 * `assistant` row on the patient's WhatsApp thread so a secretary actually SEES
 * the message the bot sent — otherwise an automated confirmation/reminder is
 * invisible in the panel and staff risk contacting a patient the bot already
 * reached. Threads onto the conversation the producer attached (no_response) or
 * the patient's open WhatsApp thread, opening one if none is active (so a later
 * reply threads back onto it, exactly like an inbound message would). The wamid
 * is stored as channel_message_id so the Req 3 delivery indicator tracks it.
 * Best-effort: a storage failure is logged and never undoes the send.
 */
async function threadFollowUpIntoInbox(
  sql: ReturnType<typeof createServiceDbClient>,
  clinicId: string,
  patientId: string,
  handle: string,
  text: string,
  wamid: string | null,
  type: string,
  conversationId?: string,
): Promise<void> {
  try {
    const conversations = createConversationsRepository(sql)
    const existing =
      (conversationId ? await conversations.findById(clinicId, conversationId) : null) ??
      (await conversations.findOpenByContact(clinicId, 'whatsapp', handle))
    const conversation =
      existing ??
      (await conversations.create({
        clinicId,
        patientId,
        channel: 'whatsapp',
        channelContactHandle: handle,
      }))

    await createMessagesRepository(sql).create({
      conversationId: conversation.id,
      clinicId,
      role: 'assistant',
      content: text,
      ...(wamid ? { channelMessageId: wamid } : {}),
      metadata: { channel: 'whatsapp', followUpType: type },
    })
  } catch (err) {
    console.error('[follow-up] failed to persist outbound message to inbox:', err)
  }
}

export async function processFollowUpJob(job: Job): Promise<void> {
  const data = FollowUpJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const clinics = createClinicsRepository(sql)
    const patients = createPatientsRepository(sql)
    const channelAccounts = createChannelAccountsRepository(sql)
    const appointments = createAppointmentsRepository(sql)
    const conversations = createConversationsRepository(sql)
    const followUps = createFollowUpsRepository(sql)
    const messages = createMessagesRepository(sql)
    const templates = createMessageTemplatesRepository(sql)

    const clinic = await clinics.findById(data.clinicId)
    if (!clinic) {
      console.warn(`[follow-up] unknown clinic ${data.clinicId}; dropping ${data.type}`)
      return
    }

    // Screen 12 (Automation builder): honour the clinic's per-type enable flag at
    // fire time. A type the admin switched off is skipped here — consistent with the
    // consent / cancellation re-checks below. Absent flag = enabled (default-on), so
    // clinics that never opened the builder are unaffected.
    if (isFollowUpTypeDisabled(clinic.settings, data.type)) {
      console.log(`[follow-up] ${data.type} disabled for clinic ${data.clinicId}; skipping`)
      return
    }

    const patient = await patients.findById(data.clinicId, data.patientId)
    if (!patient) {
      console.warn(`[follow-up] unknown patient ${data.patientId}; dropping ${data.type}`)
      return
    }

    // Never message a patient who has opted out.
  if (isPatientOptedOut(patient)) {
      console.log(`[follow-up] patient ${data.patientId} opted out; skipping ${data.type}`)
    return
  }
  if (!patientAllowsAutomation(patient)) {
    console.log(`[follow-up] patient ${data.patientId} is not automation-eligible; skipping ${data.type}`)
    return
  }

    // Appointment guard: an appointment-relative follow-up is pointless once the
    // appointment is gone or cancelled — don't remind a patient about a cancelled visit.
    let appointment: Appointment | null = null
    if (data.appointmentId) {
      appointment = await appointments.findById(data.clinicId, data.appointmentId)
      if (!appointment) {
        console.log(`[follow-up] appointment ${data.appointmentId} gone; skipping ${data.type}`)
        return
      }
      if (appointment.status === 'cancelled') {
        console.log(`[follow-up] appointment ${data.appointmentId} cancelled; skipping ${data.type}`)
        return
      }
    }

    const nowIso = new Date().toISOString()
    const lastInbound = await messages.findLastInboundAt(data.clinicId, data.patientId)

    // no_response self-cancel + dedupe: if the patient already replied after the job
    // was scheduled the conversation is no longer "no response", and we send at most
    // one nudge per conversation.
    if (data.type === FOLLOW_UP_TYPES.NO_RESPONSE) {
      if (
        data.silentSinceIso &&
        lastInbound &&
        Date.parse(lastInbound) > Date.parse(data.silentSinceIso)
      ) {
        console.log(`[follow-up] patient ${data.patientId} replied; cancelling no_response`)
        return
      }
      // The stall-timer (stalled-conversation.ts) may already have auto-closed this
      // exact "mid-flow, no reply" conversation long before this fixed 20h job fires
      // (no job-cancellation mechanism exists in this codebase). A closed conversation
      // is "already handled", not "no response" — skip it.
      if (data.conversationId) {
        const conv = await conversations.findById(data.clinicId, data.conversationId)
        if (conv && conv.status !== 'open') {
          console.log(
            `[follow-up] conversation ${data.conversationId} is no longer open (${conv.status}); cancelling no_response`,
          )
          return
        }
      }
      if (
        data.conversationId &&
        (await followUps.existsRecentByConversation(data.clinicId, data.conversationId, data.type, 24))
      ) {
        console.log(`[follow-up] no_response already sent for conversation ${data.conversationId}`)
        return
      }
    }

    // Outbound anti-spam cap (Req 19): refuse to add yet another proactive message
    // once this patient has already received the per-day maximum, regardless of type.
    const recentSends = await followUps.countSentToPatientSince(
      data.clinicId,
      data.patientId,
      ANTI_SPAM_WINDOW_HOURS,
    )
    if (recentSends >= maxProactivePerPatient()) {
      console.log(
        `[follow-up] patient ${data.patientId} hit the proactive cap (${recentSends} in ${ANTI_SPAM_WINDOW_HOURS}h); skipping ${data.type}`,
      )
      return
    }

    const account = activeWhatsAppAccount(await channelAccounts.listByClinic(data.clinicId))
    const handle = primaryWhatsAppHandle(await patients.listContacts(data.clinicId, data.patientId))
    if (!handle) {
      console.warn(`[follow-up] patient ${data.patientId} has no WhatsApp contact; skipping`)
      return
    }

    const sendWhatsApp = resolveWhatsAppSender(account, handle)
    if (!account || !sendWhatsApp) {
      console.warn(`[follow-up] no active WhatsApp account for clinic ${data.clinicId}; cannot send`)
      return
    }

    const language = getPatientLanguage(patient)

    // 24-hour customer-care window (Req 19 Meta Compliance). Inside the window we may
    // send a free-text follow-up; outside it a proactive send is only allowed via an
    // approved HSM template. Types with no template category (post-care, review, no
    // response) simply cannot be sent late — we skip rather than risk a policy violation.
    let text: string
    if (isWithinCustomerCareWindow(lastInbound, nowIso)) {
      text = data.type === FOLLOW_UP_TYPES.NO_RESPONSE && data.recoveryPrompt
        ? data.recoveryPrompt
        : followUpMessage(data.type, language, formatWhen(appointment, language))
    } else {
      const category = templateCategoryForType(data.type)
      const template = category
        ? await templates.findApprovedByCategory(data.clinicId, category)
        : null
      if (!template) {
        console.log(
          `[follow-up] outside 24h window with no approved template for ${data.type}; skipping`,
        )
        return
      }
      text = template.body
    }

    // Approval gate (Rev 2): when the clinic requires sign-off for this type, store
    // the drafted message for a secretary instead of sending. On approval the same
    // job re-runs with approved:true, so every consent/window/anti-spam re-check above
    // runs again at the real send time. Skipped for the approved re-entry.
    if (!data.approved && requiresApproval(clinic.settings, data.type)) {
      await followUps.upsertPendingApproval({
        clinicId: data.clinicId,
        patientId: data.patientId,
        ...(data.appointmentId ? { appointmentId: data.appointmentId } : {}),
        type: data.type,
        metadata: { draft: text, job: data, ...(data.conversationId ? { conversationId: data.conversationId } : {}) },
      })
      console.log(`[follow-up] ${data.type} queued for approval (clinic ${data.clinicId})`)
      return
    }

    // Idempotency: claim a follow_ups row so a re-fired job never double-sends. An
    // approved re-entry atomically claims its existing pending_approval row instead.
    const followUp = data.approved && data.followUpId
      ? await followUps.claimForSend(data.clinicId, data.followUpId)
      : await followUps.createIfAbsent({
          clinicId: data.clinicId,
          patientId: data.patientId,
          ...(data.appointmentId ? { appointmentId: data.appointmentId } : {}),
          type: data.type,
          ...(data.conversationId ? { metadata: { conversationId: data.conversationId } } : {}),
        })
    if (!followUp) {
      console.log(`[follow-up] ${data.type} already recorded/claimed; skipping`)
      return
    }

    const deliveryPatient = await resolveAutomationEligiblePatient(
      patients,
      data.clinicId,
      data.patientId,
      'follow-up',
    )
    if (!deliveryPatient) return

    const wamid = await sendWhatsApp(text)
    // The approved path was already flipped to 'sent' by claimForSend.
    if (!(data.approved && data.followUpId)) await followUps.markSent(data.clinicId, followUp.id)

    // Surface the delivered follow-up in the secretary's inbox thread (Req 4/14).
    await threadFollowUpIntoInbox(
      sql,
      data.clinicId,
      data.patientId,
      handle,
      text,
      wamid,
      data.type,
      data.conversationId,
    )
  } finally {
    await sql.end()
  }
}
