import 'dotenv/config'

import {
  createWorker,
  licenseHeartbeatQueue,
  reportsQueue,
  sheetsSyncQueue,
  reviewRequestQueue,
} from '@docmee/queue'
import { RATE_LIMITS } from '@docmee/config'
import { releaseBuildId } from '@docmee/shared'
import { processConversationJob } from './conversation-processor.worker.js'
import { processDeliveryStatusJob } from './delivery-status.worker.js'
import { processTranscriptionJob } from './transcription-processor.worker.js'
import { processAgentJob } from './agent-processor.worker.js'
import { processSchedulingJob } from './scheduling-processor.worker.js'
import { processNotificationJob } from './notification-processor.worker.js'
import { processLicenseHeartbeatJob } from './license-heartbeat.worker.js'
import { processKbEmbedJob } from './kb-embed.worker.js'
import { processFollowUpJob } from './follow-up.worker.js'
import { processReportsJob } from './reports.worker.js'
import { processSheetsSyncJob } from './sheets-sync.worker.js'
import { processReviewRequestJob } from './review-request.worker.js'
import { processWorkflowRunJob } from './workflow-runner.worker.js'
import { runTimeoutChecks } from './timeout-monitor.js'
import { bootstrapReportsScheduler } from './reports.scheduler.js'
import { runCalendarSyncRetry } from './calendar-sync-retry.js'
import { startMediaCleanupScheduler } from './media-cleanup.js'
import { createServiceDbClient } from '@docmee/db'

export const conversationWorker = createWorker(
  'whatsapp.inbound',
  processConversationJob,
  RATE_LIMITS.WORKER_CONCURRENCY_CONVERSATION,
)
// WhatsApp delivery-status receipts (Req 3): record sent/delivered/read/failed.
export const deliveryStatusWorker = createWorker(
  'whatsapp.status',
  processDeliveryStatusJob,
  RATE_LIMITS.WORKER_CONCURRENCY_CONVERSATION,
)
// Messenger delivery/read receipts (Req 33): same processor, resolved by Page id.
export const messengerStatusWorker = createWorker(
  'messenger.status',
  processDeliveryStatusJob,
  RATE_LIMITS.WORKER_CONCURRENCY_CONVERSATION,
)
// Instagram delivery/read receipts (Req 34): same processor, resolved by IG account id.
export const instagramStatusWorker = createWorker(
  'instagram.status',
  processDeliveryStatusJob,
  RATE_LIMITS.WORKER_CONCURRENCY_CONVERSATION,
)
export const transcriptionWorker = createWorker(
  'transcription',
  processTranscriptionJob,
  RATE_LIMITS.WORKER_CONCURRENCY_TRANSCRIPTION,
)
export const agentWorker = createWorker(
  'agent',
  processAgentJob,
  RATE_LIMITS.WORKER_CONCURRENCY_AGENT,
)
export const schedulingWorker = createWorker(
  'scheduling',
  processSchedulingJob,
  RATE_LIMITS.WORKER_CONCURRENCY_SCHEDULING,
)
export const notificationWorker = createWorker(
  'notification',
  processNotificationJob,
  RATE_LIMITS.WORKER_CONCURRENCY_NOTIFICATION,
)
export const licenseHeartbeatWorker = createWorker(
  'license.heartbeat',
  processLicenseHeartbeatJob,
  1,
)
export const kbEmbedWorker = createWorker('kb-embed', processKbEmbedJob, 3)
export const followUpWorker = createWorker('follow-up', processFollowUpJob, 5)
// P18 — Phase 3 scheduled workers (reports, Sheets export, review requests).
export const reportsWorker = createWorker('reports', processReportsJob, 1)
export const sheetsSyncWorker = createWorker('sheets-sync', processSheetsSyncJob, 1)
export const reviewRequestWorker = createWorker('review-request', processReviewRequestJob, 1)
// Rev 3 — N8N-style automation workflows: walk the active workflow graph on trigger.
export const workflowRunWorker = createWorker('workflow-run', processWorkflowRunJob, 3)

// Timeout monitor: detects secretary inactivity + stale conversations every 5 min.
const TIMEOUT_CHECK_INTERVAL_MS = 5 * 60 * 1000
export const timeoutMonitor = setInterval(() => {
  void runTimeoutChecks()
}, TIMEOUT_CHECK_INTERVAL_MS)
// Don't keep the process alive solely for the monitor.
if (typeof timeoutMonitor.unref === 'function') timeoutMonitor.unref()

// License heartbeat: enqueue a full-audit tick every 30 min. The worker checks
// each active clinic's license and fires LICENSE_EXPIRING / LICENSE_EXPIRED
// alerts — it never deactivates a clinic (licensing must not interrupt a live clinic).
const LICENSE_HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000
export const licenseHeartbeatScheduler = setInterval(() => {
  void licenseHeartbeatQueue
    .add('audit', {})
    .catch((err) => console.error('[license-heartbeat] failed to enqueue tick:', err))
}, LICENSE_HEARTBEAT_INTERVAL_MS)
if (typeof licenseHeartbeatScheduler.unref === 'function') licenseHeartbeatScheduler.unref()

// Calendar sync retry: the Docmee appointment row is always saved regardless of
// Google Calendar state; this sweep catches up any row still flagged
// calendar_sync_pending (no calendar was connected yet, or a live API call
// failed) once a working Calendar connection exists — see calendar-sync-retry.ts.
const CALENDAR_SYNC_RETRY_INTERVAL_MS = 10 * 60 * 1000
export const calendarSyncRetryScheduler = setInterval(() => {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  void runCalendarSyncRetry(sql)
    .catch((err) => console.error('[calendar-sync-retry] tick failed:', err))
    .finally(() => {
      void sql.end()
    })
}, CALENDAR_SYNC_RETRY_INTERVAL_MS)
if (typeof calendarSyncRetryScheduler.unref === 'function') calendarSyncRetryScheduler.unref()

// Media cleanup retry: atomically claims due/stale storage rows and reconciles
// their private S3 objects every five minutes. The consumer remains idle when
// media storage is not configured.
export const mediaCleanupScheduler = startMediaCleanupScheduler()

// P18 — Reports use a durable BullMQ scheduler. Sheets and review requests keep
// their existing process-local cadence pending their own scheduler work.
void bootstrapReportsScheduler(reportsQueue).catch((err) => console.error('[reports] durable scheduler bootstrap failed:', err))
// An hourly tick drives Sheets sync and
// review-request workers; each worker gates on the clinic's local time / state so
// the hourly cadence yields exactly the intended per-clinic schedule.
const HOURLY_MS = 60 * 60 * 1000
export const phase3Scheduler = setInterval(() => {
  void sheetsSyncQueue.add('tick', {}).catch((err) => console.error('[sheets-sync] enqueue failed:', err))
  void reviewRequestQueue.add('tick', {}).catch((err) => console.error('[review-request] enqueue failed:', err))
}, HOURLY_MS)
if (typeof phase3Scheduler.unref === 'function') phase3Scheduler.unref()

console.log(`[workers] all 14 workers registered and listening (build ${releaseBuildId()})`)

// CRE-55: on PM2 reload/deploy, stop the schedulers and let BullMQ workers finish
// their in-flight jobs (worker.close() waits for active jobs) before exit, so a
// deploy never kills a job mid-execution.
const allWorkers = [
  conversationWorker, deliveryStatusWorker, messengerStatusWorker, instagramStatusWorker,
  transcriptionWorker, agentWorker, schedulingWorker, notificationWorker,
  licenseHeartbeatWorker, kbEmbedWorker, followUpWorker, reportsWorker,
  sheetsSyncWorker, reviewRequestWorker, workflowRunWorker,
]
let shuttingDown = false
async function shutdownWorkers(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[workers] ${signal} received — draining ${allWorkers.length} workers…`)
  clearInterval(timeoutMonitor)
  clearInterval(licenseHeartbeatScheduler)
  clearInterval(phase3Scheduler)
  clearInterval(calendarSyncRetryScheduler)
  clearInterval(mediaCleanupScheduler)
  await Promise.allSettled(allWorkers.map((w) => w.close()))
  console.log('[workers] shutdown complete')
  process.exit(0)
}
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    void shutdownWorkers(sig)
  })
}
