import type { Sql } from '../client.js'
import { toJson } from '../client.js'

export type ChangeLogOutcome = 'succeeded' | 'failed'

export interface ChangeLogEntry {
  id: string
  createdAt: string
  clinicId: string | null
  clinicName: string | null
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  area: string
  action: string
  method: string
  route: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  outcome: ChangeLogOutcome
  statusCode: number
  summary: string
  changes: Record<string, unknown>
  requestId: string | null
}

export type CreateChangeLogInput = Omit<ChangeLogEntry, 'id' | 'createdAt'>

export interface ChangeLogFilter {
  clinicId?: string
  area?: string
  outcome?: ChangeLogOutcome
  /** Case-insensitive match on summary, resource name, actor email or route. */
  search?: string
  /** Return entries strictly older than this timestamp (cursor pagination). */
  before?: string
  limit?: number
}

export interface ChangeLogRepository {
  log(entry: CreateChangeLogInput): Promise<void>
  list(filter?: ChangeLogFilter): Promise<ChangeLogEntry[]>
}

export function createChangeLogRepository(sql: Sql): ChangeLogRepository {
  return {
    async log(entry) {
      await sql`
        INSERT INTO change_log (
          clinic_id, clinic_name, actor_id, actor_email, actor_role, area, action, method,
          route, resource_type, resource_id, resource_name, outcome, status_code, summary,
          changes, request_id
        ) VALUES (
          ${entry.clinicId}, ${entry.clinicName}, ${entry.actorId}, ${entry.actorEmail},
          ${entry.actorRole}, ${entry.area}, ${entry.action}, ${entry.method}, ${entry.route},
          ${entry.resourceType}, ${entry.resourceId}, ${entry.resourceName}, ${entry.outcome},
          ${entry.statusCode}, ${entry.summary}, ${sql.json(toJson(entry.changes))}, ${entry.requestId}
        )
      `
    },

    async list(filter = {}) {
      const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500)
      const search = filter.search?.trim() ? `%${filter.search.trim()}%` : null
      return sql<ChangeLogEntry[]>`
        SELECT * FROM change_log
        WHERE (${filter.clinicId ?? null}::uuid IS NULL OR clinic_id = ${filter.clinicId ?? null}::uuid)
          AND (${filter.area ?? null}::text IS NULL OR area = ${filter.area ?? null})
          AND (${filter.outcome ?? null}::text IS NULL OR outcome = ${filter.outcome ?? null})
          AND (${filter.before ?? null}::timestamptz IS NULL OR created_at < ${filter.before ?? null}::timestamptz)
          AND (
            ${search}::text IS NULL
            OR summary ILIKE ${search}
            OR resource_name ILIKE ${search}
            OR actor_email ILIKE ${search}
            OR route ILIKE ${search}
          )
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    },
  }
}
