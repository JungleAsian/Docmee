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

function readReportConfig(settings: Record<string, unknown>): ReportConfig {
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
  }).formatToParts(now)
  const hourRaw = parts.find((p) => p.type === 'hour')?.value ?? '0'
  const hour = Number(hourRaw) % 24
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return { hour, dayOfWeek: dowMap[weekday] ?? 0 }
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
): Promise<void> {
  let emailed = false
  if (recipient) {
    try {
      await sendEmail({ to: recipient, subject: payload.subject, html: payload.html })
      emailed = true
    } catch (err) {
      console.error(`[reports] email failed for clinic ${clinicId} (${payload.type}):`, err)
    }
  }
  try {
    await reports.create({
      clinicId,
      type: payload.type,
      periodStart: payload.periodStart.toISOString(),
      periodEnd: payload.periodEnd.toISOString(),
      subject: payload.subject,
      html: payload.html,
      data: payload.data,
      recipientEmail: recipient,
      emailed,
    })
  } catch (err) {
    console.error(`[reports] persist failed for clinic ${clinicId} (${payload.type}):`, err)
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
      const wantDaily = reportConfig.frequency === 'daily' && local.hour === reportConfig.hourLocal
      const wantWeekly = reportConfig.frequency === 'weekly' && local.dayOfWeek === MONDAY && local.hour === reportConfig.hourLocal
      const wantMonthly = reportConfig.frequency === 'monthly' && now.getUTCDate() === 1 && local.hour === reportConfig.hourLocal
      if (!wantDaily && !wantWeekly && !wantMonthly) continue

      // A report is still generated + stored in the panel even with no admin email
      // on file; only the email half is skipped.
      const fallbackRecipient = await users.findPrimaryEmail(clinic.id)
      const recipients = reportConfig.recipients.length > 0 ? reportConfig.recipients : fallbackRecipient ? [fallbackRecipient] : []
      const primaryRecipient = recipients[0] ?? null
      const dashboard = await metrics.dashboard(clinic.id, clinic.timezone)

      if (wantDaily) {
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        const bookings = await appointments.countCreatedBetween(clinic.id, dayAgo.toISOString(), now.toISOString())
        const data: DailyData = {
          conversations: dashboard.conversationsToday,
          messages: dashboard.messagesToday,
          botReplyRate: dashboard.botReplyRate,
          bookings,
          avgResponseSeconds: dashboard.avgResponseSeconds,
        }
        await deliverReport(reports, clinic.id, primaryRecipient, {
          type: 'daily',
          periodStart: dayAgo,
          periodEnd: now,
          subject: `${clinic.name}: daily report`,
          html: dailyReportHtml(clinic, data),
          data: { ...data, configuredRecipients: recipients, configuredFormat: reportConfig.format },
        })
      }

      if (wantWeekly || wantMonthly) {
        const perDay = dashboard.conversationsPerDay
        const last7 = perDay.slice(-7).reduce((s, d) => s + d.count, 0)
        const prev7 = perDay.slice(-14, -7).reduce((s, d) => s + d.count, 0)
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)
        const bookingsThisWeek = await appointments.countCreatedBetween(clinic.id, weekAgo.toISOString(), now.toISOString())
        const bookingsLastWeek = await appointments.countCreatedBetween(clinic.id, twoWeeksAgo.toISOString(), weekAgo.toISOString())
        const data: WeeklyData = {
          conversationsThisWeek: last7,
          conversationsLastWeek: prev7,
          bookingsThisWeek,
          bookingsLastWeek,
          botReplyRate: dashboard.botReplyRate,
        }
        await deliverReport(reports, clinic.id, primaryRecipient, {
          type: wantMonthly ? 'monthly' : 'weekly',
          periodStart: weekAgo,
          periodEnd: now,
          subject: `${clinic.name}: ${wantMonthly ? 'monthly' : 'weekly'} report`,
          html: weeklyReportHtml(clinic, data),
          data: { ...data, configuredRecipients: recipients, configuredFormat: reportConfig.format, configuredFrequency: reportConfig.frequency },
        })
      }
    }
  } finally {
    await sql.end()
  }
}
