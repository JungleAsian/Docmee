import { z } from 'zod'
import { createServiceDbClient, createScheduledMessagesRepository, type ScheduledMessage, type ScheduledMessagesRepository } from '@docmee/db'
import { scheduledDeliveryTimeReason, scheduledTextWindowOpen } from '@docmee/shared'
import type { Job } from '@docmee/queue'
import { loadScheduledContext } from '../../api/src/lib/scheduled-message-context.js'
import { sendWhatsAppText, sendWhatsAppTemplate } from '../../api/src/lib/channel-send.js'
import { readMetaToken } from './meta-token.js'

export const ScheduledMessageJobSchema = z.object({ clinicId: z.string().min(1), messageId: z.string().min(1), version: z.number().int().positive() }).strict()
export type ScheduledMessageJob = z.infer<typeof ScheduledMessageJobSchema>
type DeliveryRepository = Pick<ScheduledMessagesRepository, 'claim' | 'outcome' | 'confirmed'>
export interface ScheduledDeliveryContext {
  reason: string | null; lastInboundAt: string | null; content: string
  account: { accountId: string; accessTokenEnc: string | null } | null
  template: { name: string; language: string } | null
}
export async function deliverScheduledMessage(
  data: ScheduledMessageJob,
  repository: DeliveryRepository,
  load: (message: ScheduledMessage) => Promise<ScheduledDeliveryContext>,
  send: (message: ScheduledMessage, context: ScheduledDeliveryContext) => Promise<string | null>,
  now?: number,
): Promise<void> {
  const message = await repository.claim(data.clinicId, data.messageId, data.version)
  if (!message) return // cancel/edit/duplicate/early wakeup: DB is authoritative.
  const timing = scheduledDeliveryTimeReason(message.scheduledAt, now ?? Date.now())
  if (timing) { await repository.outcome(message, 'blocked', timing); return }
  let context: ScheduledDeliveryContext
  try { context = await load(message) } catch { await repository.outcome(message, 'failed', 'revalidation_failed'); return }
  const sendAt = now ?? Date.now()
  const reason = context.reason ?? scheduledDeliveryTimeReason(message.scheduledAt, sendAt)
    ?? (message.kind === 'text' && !scheduledTextWindowOpen(context.lastInboundAt, sendAt) ? 'window_expired' : null)
  if (reason) { await repository.outcome(message, 'blocked', reason); return }
  let providerMessageId: string | null
  try { providerMessageId = await send(message, context) } catch {
    // Adapter errors cannot prove nonacceptance (e.g. timeout after Meta accepted).
    // Persist uncertainty and return; neither BullMQ nor DB reconciliation may resend.
    await repository.outcome(message, 'delivery_unknown', 'provider_outcome_unknown'); return
  }
  if (!providerMessageId) { await repository.outcome(message, 'delivery_unknown', 'provider_id_missing'); return }
  try { await repository.confirmed(message, providerMessageId, message.kind === 'text' ? message.content! : context.content) } catch {
    await repository.outcome(message, 'delivery_unknown', 'confirmation_persistence_unknown')
  }
}
export async function processScheduledMessageJob(job: Job): Promise<void> {
  // Defense in depth: manually enqueued jobs cannot bypass the worker opt-in.
  if (process.env['SCHEDULED_MESSAGES_WORKER_ENABLED'] !== 'true') return
  const data = ScheduledMessageJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    await deliverScheduledMessage(data, createScheduledMessagesRepository(sql), (message) => loadScheduledContext(sql, { ...message, expected: message }), async (message, context) => {
      const token = readMetaToken(context.account?.accessTokenEnc)
      if (!context.account || !token) throw new Error('scheduled_account_unavailable')
      return message.kind === 'text'
        ? sendWhatsAppText(context.account.accountId, token, message.recipient, message.content!)
        : sendWhatsAppTemplate(context.account.accountId, token, message.recipient, context.template!.name, context.template!.language)
    })
  } finally { await sql.end() }
}
