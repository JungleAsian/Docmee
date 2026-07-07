// Consumes: whatsapp.status + messenger.status + instagram.status queues.
// Records channel delivery-status receipts (Req 3 WhatsApp, Req 33 Messenger,
// Req 34 Instagram).
//
// WhatsApp: Meta posts a `statuses` webhook for every outbound message as it moves
// through its lifecycle (sent → delivered → read) or fails, each keyed by the
// outbound wamid. The clinic is resolved from the phone_number_id.
//
// Messenger / Instagram: Meta posts `delivery` events (carrying the outbound mids)
// and `read` events (a watermark timestamp — every message sent at/before it has
// been read, with no per-message ids). The clinic is resolved from the Page id
// (Messenger) or the Instagram account id (Instagram). Send failures on both are
// synchronous (the Send API throws) and are already captured as a `meta_send_failure`
// error review (Req 19), so there is no async failed receipt.
//
// In all cases the matched outbound (assistant) message gets a message_delivery_events
// row, surfacing the sent/delivered/read/failed indicator in the inbox.
import { z } from 'zod'
import { type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createChannelAccountsRepository,
  createClinicsRepository,
  createConversationsRepository,
  createMessagesRepository,
  createErrorReviewsRepository,
  type Sql,
} from '@docmee/db'

export const DeliveryStatusSchema = z.object({
  // The originating channel. Defaults to whatsapp for back-compat with the
  // whatsapp.status queue payloads, which predate the channel tag.
  channel: z.enum(['whatsapp', 'messenger', 'instagram']).default('whatsapp'),
  // WhatsApp phone_number_id, Messenger Page id or Instagram account id —
  // resolves the owning clinic.
  phoneNumberId: z.string(),
  // The outbound provider id (wamid / Messenger mid). Absent on a Messenger read,
  // which is reported as a watermark instead.
  channelMessageId: z.string().optional(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  recipientId: z.string().optional(),
  timestamp: z.number().optional(),
  // Messenger read watermark (epoch ms): every outbound message in the thread sent
  // at/before this instant has been read.
  watermark: z.number().optional(),
  errorTitle: z.string().optional(),
  errorCode: z.number().optional(),
})

export type DeliveryStatusJob = z.infer<typeof DeliveryStatusSchema>

/** Resolve the owning clinic id from the channel's account identifier. */
async function resolveClinicId(
  sql: Sql,
  channel: 'whatsapp' | 'messenger' | 'instagram',
  accountId: string,
): Promise<string | null> {
  if (channel === 'messenger') {
    const clinic = await createClinicsRepository(sql).findByMessengerPageId(accountId)
    return clinic?.id ?? null
  }
  if (channel === 'instagram') {
    const clinic = await createClinicsRepository(sql).findByInstagramAccountId(accountId)
    return clinic?.id ?? null
  }
  const account = await createChannelAccountsRepository(sql).findByAccount('whatsapp', accountId)
  return account?.clinicId ?? null
}

export async function processDeliveryStatusJob(job: Job): Promise<void> {
  const data = DeliveryStatusSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const clinicId = await resolveClinicId(sql, data.channel, data.phoneNumberId)
    if (!clinicId) {
      console.warn(
        `[delivery-status] no ${data.channel} account for ${data.phoneNumberId}; dropping ${data.channelMessageId ?? 'read'}`,
      )
      return
    }

    // Messenger read receipt: a watermark, not a message id. Mark the whole prefix
    // of the patient's open thread read in one pass.
    if (data.status === 'read' && data.watermark != null && !data.channelMessageId) {
      if (!data.recipientId) {
        console.warn('[delivery-status] read receipt with no recipient; dropping')
        return
      }
      const conversation = await createConversationsRepository(sql).findOpenByContact(
        clinicId,
        data.channel,
        data.recipientId,
      )
      if (!conversation) {
        console.log(
          `[delivery-status] no open ${data.channel} thread for ${data.recipientId} (clinic ${clinicId}); read ignored`,
        )
        return
      }
      const marked = await createMessagesRepository(sql).recordReadReceipt(
        clinicId,
        conversation.id,
        data.watermark,
      )
      console.log(
        `[delivery-status] marked ${marked} ${data.channel} message(s) read in conversation ${conversation.id}`,
      )
      return
    }

    // Id-keyed receipt (WhatsApp sent/delivered/read/failed, Messenger delivered).
    if (!data.channelMessageId) {
      console.warn('[delivery-status] receipt with no message id and no watermark; dropping')
      return
    }

    const error =
      data.status === 'failed'
        ? [data.errorTitle, data.errorCode != null ? `(${data.errorCode})` : null]
            .filter(Boolean)
            .join(' ') || 'unknown'
        : null

    const matched = await createMessagesRepository(sql).recordDeliveryStatus(
      clinicId,
      data.channelMessageId,
      data.status,
      error,
    )

    if (!matched) {
      // A status for a message we never persisted (e.g. sent before this feature
      // shipped, or a manual send outside the bot). Nothing to attach it to.
      console.log(
        `[delivery-status] no outbound message for ${data.channel} id=${data.channelMessageId} (clinic ${clinicId}); status=${data.status} ignored`,
      )
      return
    }

    // A failed delivery is operationally actionable — surface it in the Error
    // Review area (Req 29) so the clinic learns its number stopped delivering.
    // Best-effort: a logging failure never fails the job.
    if (data.status === 'failed') {
      await createErrorReviewsRepository(sql)
        .create({
          clinicId,
          errorType: `${data.channel}_delivery_failure`,
          errorMessage: error ?? 'unknown',
          context: {
            channel: data.channel,
            channelMessageId: data.channelMessageId,
            recipient: data.recipientId,
            errorCode: data.errorCode,
          },
        })
        .catch((err) => console.error('[delivery-status] failed to log delivery failure:', err))
    }
  } finally {
    await sql.end()
  }
}
