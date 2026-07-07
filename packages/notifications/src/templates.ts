import type { NotificationType } from './notification-types.js'

export interface NotificationEmail {
  subject: string
  html: string
}

/** Minimal HTML-escape for interpolated data (these are internal alert emails). */
function esc(value: unknown): string {
  return JSON.stringify(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function details(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return ''
  return `<pre style="background:#f5f5f5;padding:8px;border-radius:4px">${esc(data)}</pre>`
}

/** Proper-noun label for a Meta channel, defaulting to WhatsApp (back-compat). */
function channelLabel(channel: unknown): string {
  if (channel === 'messenger') return 'Messenger'
  if (channel === 'instagram') return 'Instagram'
  return 'WhatsApp'
}

/**
 * Build the subject + HTML body for a notification. Keyed by every NotificationType
 * (the Record type enforces exhaustiveness — a new type won't compile until added).
 */
export function buildNotificationEmail(
  type: NotificationType,
  data: Record<string, unknown>,
): NotificationEmail {
  const templates: Record<NotificationType, NotificationEmail> = {
    emergency: {
      subject: '🚨 EMERGENCY — Patient needs immediate attention',
      html: `<h2>Emergency Alert</h2><p>A patient has reported an emergency and needs immediate assistance.</p>${details(data)}`,
    },
    human_handoff_requested: {
      subject: '👤 Patient requested human assistance',
      html: `<h2>Human Handoff</h2><p>A patient has requested to speak with a human team member.</p>${details(data)}`,
    },
    bot_failed: {
      subject: '⚠️ Bot error — patient needs attention',
      html: `<h2>Bot Error</h2><p>The bot encountered an error. Please respond to this patient manually.</p>${details(data)}`,
    },
    upset_patient: {
      subject: '😟 Upset patient — please step in',
      html: `<h2>Upset Patient</h2><p>A patient appears upset or frustrated. The bot has paused and a human should take over.</p>${details(data)}`,
    },
    secretary_escalated: {
      subject: '🔼 Escalation — unattended urgent alert',
      html: `<h2>Escalation</h2><p>An urgent alert was not acknowledged in time and has been escalated to you.</p>${details(data)}`,
    },
    new_patient: {
      subject: '🆕 New patient registered',
      html: `<h2>New Patient</h2><p>A new patient has contacted the clinic.</p>${details(data)}`,
    },
    booking_confirmed: {
      subject: '📅 Appointment confirmed',
      html: `<h2>Booking Confirmed</h2><p>An appointment has been scheduled.</p>${details(data)}`,
    },
    booking_cancelled: {
      subject: '❌ Appointment cancelled',
      html: `<h2>Booking Cancelled</h2><p>An appointment has been cancelled.</p>${details(data)}`,
    },
    booking_rescheduled: {
      subject: '🔄 Appointment rescheduled',
      html: `<h2>Booking Rescheduled</h2><p>An appointment has been rescheduled.</p>${details(data)}`,
    },
    opted_out: {
      subject: '🚫 Patient opted out',
      html: `<h2>STOP Received</h2><p>A patient has opted out of messaging.</p>${details(data)}`,
    },
    appointment_reminder: {
      subject: '⏰ Appointment reminder due',
      html: `<h2>Appointment Reminder</h2><p>An upcoming appointment needs a reminder or confirmation.</p>${details(data)}`,
    },
    low_review_score: {
      subject: 'Low patient review score',
      html: `<h2>Low Review Score</h2><p>A patient replied with a low review score. Please review the conversation before sending a public review request.</p>${details(data)}`,
    },
    conversation_assigned: {
      subject: '📨 Conversation assigned to you',
      html: `<h2>Conversation Assigned</h2><p>A conversation has been assigned to you.</p>${details(data)}`,
    },
    conversation_resolved: {
      subject: '✅ Conversation resolved',
      html: `<h2>Resolved</h2><p>A conversation has been marked as resolved.</p>${details(data)}`,
    },
    stale_conversation: {
      subject: '⏰ Conversation needs attention',
      html: `<h2>Stale Conversation</h2><p>A conversation has had no reply for over 30 minutes.</p>${details(data)}`,
    },
    secretary_timeout: {
      subject: '⏰ Secretary inactive — patient waiting',
      html: `<h2>Secretary Timeout</h2><p>A conversation in human handoff has had no response for 10 minutes.</p>${details(data)}`,
    },
    meta_token_expiring: {
      subject: `⚠️ ${channelLabel(data['channel'])} token expiring soon`,
      html: `<h2>Token Expiry Warning</h2><p>Your ${channelLabel(data['channel'])} access token expires in less than 7 days. Please renew it in the Meta Developer Portal.</p>${details(data)}`,
    },
    daily_summary: {
      subject: '📊 Daily summary',
      html: `<h2>Daily Summary</h2>${details(data)}`,
    },
    kb_miss_threshold: {
      subject: '📚 High KB miss rate detected',
      html: `<h2>KB Miss Alert</h2><p>More than 5 knowledge base misses in the last hour. Consider adding new KB entries.</p>${details(data)}`,
    },
    license_expiring: {
      subject: '⚠️ License expiring soon',
      html: `<h2>License Warning</h2><p>Your Docmee license expires soon. Please renew to avoid service interruption.</p>${details(data)}`,
    },
    license_expired: {
      subject: '🔴 License expired',
      html: `<h2>License Expired</h2><p>Your Docmee license has expired. New clinic activations are blocked. Existing clinics continue running.</p>${details(data)}`,
    },
  }

  return templates[type]
}
