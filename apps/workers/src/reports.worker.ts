// Consumes: reports queue (Gap #36 — automatic reports).
//
// An hourly tick fans out to every active clinic. Each clinic gets a DAILY report
// at its local 08:00 and a WEEKLY report on Monday at its local 09:00 — the local
// time gate is what makes the once-per-hour tick fire each report exactly once per
// clinic, without per-clinic cron rows. Reports are emailed (Resend) to the
// clinic's primary admin.
import {
  createServiceDbClient,
  createClinicsRepository,
  createUsersRepository,
  createMetricsRepository,
  createAppointmentsRepository,
  createReportsRepository,
  type Clinic,
  type ReportsRepository,
  type ReportType,
} from '@docmee/db'
import { sendEmail } from '@docmee/notifications'
import { type Job } from '@docmee/queue'

const DAILY_HOUR = 8
const WEEKLY_HOUR = 9
const MONDAY = 1

type ReportFrequency = 'daily' | 'weekly' | 'monthly'
interface ReportConfig {
  enabled: boolean
  frequency: ReportFrequency
  recipients: string[]
  format: 'html' | 'pdf' | 'csv'
  hourLocal: number
}

function readReportConfig(settings: Record<string, unknown> | null | undefined): ReportConfig {
  settings ??= {}
  const raw = settings['reports']
  const cfg = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const frequency = cfg['frequency'] === 'weekly' || cfg['frequency'] === 'monthly' ? cfg['frequency'] : 'daily'
  const recipients = Array.isArray(cfg['recipients'])
    ? cfg['recipients'].filter((r): r is string => typeof r === 'string' && r.includes('@')).slice(0, 20)
    : []
  const hour = typeof cfg['hourLocal'] === 'number' ? cfg['hourLocal'] : frequency === 'weekly' ? WEEKLY_HOUR : DAILY_HOUR
  const format = cfg['format'] === 'pdf' || cfg['format'] === 'csv' ? cfg['format'] : 'html'
  return {
    enabled: cfg['enabled'] !== false,
    frequency,
    recipients,
    format,
    hourLocal: Math.min(23, Math.max(0, Math.floor(hour))),
  }
}

interface LocalTime {
  hour: number
  /** 0=Sunday … 6=Saturday */
  dayOfWeek: number
}

/** Clinic-local hour + weekday for `now`, using the clinic's IANA timezone. */
export function localTimeIn(timezone: string, now: Date): LocalTime {
  const tz = timezone || 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0'
  const hour = Number(hourRaw) % 24
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour, dayOfWeek: dowMap[weekday] ?? 0 }
}

interface LocalDate { year: number; month: number; day: number }

function localDateIn(timezone: string, now: Date): LocalDate {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value ?? '1970'),
    month: Number(parts.find((part) => part.type === 'month')?.value ?? '1'),
    day: Number(parts.find((part) => part.type === 'day')?.value ?? '1'),
  }
}

function localDateKey(date: LocalDate): string {
  return `${date.year.toString().padStart(4, '0')}-${date.month.toString().padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`
}

function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() }
}

function startOfPreviousMonth(date: LocalDate): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 2, 1))
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: 1 }
}

/** Convert a clinic-local midnight to an instant without treating local dates as UTC. */
function localMidnight(timezone: string, date: LocalDate): Date {
  let guess = new Date(Date.UTC(date.year, date.month - 1, date.day))
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = formatter.formatToParts(guess)
    const actual = {
      year: Number(parts.find((part) => part.type === 'year')?.value ?? 0),
      month: Number(parts.find((part) => part.type === 'month')?.value ?? 0),
      day: Number(parts.find((part) => part.type === 'day')?.value ?? 0),
      hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0) % 24,
    }
    const targetMinutes = Date.UTC(date.year, date.month - 1, date.day) / 60_000
    const actualMinutes = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour) / 60_000
    const correction = actualMinutes - targetMinutes
    if (correction === 0) break
    guess = new Date(guess.getTime() - correction * 60_000)
  }
  return guess
}

const pct = (fraction: number) => `${Math.round(fraction * 100)}%`
const seconds = (s: number) => (s <= 0 ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`)

function dailyReportHtml(clinic: Clinic, data: DailyData): string {
  return `
    <h2>${clinic.name} — Daily report</h2>
    <p>Activity in the last 24 hours:</p>
    <ul>
      <li>Conversations: <b>${data.conversations}</b></li>
      <li>Messages: <b>${data.messages}</b></li>
      <li>Bot reply rate: <b>${pct(data.botReplyRate)}</b></li>
      <li>Appointments booked: <b>${data.bookings}</b></li>
      <li>Avg. response time: <b>${seconds(data.avgResponseSeconds)}</b></li>
    </ul>
  `
}

function weeklyReportHtml(clinic: Clinic, data: WeeklyData): string {
  const arrow = (cur: number, prev: number) => (cur >= prev ? '▲' : '▼')
  return `
    <h2>${clinic.name} — Weekly report</h2>
    <p>This week vs. the previous week:</p>
    <ul>
      <li>Conversations: <b>${data.conversationsThisWeek}</b> ${arrow(data.conversationsThisWeek, data.conversationsLastWeek)} (was ${data.conversationsLastWeek})</li>
      <li>Appointments booked: <b>${data.bookingsThisWeek}</b> ${arrow(data.bookingsThisWeek, data.bookingsLastWeek)} (was ${data.bookingsLastWeek})</li>
      <li>Bot reply rate: <b>${pct(data.botReplyRate)}</b></li>
    </ul>
  `
}

interface DailyData {
  conversations: number
  messages: number
  botReplyRate: number
  bookings: number
  avgResponseSeconds: number
}
interface WeeklyData {
  conversationsThisWeek: number
  conversationsLastWeek: number
  bookingsThisWeek: number
  bookingsLastWeek: number
  botReplyRate: number
}

interface ReportPayload {
  type: ReportType
  periodStart: Date
  periodEnd: Date
  subject: string
  html: string
  data: Record<string, unknown>
}

/**
 * Persist actionable, non-sensitive failure categories only. Provider responses
 * often echo recipient addresses, API keys, or SMTP credentials and must never
 * be copied into a clinic report or worker log.
 */
function redactedDeliveryDiagnostic(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : ''
  if (/(auth|credential|password|api.?key|unauthori[sz]ed|forbidden)/.test(message)) return 'provider_authentication_failed'
  if (/(recipient|address|mailbox|email)/.test(message)) return 'recipient_rejected'
  if (/(rate|quota|too many|429)/.test(message)) return 'provider_rate_limited'
  if (/(timeout|timed out|network|connect|econn)/.test(message)) return 'provider_unavailable'
  return 'provider_rejected_delivery'
}

/**
 * Delivers a report through BOTH channels: email it to the clinic admin (when a
 * recipient is known) and persist it so it shows up in the clinic panel's reports
 * list. The email is best-effort — a delivery failure is recorded as emailed=false
 * on the persisted row rather than dropping the report, so the panel copy always
 * survives. The persist itself is best-effort too (logged, never throws) so a
 * reports-table hiccup can't abort the rest of the clinic fan-out.
 */
async function deliverReport(
  reports: ReportsRepository,
  clinicId: string,
  recipient: string | null,
  payload: ReportPayload,
  scheduleKey: string,
): Promise<void> {
  try {
    const claimed = await reports.claimScheduled({
      clinicId,
      type: payload.type,
      periodStart: payload.periodStart.toISOString(),
      periodEnd: payload.periodEnd.toISOString(),
      subject: payload.subject,
      html: payload.html,
      data: payload.data,
      recipientEmail: recipient,
      emailed: false,
      scheduleKey,
    })
    if (!claimed || !recipient) return
    if (!await reports.claimEmailDelivery(claimed.id)) return
    try {
      await sendEmail({ to: recipient, subject: payload.subject, html: payload.html, idempotencyKey: scheduleKey })
      await reports.markEmailed(claimed.id, true)
    } catch (err) {
      const diagnostic = redactedDeliveryDiagnostic(err)
      await reports.markEmailed(claimed.id, false, diagnostic)
      console.error(`[reports] email failed for clinic ${clinicId} (${payload.type}): ${diagnostic}`)
    }
  } catch (err) {
    console.error(`[reports] claim/persist failed for clinic ${clinicId} (${payload.type}):`, err)
  }
}

export async function processReportsJob(_job: Job): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  const now = new Date()

  try {
    const clinics = createClinicsRepository(sql)
    const users = createUsersRepository(sql)
    const metrics = createMetricsRepository(sql)
    const appointments = createAppointmentsRepository(sql)
    const reports = createReportsRepository(sql)

    for (const clinic of await clinics.list()) {
      if (clinic.status !== 'active') continue
      const reportConfig = readReportConfig(clinic.settings)
      if (!reportConfig.enabled) continue
      const local = localTimeIn(clinic.timezone, now)
      // A single configured cadence is authoritative. `>=` lets the first tick
      // after a skipped DST hour generate the period; the database claim below
      // suppresses later ticks and the duplicated fall-back hour.
      const currentDate = localDateIn(clinic.timezone, now)
      const due = local.hour >= reportConfig.hourLocal
      const reportType: ReportType | null = reportConfig.frequency === 'daily' && due
        ? 'daily'
        : reportConfig.frequency === 'weekly' && due && local.dayOfWeek === MONDAY
          ? 'weekly'
          : reportConfig.frequency === 'monthly' && due && currentDate.day === 1
            ? 'monthly'
            : null
      if (!reportType) continue

      // A report is still generated + stored in the panel even with no admin email
      // on file; only the email half is skipped.
      const fallbackRecipient = await users.findPrimaryEmail(clinic.id)
      const recipients = reportConfig.recipients.length > 0 ? reportConfig.recipients : fallbackRecipient ? [fallbackRecipient] : []
      const deliveryRecipients = recipients.length > 0 ? recipients : [null]
      const dashboard = await metrics.dashboard(clinic.id, clinic.timezone)

      if (reportType === 'daily') {
        const periodEndDate = currentDate
        const periodStartDate = addLocalDays(currentDate, -1)
        const periodStart = localMidnight(clinic.timezone, periodStartDate)
        const periodEnd = localMidnight(clinic.timezone, periodEndDate)
        const bookings = await appointments.countCreatedBetween(clinic.id, periodStart.toISOString(), periodEnd.toISOString())
        const data: DailyData = {
          conversations: dashboard.conversationsToday,
          messages: dashboard.messagesToday,
          botReplyRate: dashboard.botReplyRate,
          bookings,
          avgResponseSeconds: dashboard.avgResponseSeconds,
        }
        const payload: ReportPayload = {
          type: 'daily',
          periodStart,
          periodEnd,
          subject: `${clinic.name}: daily report`,
          html: dailyReportHtml(clinic, data),
          data: { ...data, configuredRecipients: recipients, configuredFormat: reportConfig.format },
        }
        await Promise.all(deliveryRecipients.map((recipient) => deliverReport(
          reports, clinic.id, recipient, payload,
          `${clinic.id}:daily:${localDateKey(periodStartDate)}:${recipient ?? 'panel'}`,
        )))
      }

      if (reportType === 'weekly' || reportType === 'monthly') {
        const perDay = dashboard.conversationsPerDay
        const last7 = perDay.slice(-7).reduce((s, d) => s + d.count, 0)
        const prev7 = perDay.slice(-14, -7).reduce((s, d) => s + d.count, 0)
        const periodEndDate = currentDate
        const periodStartDate = reportType === 'weekly' ? addLocalDays(currentDate, -7) : startOfPreviousMonth(currentDate)
        const comparisonStartDate = reportType === 'weekly' ? addLocalDays(currentDate, -14) : startOfPreviousMonth(periodStartDate)
        const periodStart = localMidnight(clinic.timezone, periodStartDate)
        const periodEnd = localMidnight(clinic.timezone, periodEndDate)
        const comparisonStart = localMidnight(clinic.timezone, comparisonStartDate)
        const bookingsThisWeek = await appointments.countCreatedBetween(clinic.id, periodStart.toISOString(), periodEnd.toISOString())
        const bookingsLastWeek = await appointments.countCreatedBetween(clinic.id, comparisonStart.toISOString(), periodStart.toISOString())
        const data: WeeklyData = {
          conversationsThisWeek: last7,
          conversationsLastWeek: prev7,
          bookingsThisWeek,
          bookingsLastWeek,
          botReplyRate: dashboard.botReplyRate,
        }
        const payload: ReportPayload = {
          type: reportType,
          periodStart,
          periodEnd,
          subject: `${clinic.name}: ${reportType} report`,
          html: weeklyReportHtml(clinic, data),
          data: { ...data, configuredRecipients: recipients, configuredFormat: reportConfig.format, configuredFrequency: reportConfig.frequency },
        }
        await Promise.all(deliveryRecipients.map((recipient) => deliverReport(
          reports, clinic.id, recipient, payload,
          `${clinic.id}:${reportType}:${localDateKey(periodStartDate)}:${recipient ?? 'panel'}`,
        )))
      }
    }
  } finally {
    await sql.end()
  }
}
