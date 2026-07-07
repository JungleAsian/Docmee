// Screen 10 (Channels & integrations) — pure derivation of a per-service connection
// status from a clinic record, so the overview can show every operational state
// (connected / pending / disconnected / token-expiring / token-expired) plus the
// concrete validation issues (missing webhook token, missing id, …) without any
// service-specific logic living in the component.
//
// WhatsApp config lives on channel_accounts (not the clinic row) and is not exposed
// to the panel, so it is presented separately as an informational card; the four
// services modelled here all carry per-clinic config on the clinic record.
import type { Clinic, ClinicSettings } from './types'

export type ServiceKey = 'messenger' | 'instagram' | 'calendar' | 'sheets'

// Ordered worst → best so a card can pick the most severe meaning quickly.
export type ServiceStatus = 'expired' | 'expiring' | 'pending' | 'disconnected' | 'connected'

// Concrete configuration gaps surfaced as a checklist on the card.
export type ServiceIssue =
  | 'missing_page_id'
  | 'missing_account_id'
  | 'missing_verify_token'
  | 'missing_spreadsheet'
  | 'calendar_required'

export interface TokenExpiry {
  date: string // ISO (YYYY-MM-DD or full)
  daysLeft: number
  state: 'ok' | 'expiring' | 'expired'
}

export interface ServiceCard {
  key: ServiceKey
  status: ServiceStatus
  /** True once the service has been enabled/configured (drives connected vs disconnected). */
  enabled: boolean
  issues: ServiceIssue[]
  tokenExpiry?: TokenExpiry
  webhookUrl?: string
}

const DAY = 24 * 60 * 60 * 1000
/** Meta tokens are flagged this many days before they lapse (Req 19). */
export const TOKEN_WARN_DAYS = 14

/** Classify a token expiry date against `now` (ms). Returns null for an empty date. */
export function classifyExpiry(dateIso: string | undefined, now: number): TokenExpiry | null {
  if (!dateIso) return null
  const ts = Date.parse(dateIso)
  if (Number.isNaN(ts)) return null
  const daysLeft = Math.ceil((ts - now) / DAY)
  const state = daysLeft < 0 ? 'expired' : daysLeft <= TOKEN_WARN_DAYS ? 'expiring' : 'ok'
  return { date: dateIso, daysLeft, state }
}

// A Meta channel (Messenger / Instagram): enabled + an id + a webhook verify token,
// then graded by token expiry. Missing pieces make it `pending` with an issue list.
function metaChannel(
  key: 'messenger' | 'instagram',
  opts: {
    enabled: boolean
    id: string | null | undefined
    verifyToken: string | null | undefined
    expiry: string | undefined
    webhookUrl: string
    missingIdIssue: ServiceIssue
    now: number
  },
): ServiceCard {
  const { enabled, id, verifyToken, expiry, webhookUrl, missingIdIssue, now } = opts
  if (!enabled) {
    return { key, status: 'disconnected', enabled: false, issues: [], webhookUrl }
  }
  const issues: ServiceIssue[] = []
  if (!id) issues.push(missingIdIssue)
  if (!verifyToken) issues.push('missing_verify_token')
  const tokenExpiry = classifyExpiry(expiry, now) ?? undefined
  let status: ServiceStatus
  if (issues.length > 0) status = 'pending'
  else if (tokenExpiry?.state === 'expired') status = 'expired'
  else if (tokenExpiry?.state === 'expiring') status = 'expiring'
  else status = 'connected'
  return { key, status, enabled: true, issues, tokenExpiry, webhookUrl }
}

export interface ChannelStatusOptions {
  /** API base, used to render each channel's webhook URL. */
  apiBase: string
  /** Current time in ms (passed in — modules must not call Date.now directly). */
  now: number
}

/** Derive the status card for every modelled service of a clinic. */
export function channelCards(clinic: Clinic, { apiBase, now }: ChannelStatusOptions): ServiceCard[] {
  const settings = clinic.settings as ClinicSettings

  const messenger = metaChannel('messenger', {
    enabled: Boolean(clinic.messengerEnabled),
    id: clinic.messengerPageId,
    verifyToken: clinic.messengerWebhookVerifyToken,
    expiry: settings.messengerTokenExpiresAt,
    webhookUrl: `${apiBase}/webhook/messenger`,
    missingIdIssue: 'missing_page_id',
    now,
  })

  const instagram = metaChannel('instagram', {
    enabled: Boolean(clinic.instagramEnabled),
    id: clinic.instagramAccountId,
    verifyToken: clinic.instagramWebhookVerifyToken,
    expiry: settings.instagramTokenExpiresAt,
    webhookUrl: `${apiBase}/webhook/instagram`,
    missingIdIssue: 'missing_account_id',
    now,
  })

  // Google Calendar — connected once OAuth tokens are stored (settings.googleCalendar).
  const calendarConnected = Boolean(settings.googleCalendar)
  const calendar: ServiceCard = {
    key: 'calendar',
    status: calendarConnected ? 'connected' : 'disconnected',
    enabled: calendarConnected,
    issues: [],
  }

  // Google Sheets — opt-in CRM export; reuses the Google connection.
  const sheets = settings.googleSheets ?? {}
  let sheetsCard: ServiceCard
  if (!sheets.enabled) {
    sheetsCard = { key: 'sheets', status: 'disconnected', enabled: false, issues: [] }
  } else {
    const issues: ServiceIssue[] = []
    if (!calendarConnected) issues.push('calendar_required')
    if (!sheets.spreadsheetId) issues.push('missing_spreadsheet')
    sheetsCard = {
      key: 'sheets',
      status: issues.length > 0 ? 'pending' : 'connected',
      enabled: true,
      issues,
    }
  }

  return [messenger, instagram, calendar, sheetsCard]
}
