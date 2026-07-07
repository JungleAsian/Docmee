import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { AuditEvent } from '../types/index.js'

export interface CreateAuditEventInput {
  clinicId: string
  actorId?: string
  actorEmail?: string
  action: string
  resourceType: string
  resourceId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
}

export interface AuditEventFilter {
  actorId?: string
  resourceType?: string
  resourceId?: string
  action?: string
  from?: string
  to?: string
  limit?: number
}

export interface AuditRepository {
  log(data: CreateAuditEventInput): Promise<AuditEvent>
  list(clinicId: string, filter?: AuditEventFilter): Promise<AuditEvent[]>
  findByResource(clinicId: string, resourceType: string, resourceId: string): Promise<AuditEvent[]>
}

export function createAuditRepository(sql: Sql): AuditRepository {
  return {
    async log(data) {
      const rows = await sql<AuditEvent[]>`
        INSERT INTO audit_events
          (clinic_id, actor_id, actor_email, action, resource_type, resource_id, metadata, ip_address)
        VALUES (
          ${data.clinicId},
          ${data.actorId      ?? null},
          ${data.actorEmail   ?? null},
          ${data.action},
          ${data.resourceType},
          ${data.resourceId   ?? null},
          ${sql.json(toJson(data.metadata ?? {}))},
          ${data.ipAddress    ?? null}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async list(clinicId, filter = {}) {
      const limit = filter.limit ?? 100
      return sql<AuditEvent[]>`
        SELECT * FROM audit_events
        WHERE clinic_id = ${clinicId}
          AND (${filter.actorId      ?? null}::uuid  IS NULL OR actor_id      = ${filter.actorId ?? null})
          AND (${filter.resourceType ?? null}::text   IS NULL OR resource_type = ${filter.resourceType ?? null})
          AND (${filter.resourceId   ?? null}::uuid  IS NULL OR resource_id   = ${filter.resourceId ?? null})
          AND (${filter.action       ?? null}::text   IS NULL OR action        = ${filter.action ?? null})
          AND (${filter.from         ?? null}::timestamptz IS NULL OR created_at >= ${filter.from ?? null}::timestamptz)
          AND (${filter.to           ?? null}::timestamptz IS NULL OR created_at <= ${filter.to   ?? null}::timestamptz)
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    },

    async findByResource(clinicId, resourceType, resourceId) {
      return sql<AuditEvent[]>`
        SELECT * FROM audit_events
        WHERE clinic_id = ${clinicId}
          AND resource_type = ${resourceType}
          AND resource_id   = ${resourceId}::uuid
        ORDER BY created_at DESC
      `
    },
  }
}
