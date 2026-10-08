import { createServiceDbClient, createScheduledMessagesRepository } from '@docmee/db'
import { createWorker, scheduledMessagesQueue } from '@docmee/queue'
import { processScheduledMessageJob } from './scheduled-messages.worker.js'

export async function reconcileScheduledMessages(): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const pending = await createScheduledMessagesRepository(sql).reconcile()
    for (const message of pending) {
      await scheduledMessagesQueue.add('deliver', { clinicId: message.clinicId, messageId: message.id, version: message.version }, {
        jobId: `scheduled-${message.id}-v${message.version}`, attempts: 1, removeOnComplete: true, removeOnFail: true,
      })
    }
  } finally { await sql.end() }
}
export function startScheduledMessagesRuntime() {
  if (process.env['SCHEDULED_MESSAGES_WORKER_ENABLED'] !== 'true') return null
  const worker = createWorker('scheduled-messages', processScheduledMessageJob, 1)
  let reconciling = false
  const tick = async () => {
    if (reconciling) return
    reconciling = true
    try { await reconcileScheduledMessages() } catch { console.error('[scheduled-messages] reconciliation failed; durable rows retained') } finally { reconciling = false }
  }
  void tick()
  const timer = setInterval(() => { void tick() }, 60_000)
  timer.unref()
  return { worker, timer }
}
