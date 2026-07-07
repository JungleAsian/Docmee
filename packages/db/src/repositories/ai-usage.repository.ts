import type { Sql } from '../client.js'

/** Aggregated AI spend for one clinic (powers the Admin Studio usage dashboard). */
export interface ClinicUsageSummary {
  clinicId: string
  totalCostUsd: number
  totalTokens: number
  promptTokens: number
  completionTokens: number
  eventCount: number
  /** Per-model breakdown, highest spend first. */
  byModel: Array<{ model: string; costUsd: number; totalTokens: number; eventCount: number }>
}

/** One row of the platform-wide usage breakdown (admin only). */
export interface ClinicUsageRow {
  clinicId: string
  clinicName: string
  totalCostUsd: number
  totalTokens: number
  eventCount: number
}

interface SummaryRow {
  totalCost: string | null
  totalTokens: string | null
  promptTokens: string | null
  completionTokens: string | null
  eventCount: string | null
}

interface ModelRow {
  model: string
  costUsd: string | null
  totalTokens: string | null
  eventCount: string | null
}

interface BreakdownRow {
  clinicId: string
  clinicName: string
  totalCost: string | null
  totalTokens: string | null
  eventCount: string | null
}

const num = (value: string | null | undefined): number => {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

export interface AiUsageRepository {
  /** Cost + token rollup for a single clinic, including a per-model breakdown. */
  summaryByClinic(clinicId: string): Promise<ClinicUsageSummary>
  /** Per-clinic spend across every clinic (clinics with no usage report zeros). */
  summaryAllClinics(): Promise<ClinicUsageRow[]>
}

export function createAiUsageRepository(sql: Sql): AiUsageRepository {
  return {
    async summaryByClinic(clinicId) {
      const [totals, byModel] = await Promise.all([
        sql<SummaryRow[]>`
          SELECT
            COALESCE(SUM(cost_usd), 0)          AS total_cost,
            COALESCE(SUM(total_tokens), 0)      AS total_tokens,
            COALESCE(SUM(prompt_tokens), 0)     AS prompt_tokens,
            COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
            COUNT(*)                            AS event_count
          FROM ai_usage_events
          WHERE clinic_id = ${clinicId}
        `,
        sql<ModelRow[]>`
          SELECT
            model,
            COALESCE(SUM(cost_usd), 0)     AS cost_usd,
            COALESCE(SUM(total_tokens), 0) AS total_tokens,
            COUNT(*)                       AS event_count
          FROM ai_usage_events
          WHERE clinic_id = ${clinicId}
          GROUP BY model
          ORDER BY SUM(cost_usd) DESC NULLS LAST
        `,
      ])

      const row = totals[0]
      return {
        clinicId,
        totalCostUsd: num(row?.totalCost),
        totalTokens: num(row?.totalTokens),
        promptTokens: num(row?.promptTokens),
        completionTokens: num(row?.completionTokens),
        eventCount: num(row?.eventCount),
        byModel: byModel.map((m) => ({
          model: m.model,
          costUsd: num(m.costUsd),
          totalTokens: num(m.totalTokens),
          eventCount: num(m.eventCount),
        })),
      }
    },

    async summaryAllClinics() {
      const rows = await sql<BreakdownRow[]>`
        SELECT
          c.id                                AS clinic_id,
          c.name                              AS clinic_name,
          COALESCE(SUM(u.cost_usd), 0)        AS total_cost,
          COALESCE(SUM(u.total_tokens), 0)    AS total_tokens,
          COUNT(u.id)                         AS event_count
        FROM clinics c
        LEFT JOIN ai_usage_events u ON u.clinic_id = c.id
        GROUP BY c.id, c.name
        ORDER BY SUM(u.cost_usd) DESC NULLS LAST, c.name ASC
      `
      return rows.map((r) => ({
        clinicId: r.clinicId,
        clinicName: r.clinicName,
        totalCostUsd: num(r.totalCost),
        totalTokens: num(r.totalTokens),
        eventCount: num(r.eventCount),
      }))
    },
  }
}
