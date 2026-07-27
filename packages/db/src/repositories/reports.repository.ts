// Req 37 — Automatic reports. Persists each scheduled report the reports worker
// generates so the clinic panel can list and open them (the "panel" delivery
// channel alongside email). Pure CRUD on the generated_reports table.
import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { GeneratedReport, ReportType } from '../types/index.js'

export interface CreateGeneratedReportInput {
  clinicId: string
  type: ReportType
  periodStart: string
  periodEnd: string
  subject: string
  html: string
  data?: Record<string, unknown>
  recipientEmail?: string | null
  emailed?: boolean
  /** Deterministic clinic/period/recipient key used to make scheduled delivery idempotent. */
  scheduleKey?: string | null
}

export interface ReportsRepository {
  /** Newest-first list of a clinic's generated reports (optionally capped). */
  listByClinic(clinicId: string, limit?: number): Promise<GeneratedReport[]>
  /** Single report (with html), clinic-scoped. Null when absent or foreign. */
  findById(clinicId: string, id: string): Promise<GeneratedReport | null>
  create(data: CreateGeneratedReportInput): Promise<GeneratedReport>
  /** Create or retrieve the one durable row for a scheduled clinic/period/recipient delivery. */
  claimScheduled(data: CreateGeneratedReportInput & { scheduleKey: string }): Promise<GeneratedReport | null>
  /** Atomically reserve one pending delivery attempt for an already claimed report. */
  claimEmailDelivery(id: string, claimOwner?: string | null): Promise<boolean>
  /** Finish an email attempt without retaining provider responses or credentials. */
  markEmailed(id: string, emailed: boolean, deliveryDiagnostic?: string | null): Promise<void>
  /** Archive older failed rows only after the caller has successfully delivered a controlled retry. */
  clearHistoricalFailures(clinicId: string, successfulReportId: string): Promise<number>
}

const DEFAULT_LIMIT = 50

export function createReportsRepository(sql: Sql): ReportsRepository {
  return {
    async listByClinic(clinicId, limit = DEFAULT_LIMIT) {
      const cap = Math.min(200, Math.max(1, Math.floor(limit)))
      return sql<GeneratedReport[]>`
        SELECT id, clinic_id, type, period_start, period_end, subject, data,
               recipient_email, emailed, created_at
        FROM generated_reports
        WHERE clinic_id = ${clinicId}
          AND cleared_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${cap}
      `
    },

    async findById(clinicId, id) {
      const rows = await sql<GeneratedReport[]>`
        SELECT * FROM generated_reports
        WHERE clinic_id = ${clinicId} AND id = ${id}
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async create(data) {
      const rows = await sql<GeneratedReport[]>`
        INSERT INTO generated_reports
          (clinic_id, type, period_start, period_end, subject, html, data, recipient_email, emailed)
        VALUES (
          ${data.clinicId},
          ${data.type},
          ${data.periodStart},
          ${data.periodEnd},
          ${data.subject},
          ${data.html},
          ${sql.json(toJson(data.data ?? {}))},
          ${data.recipientEmail ?? null},
          ${data.emailed ?? false}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async claimScheduled(data) {
      const rows = await sql<GeneratedReport[]>`
        INSERT INTO generated_reports
          (clinic_id, type, period_start, period_end, subject, html, data, recipient_email, emailed, schedule_key)
        VALUES (
          ${data.clinicId},
          ${data.type},
          ${data.periodStart},
          ${data.periodEnd},
          ${data.subject},
          ${data.html},
          ${sql.json(toJson(data.data ?? {}))},
          ${data.recipientEmail ?? null},
          ${data.emailed ?? false},
          ${data.scheduleKey}
        )
        ON CONFLICT (schedule_key) WHERE schedule_key IS NOT NULL DO NOTHING
        RETURNING *
      `
      if (rows[0]) return rows[0]
      const existing = await sql<GeneratedReport[]>`
        SELECT * FROM generated_reports
        WHERE schedule_key = ${data.scheduleKey}
        LIMIT 1
      `
      return existing[0] ?? null
    },

    async markEmailed(id, emailed, deliveryDiagnostic = null) {
      await sql`
        UPDATE generated_reports
        SET emailed = ${emailed},
            delivery_status = ${emailed ? 'sent' : 'failed'},
            delivery_diagnostic = ${emailed ? null : deliveryDiagnostic},
            delivery_claimed_at = NULL,
            delivery_claim_owner = NULL
        WHERE id = ${id}
      `
    },

    async claimEmailDelivery(id, claimOwner = null) {
      const rows = await sql<{ id: string }[]>`
        UPDATE generated_reports
        SET delivery_status = 'sending',
            delivery_claimed_at = NOW(),
            delivery_claim_owner = ${claimOwner},
            delivery_attempts = delivery_attempts + 1
        WHERE id = ${id}
          AND (
            (
              ${claimOwner}::text IS NOT NULL
              AND delivery_claim_owner = ${claimOwner}
            )
            OR delivery_status IN ('pending', 'failed')
            OR (
              delivery_status = 'sending'
              AND (
                delivery_claimed_at IS NULL
                OR delivery_claimed_at < NOW() - INTERVAL '5 minutes'
              )
            )
          )
        RETURNING id
      `
      return rows.length === 1
    },

    async clearHistoricalFailures(clinicId, successfulReportId) {
      const rows = await sql<{ id: string }[]>`
        UPDATE generated_reports
        SET cleared_at = NOW()
        WHERE clinic_id = ${clinicId}
          AND id <> ${successfulReportId}
          AND delivery_status = 'failed'
          AND cleared_at IS NULL
        RETURNING id
      `
      return rows.length
    },
  }
}
