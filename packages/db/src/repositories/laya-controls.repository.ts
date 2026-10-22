import type { Sql } from '../client.js'

export interface LayaControlRow {
  name: string
  clinicId: string | null
  enabled: boolean
  rolloutPercentage: number
  metadata: unknown
}

/** Read-only: mode authorization is resolved by the shared agents boundary. */
export function createLayaControlsRepository(sql: Sql) {
  return {
    async readForClinic(clinicId: string): Promise<LayaControlRow[]> {
      if (typeof clinicId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clinicId)) return []
      return sql<LayaControlRow[]>`
        SELECT name, clinic_id, enabled, rollout_percentage, metadata
        FROM feature_flags
        WHERE name = 'docmee_laya'
          AND (clinic_id IS NULL OR clinic_id = ${clinicId})
        LIMIT 1001
      `
    },
  }
}
