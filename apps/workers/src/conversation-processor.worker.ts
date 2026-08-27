// Consumes: whatsapp.inbound queue.
// Resolves the owning clinic from the WhatsApp phone_number_id, detects new vs
// returning patients (Gap #16), monitors Meta token expiry (Gap #19), then routes
// the message to transcription (audio) or directly to the agent (text/image/document).
import { z } from 'zod'
import { transcriptionQueue, agentQueue, notificationQueue, type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createChannelAccountsRepository,
  createClinicsRepository,
  createPatientsRepository,
  createConversationsRepository,
  createMessagesRepository,
  type Channel,
  type ContentType,
} from '@docmee/db'
import { firstContactMetadata } from './intake.js'
import { createClinicCrmExporter } from './crm.js'
import { readMetaToken } from './meta-token.js'
import { resumePendingWorkflowRuns } from './workflow-run.js'
import { patientAllowsAutomation } from './automation-boundary.js'

export const InboundMessageSchema = z.object({
  // Channel the message arrived on. `phoneNumberId` is the provider account id:
  // a WhatsApp phone_number_id, a Messenger Page id, or an Instagram account id.
  // `patientWaId` is the sender handle: a WhatsApp wa_id, a Messenger PSID, or
  // an Instagram IGSID.
  channel: z.enum(['whatsapp', 'messenger', 'instagram']).optional().default('whatsapp'),
  phoneNumberId: z.string(),
  patientWaId: z.string(),
  patientName: z.string().optional().default(''),
  messageType: z.enum(['text', 'audio', 'image', 'document', 'button', 'interactive']),
  content: z.string().optional(), // text messages
  mediaId: z.string().optional(), // audio/image/document
  mimeType: z.string().optional(),
  // Single Choice (Punchlist Aug 3 parity spec): the stable id of a tapped
  // WhatsApp button/list row (interactive.button_reply.id / list_reply.id).
  interactiveReplyId: z.string().optional(),
  waMessageId: z.string(),
  timestamp: z.number(),
})

export type InboundMessage = z.infer<typeof InboundMessageSchema>

const TOKEN_EXPIRY_WARNING_DAYS = 7
const MS_PER_DAY = 1000 * 60 * 60 * 24

// Where each channel's token-expiry timestamp is stored. WhatsApp tokens live on
// the channel_accounts row (settings.tokenExpiresAt); Messenger/Instagram tokens
// live on the clinic row (settings.{messenger,instagram}TokenExpiresAt) since
// their connection config is per-clinic, not per channel_account (P14/P15).
const CLINIC_EXPIRY_KEY = {
  messenger: 'messengerTokenExpiresAt',
  instagram: 'instagramTokenExpiresAt',
} as const

/** Parse a stored token-expiry value (ISO string or epoch ms) into a Date. */
function parseExpiry(raw: unknown): Date | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Gap #19: warn when a Meta channel access token is within the warning window of
 * expiry. All three channels raise the same META_TOKEN_EXPIRING alert, tagged with
 * the channel so the renewal notice names the right surface. No-op when no expiry
 * is configured. Best-effort dispatch (the alert never blocks message processing).
 */
async function warnIfTokenExpiring(
  clinicId: string,
  expiresAt: Date | null,
  channel: Channel,
): Promise<void> {
  if (!expiresAt) return
  const daysRemaining = (expiresAt.getTime() - Date.now()) / MS_PER_DAY
  if (daysRemaining >= TOKEN_EXPIRY_WARNING_DAYS) return
  await notificationQueue.add('notify', {
    clinicId,
    type: 'META_TOKEN_EXPIRING',
    channel,
    daysRemaining: Math.max(0, Math.ceil(daysRemaining)),
  })
}

// Map a Meta message type to the conversation_messages content_type domain
// ('text' | 'audio' | 'image' | 'template' | 'interactive'). Documents/buttons
// have no dedicated type, so they persist as text/interactive respectively.
function inboundContentType(messageType: InboundMessage['messageType']): ContentType {
  if (messageType === 'image') return 'image'
  if (messageType === 'interactive' || messageType === 'button') return 'interactive'
  return 'text'
}

function parseReviewScore(text: string): number | null {
  const match = text.trim().match(/\b(10|[0-9])\b/)
  if (!match) return null
  const score = Number(match[1])
  return Number.isFinite(score) ? score : null
}

function isConfirmReply(text: string): boolean {
  return /^(yes|y|confirm|confirmed|si|sí|confirmo|ok|okay)\b/i.test(text.trim())
}

function isCancelReply(text: string): boolean {
  return /\b(cancel|cancelar|cancela|no puedo|can't|cant|cannot|reprogramar|reschedule)\b/i.test(text.trim())
}

async function applyInboundFollowUpReply(
  sql: ReturnType<typeof createServiceDbClient>,
  clinicId: string,
  patientId: string,
  content: string,
): Promise<void> {
  if (!content.trim()) return
  const [followUp] = await sql<Array<{ id: string; appointmentId: string | null; type: string; metadata: Record<string, unknown> }>>`
    SELECT id, appointment_id, type, metadata
    FROM follow_ups
    WHERE clinic_id = ${clinicId}
      AND patient_id = ${patientId}
      AND status IN ('sent', 'clicked')
      AND review_sent_at > NOW() - INTERVAL '14 days'
    ORDER BY review_sent_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `
  if (!followUp) return

  if (followUp.type === 'review_request') {
    const score = parseReviewScore(content)
    if (score === null) return
    const ratingType = score > 5 ? 'nps' : 'rating_1_5'
    await sql`
      UPDATE follow_ups
      SET metadata = metadata || ${sql.json({ reviewScore: score, ratingType, reviewReply: content, capturedAt: new Date().toISOString() })},
          status = 'clicked'
      WHERE clinic_id = ${clinicId} AND id = ${followUp.id}
    `
    if (score <= (ratingType === 'nps' ? 6 : 3)) {
      await notificationQueue.add('notify', {
        clinicId,
        type: 'LOW_REVIEW_SCORE',
        score,
        ratingType,
        patientId,
      })
    }
    return
  }

  if (!followUp.appointmentId || followUp.type !== 'appointment_confirmation') return
  if (isConfirmReply(content)) {
    await sql`UPDATE appointments SET status = 'confirmed', updated_at = NOW() WHERE clinic_id = ${clinicId} AND id = ${followUp.appointmentId}`
    await sql`INSERT INTO appointment_events (appointment_id, clinic_id, event_type, metadata) VALUES (${followUp.appointmentId}, ${clinicId}, 'confirmed', ${sql.json({ source: 'reminder_reply', reply: content })})`
  } else if (isCancelReply(content)) {
    await sql`UPDATE appointments SET status = 'cancelled', updated_at = NOW() WHERE clinic_id = ${clinicId} AND id = ${followUp.appointmentId}`
    await sql`INSERT INTO appointment_events (appointment_id, clinic_id, event_type, metadata) VALUES (${followUp.appointmentId}, ${clinicId}, 'cancelled', ${sql.json({ source: 'reminder_reply', reply: content })})`
  }
}

/**
 * Unified Inbox (Req 4): thread a non-audio inbound message onto the patient's
 * open conversation (creating one if none is active) and persist it as a `user`
 * message so the inbox shows the patient's side of the thread. Returns the
 * conversation id, or null if persistence failed — the caller then enqueues the
 * agent without a conversation id (degraded, but the patient is never left on read).
 * Audio is handled separately: the transcription worker persists the voice note +
 * transcript on the same conversation (Req 8).
 */
async function threadInboundMessage(
  sql: ReturnType<typeof createServiceDbClient>,
  clinicId: string,
  channel: Channel,
  patientId: string,
  msg: InboundMessage,
): Promise<string | null> {
  try {
    const conversations = createConversationsRepository(sql)
    const existing = await conversations.findOpenByContact(clinicId, channel, msg.patientWaId)
    const conversation =
      existing ??
      (await conversations.create({
        clinicId,
        patientId,
        channel,
        channelContactHandle: msg.patientWaId,
      }))

    await createMessagesRepository(sql).create({
      conversationId: conversation.id,
      clinicId,
      role: 'user',
      content: msg.content ?? '',
      contentType: inboundContentType(msg.messageType),
      channelMessageId: msg.waMessageId,
      metadata: {
        channel,
        ...(msg.mediaId ? { mediaId: msg.mediaId } : {}),
        ...(msg.mimeType ? { mimeType: msg.mimeType } : {}),
      },
    })

    if (msg.messageType === 'text') {
      await applyInboundFollowUpReply(sql, clinicId, patientId, msg.content ?? '')
    }

    return conversation.id
  } catch (err) {
    console.error('[conversation] failed to persist inbound message:', err)
    return null
  }
}

export async function processConversationJob(job: Job): Promise<void> {
  const msg = InboundMessageSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const channel: Channel = msg.channel
    // Resolve which clinic owns the receiving account. WhatsApp resolves via the
    // channel_accounts table (per phone_number_id); Messenger resolves via the
    // clinic's connected Page id (P14); Instagram via its account id (P15).
    let clinicId: string
    let waAccessToken = ''

    if (channel === 'messenger') {
      const clinics = createClinicsRepository(sql)
      const clinic = await clinics.findByMessengerPageId(msg.phoneNumberId)
      if (!clinic) {
        console.warn(
          `[conversation] no Messenger-enabled clinic for page_id=${msg.phoneNumberId}; dropping ${msg.waMessageId}`,
        )
        return
      }
      clinicId = clinic.id
      // Gap #19: warn when the Messenger Page access token is close to expiry.
      await warnIfTokenExpiring(
        clinicId,
        parseExpiry(clinic.settings[CLINIC_EXPIRY_KEY.messenger]),
        'messenger',
      )
    } else if (channel === 'instagram') {
      const clinics = createClinicsRepository(sql)
      const clinic = await clinics.findByInstagramAccountId(msg.phoneNumberId)
      if (!clinic) {
        console.warn(
          `[conversation] no Instagram-enabled clinic for account_id=${msg.phoneNumberId}; dropping ${msg.waMessageId}`,
        )
        return
      }
      clinicId = clinic.id
      // Gap #19: warn when the Instagram Page access token is close to expiry.
      await warnIfTokenExpiring(
        clinicId,
        parseExpiry(clinic.settings[CLINIC_EXPIRY_KEY.instagram]),
        'instagram',
      )
    } else {
      const channelAccounts = createChannelAccountsRepository(sql)
      const account = await channelAccounts.findByAccount('whatsapp', msg.phoneNumberId)
      if (!account) {
        console.warn(
          `[conversation] no active WhatsApp channel account for phone_number_id=${msg.phoneNumberId}; dropping ${msg.waMessageId}`,
        )
        return
      }
      clinicId = account.clinicId
      waAccessToken = readMetaToken(account.accessTokenEnc) ?? ''

      // Gap #19: warn when the WhatsApp access token is close to expiry.
      await warnIfTokenExpiring(
        clinicId,
        parseExpiry((account.settings as { tokenExpiresAt?: unknown }).tokenExpiresAt),
        'whatsapp',
      )
    }

    // Gap #16: new vs returning patient detection.
    const patients = createPatientsRepository(sql)
    const existing = await patients.findByContact(clinicId, channel, msg.patientWaId)
    const isNewPatient = !existing
    let patientId: string

    if (existing) {
      patientId = existing.id
      if (existing.status === 'new') {
        await patients.update(clinicId, existing.id, { status: 'returning' })
      }
    } else {
      // Req 10: capture name, phone (the WhatsApp handle is the phone) and source
      // (the originating channel) the moment a new patient first contacts us.
      const created = await patients.create({
        clinicId,
        fullName: msg.patientName || undefined,
        status: 'new',
        metadata: firstContactMetadata(channel, msg.patientWaId),
      })
      patientId = created.id
      await patients.addContact({
        patientId: created.id,
        clinicId,
        channel,
        contactHandle: msg.patientWaId,
        isPrimary: true,
      })

      // Req 31 (CRM / Google Sheets): mirror the brand-new contact as a row in
      // the clinic's configured Sheet (source, status 'new', scheduled=no, clinic
      // scoping). Opt-in per clinic; best-effort — a Sheets failure is logged and
      // never blocks message processing.
      try {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        const crm = clinic ? createClinicCrmExporter(clinic) : null
        if (clinic && crm) {
          await crm.appendRow({
            recordType: 'contact',
            timestamp: new Date().toISOString(),
            clinicId,
            clinicName: clinic.name,
            patientName: msg.patientName || '',
            phone: channel === 'whatsapp' ? msg.patientWaId : '',
            source: channel,
            doctorName: '',
            specialty: '',
            reason: '',
            appointmentDate: '',
            appointmentTime: '',
            status: 'new',
            scheduled: false,
          })
        }
      } catch (err) {
        console.error('[conversation] CRM contact export failed:', err)
      }
    }

    if (msg.messageType === 'audio') {
      // Transcribe first; the transcription worker re-enqueues to the agent.
      // Audio only reaches here on WhatsApp; Messenger inbound is text-only (P14).
      await transcriptionQueue.add(
        'transcribe',
        {
          clinicId,
          patientId,
          patientWaId: msg.patientWaId,
          messageId: msg.waMessageId,
          mediaId: msg.mediaId,
          mimeType: msg.mimeType,
          waAccessToken,
          phoneNumberId: msg.phoneNumberId,
        },
        msg.waMessageId ? { jobId: `tx:${clinicId}:${msg.waMessageId}` } : {},
      )
    } else {
      // Text/image/document → persist the inbound message onto the patient's
      // conversation (Req 4 Unified Inbox), then hand to the agent for intent
      // classification threaded onto that same conversation. `channel` tells the
      // agent worker which sender to reply through.
      const conversationId = await threadInboundMessage(sql, clinicId, channel, patientId, msg)
      // Item 4 of the 25-item batch: secretary alert on a genuinely new
      // conversation (not every message — that would be far too noisy). Fires
      // once, on the first inbound message from a brand-new patient contact.
      // Best-effort — never blocks message processing.
      if (isNewPatient) {
        try {
          await notificationQueue.add('notify', {
            clinicId,
            conversationId: conversationId ?? undefined,
            type: 'new_message',
          })
        } catch (err) {
          console.error('[conversation] failed to enqueue new_message notification:', err)
        }
      }
      // Human-only is a worker trust boundary, not a UI preference. Keep the
      // inbound record and staff notification, then stop before any workflow or
      // agent can produce an automated reply.
      if (existing && !patientAllowsAutomation(existing)) return
      const resumedWorkflows = conversationId
        ? await resumePendingWorkflowRuns(sql, clinicId, conversationId, {
            patientId,
            conversationId,
            channel,
            message: msg.content ?? '',
            waMessageId: msg.waMessageId,
            interactiveReplyId: msg.interactiveReplyId,
          })
        : 0
      // A pending Ask & Capture owns this turn. Its workflow runner validates the
      // reply and either advances, re-asks, or hands off; avoid a competing agent
      // answer for the same patient message.
      if (resumedWorkflows > 0) return
      // CRE-53: dedupe redelivered webhooks at the queue. A repeat waMessageId maps
      // to the same jobId and BullMQ ignores the duplicate, so one patient message
      // can never produce two AI replies.
      await agentQueue.add(
        'process',
        {
          clinicId,
          channel,
          phoneNumberId: msg.phoneNumberId,
          patientId,
          patientWaId: msg.patientWaId,
          message: msg.content ?? '',
          interactiveReplyId: msg.interactiveReplyId,
          waMessageId: msg.waMessageId,
          isNewPatient,
          conversationId: conversationId ?? undefined,
        },
        msg.waMessageId ? { jobId: `agent:${clinicId}:${msg.waMessageId}` } : {},
      )
    }
  } finally {
    await sql.end()
  }
}
