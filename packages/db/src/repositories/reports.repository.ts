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
}

export interface ReportsRepository {
  /** Newest-first list of a clinic's generated reports (optionally capped). */
  listByClinic(clinicId: string, limit?: number): Promise<GeneratedReport[]>
  /** Single report (with html), clinic-scoped. Null when absent or foreign. */
  findById(clinicId: string, id: string): Promise<GeneratedReport | null>
  create(data: CreateGeneratedReportInput): Promise<GeneratedReport>
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
  }
}
