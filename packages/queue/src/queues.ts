import { createQueue } from './providers/bullmq.js'

export const whatsappInboundQueue = createQueue('whatsapp.inbound')
// Delivery-status receipts (sent/delivered/read/failed) from Meta's `statuses`
// webhook (Req 3). Separate from inbound messages so a status backlog never
// blocks patient messages and vice-versa.
export const whatsappStatusQueue = createQueue('whatsapp.status')
// Messenger delivery/read receipts (Req 33). Meta posts `delivery` (carries the
// outbound mids) and `read` (a watermark) events on the Page webhook; the route
// fans them here so they never block inbound patient messages.
export const messengerStatusQueue = createQueue('messenger.status')
// Instagram delivery/read receipts (Req 34). Instagram DM rides the Messenger
// Send API; Meta posts `read` (a watermark) and — where available — `delivery`
// events on the instagram webhook. The route fans them here so they never block
// inbound patient DMs.
export const instagramStatusQueue = createQueue('instagram.status')
export const transcriptionQueue = createQueue('transcription')
export const agentQueue = createQueue('agent')
export const schedulingQueue = createQueue('scheduling')
export const notificationQueue = createQueue('notification')
export const licenseHeartbeatQueue = createQueue('license.heartbeat')
export const kbEmbedQueue = createQueue('kb-embed')
export const followUpQueue = createQueue('follow-up')
// P18 — Phase 3 scheduled jobs.
export const reportsQueue = createQueue('reports')
export const sheetsSyncQueue = createQueue('sheets-sync')
export const reviewRequestQueue = createQueue('review-request')
