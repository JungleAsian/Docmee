// P18 (Gap #39 + Gap #35): Advanced analytics + conversation export.
//
// Aggregations beyond the basic metrics dashboard: resolution rate, conversation
// length, peak-hour heatmap, patient retention and bot effectiveness — plus the
// flat conversation export consumed by the Google Sheets sync.
import type { Sql } from '../client.js'

const num = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface AdvancedAnalytics {
  totalConversations: number
  /** Fraction (0..1) of conversations in range that reached 'resolved'. */
  resolutionRate: number
  /** Mean messages per conversation in range. */
  avgConversationLength: number
  /** Fraction (0..1) of conversations that were handed off to a human. */
  handoffRate: number
  /** Fraction (0..1) of conversations resolved by the bot with NO human handoff (bot effectiveness). */
  automationRate: number
  /** Fraction (0..1) of conversations where the bot answered from the knowledge base. */
  kbHitRate: number
  newPatients: number
  returningPatients: number
  /** Message volume by weekday (0=Sun) × hour (0–23), clinic-local. */
  peakHours: Array<{ dayOfWeek: number; hour: number; count: number }>
}

export interface ConversationExportRow {
  date: string
  patientName: string
  intent: string
  resolved: boolean
  appointmentBooked: boolean
}

export interface AnalyticsRepository {
  advanced(clinicId: string, from: string, to: string, timezone: string): Promise<AdvancedAnalytics>
  conversationExport(clinicId: string, sinceDays: number, timezone: string): Promise<ConversationExportRow[]>
}

export function createAnalyticsRepository(sql: Sql): AnalyticsRepository {
  return {
    async advanced(clinicId, from, to, timezone) {
      const tz = timezone || 'UTC'

      const [conv, length, retention, peak] = await Promise.all([
        sql<[{ total: string; resolved: string; handoff: string; automated: string; kbHit: string }]>`
          SELECT
            COUNT(*)                                                            AS total,
            COUNT(*) FILTER (WHERE status = 'resolved')                          AS resolved,
            COUNT(*) FILTER (WHERE status = 'handoff' OR assigned_to IS NOT NULL) AS handoff,
            COUNT(*) FILTER (
              WHERE status = 'resolved' AND status <> 'handoff' AND assigned_to IS NULL
            )                                                                    AS automated,
            COUNT(*) FILTER (WHERE metadata->>'kbHit' = 'true')                  AS kb_hit
          FROM conversations
          WHERE clinic_id = ${clinicId}
            AND created_at >= ${from}::timestamptz
            AND created_at <= ${to}::timestamptz
        `,
        sql<[{ avgLength: string | null }]>`
          SELECT COALESCE(AVG(cnt), 0) AS avg_length FROM (
            SELECT conversation_id, COUNT(*) AS cnt
            FROM conversation_messages
            WHERE clinic_id = ${clinicId}
              AND created_at >= ${from}::timestamptz
              AND created_at <= ${to}::timestamptz
            GROUP BY conversation_id
          ) per_conversation
        `,
        sql<[{ newPatients: string; returningPatients: string }]>`
          SELECT
            COUNT(*) FILTER (WHERE p.status = 'new')       AS new_patients,
            COUNT(*) FILTER (WHERE p.status = 'returning') AS returning_patients
          FROM patients p
          WHERE p.clinic_id = ${clinicId}
            AND EXISTS (
              SELECT 1 FROM conversations c
              WHERE c.patient_id = p.id
                AND c.clinic_id = p.clinic_id
                AND c.created_at >= ${from}::timestamptz
                AND c.created_at <= ${to}::timestamptz
            )
        `,
        sql<{ dow: string; hour: string; count: string }[]>`
          SELECT
            EXTRACT(DOW  FROM created_at AT TIME ZONE ${tz})::int AS dow,
            EXTRACT(HOUR FROM created_at AT TIME ZONE ${tz})::int AS hour,
            COUNT(*) AS count
          FROM conversation_messages
          WHERE clinic_id = ${clinicId}
            AND created_at >= ${from}::timestamptz
            AND created_at <= ${to}::timestamptz
          GROUP BY 1, 2
          ORDER BY 1, 2
        `,
      ])

      const total = num(conv[0]?.total)
      return {
        totalConversations: total,
        resolutionRate: total > 0 ? num(conv[0]?.resolved) / total : 0,
        avgConversationLength: Math.round(num(length[0]?.avgLength) * 10) / 10,
        handoffRate: total > 0 ? num(conv[0]?.handoff) / total : 0,
        automationRate: total > 0 ? num(conv[0]?.automated) / total : 0,
        kbHitRate: total > 0 ? num(conv[0]?.kbHit) / total : 0,
        newPatients: num(retention[0]?.newPatients),
        returningPatients: num(retention[0]?.returningPatients),
        peakHours: peak.map((r) => ({ dayOfWeek: num(r.dow), hour: num(r.hour), count: num(r.count) })),
      }
    },

    async conversationExport(clinicId, sinceDays, timezone) {
      const tz = timezone || 'UTC'
      const days = Math.max(1, Math.floor(sinceDays))
      const rows = await sql<
        { date: string; patientName: string; intent: string; resolved: boolean; appointmentBooked: boolean }[]
      >`
        SELECT
          to_char(c.created_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS date,
          COALESCE(p.full_name, '')                              AS patient_name,
          COALESCE(c.metadata->>'lastIntent', '')                AS intent,
          (c.status = 'resolved')                                AS resolved,
          EXISTS (
            SELECT 1 FROM appointments a
            WHERE a.conversation_id = c.id
              AND a.status IN ('confirmed', 'completed')
          )                                                      AS appointment_booked
        FROM conversations c
        LEFT JOIN patients p ON p.id = c.patient_id AND p.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId}
          AND c.created_at >= NOW() - (${days} || ' days')::interval
        ORDER BY c.created_at DESC
      `
      return rows.map((r) => ({
        date: r.date,
        patientName: r.patientName,
        intent: r.intent,
        resolved: r.resolved,
        appointmentBooked: r.appointmentBooked,
      }))
    },
  }
}
