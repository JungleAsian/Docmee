import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { ErrorReview } from '../types/index.js'

export interface CreateErrorReviewInput {
  clinicId?: string | null
  errorType: string
  errorMessage: string
  stackTrace?: string | null
  context?: Record<string, unknown>
}

/** Filters for the Admin Studio Error Review list (Req 36). All optional and ANDed. */
export interface ErrorReviewFilters {
  status?: ErrorReview['status']
  /** Inclusive lower bound on created_at (ISO date or timestamp). */
  from?: string
  /** Inclusive upper bound on created_at (ISO date or timestamp). */
  to?: string
}

export interface ErrorReviewsRepository {
  /** Record a runtime error (e.g. a bot LLM failure) for later operator review. */
  create(data: CreateErrorReviewInput): Promise<ErrorReview>
  listOpen(clinicId: string): Promise<ErrorReview[]>
  /** A single error review scoped to its clinic, or null. */
  findById(clinicId: string, id: string): Promise<ErrorReview | null>
  /** Error reviews for a clinic (newest first), optionally filtered by status + date range (Req 36). */
  listByClinic(clinicId: string, filters?: ErrorReviewFilters): Promise<ErrorReview[]>
  /** Mark an error reviewed+resolved by an operator. Returns the updated row or null. */
  resolve(clinicId: string, id: string, reviewedBy: string): Promise<ErrorReview | null>
  /**
   * Batch-resolve several reviews at once (Req 36). Only rows that belong to the
   * clinic and are not already resolved are updated; returns the updated rows.
   */
  resolveMany(clinicId: string, ids: string[], reviewedBy: string): Promise<ErrorReview[]>
}

export function createErrorReviewsRepository(sql: Sql): ErrorReviewsRepository {
  return {
    async create(data) {
      const rows = await sql<ErrorReview[]>`
        INSERT INTO error_reviews (clinic_id, error_type, error_message, stack_trace, context)
        VALUES (
          ${data.clinicId ?? null},
          ${data.errorType},
          ${data.errorMessage},
          ${data.stackTrace ?? null},
          ${sql.json(toJson(data.context ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async listOpen(clinicId) {
      return sql<ErrorReview[]>`
        SELECT * FROM error_reviews
        WHERE clinic_id = ${clinicId} AND status = 'open'
        ORDER BY created_at DESC
      `
    },

    async findById(clinicId, id) {
      const rows = await sql<ErrorReview[]>`
        SELECT * FROM error_reviews
        WHERE clinic_id = ${clinicId} AND id = ${id}
      `
      return rows[0] ?? null
    },

    async listByClinic(clinicId, filters = {}) {
      // Compose the optional status/date-range predicates as ANDed sql fragments so a
      // single query covers every filter combination (Req 36 date filters).
      const conditions = [sql`clinic_id = ${clinicId}`]
      if (filters.status) conditions.push(sql`status = ${filters.status}`)
      if (filters.from) conditions.push(sql`created_at >= ${filters.from}`)
      if (filters.to) conditions.push(sql`created_at <= ${filters.to}`)
      const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)
      return sql<ErrorReview[]>`
        SELECT * FROM error_reviews
        WHERE ${where}
        ORDER BY created_at DESC
      `
    },

    async resolve(clinicId, id, reviewedBy) {
      const rows = await sql<ErrorReview[]>`
        UPDATE error_reviews SET
          status      = 'resolved',
          reviewed_by = ${reviewedBy},
          resolved_at = NOW(),
          updated_at  = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async resolveMany(clinicId, ids, reviewedBy) {
      if (ids.length === 0) return []
      return sql<ErrorReview[]>`
        UPDATE error_reviews SET
          status      = 'resolved',
          reviewed_by = ${reviewedBy},
          resolved_at = NOW(),
          updated_at  = NOW()
        WHERE clinic_id = ${clinicId}
          AND id = ANY(${ids})
          AND status <> 'resolved'
        RETURNING *
      `
    },
  }
}
