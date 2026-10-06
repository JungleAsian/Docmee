import type { Sql } from '../client.js'
import { toJson } from '../client.js'

export interface ClinicSetupCheckSnapshot {
  clinicId: string
  issueKeys: string[]
  issues: unknown[]
  checkedAt: string
}

export interface ClinicSetupChecksRepository {
  get(clinicId: string): Promise<ClinicSetupCheckSnapshot | null>
  save(clinicId: string, issueKeys: string[], issues: unknown[]): Promise<void>
}

export function createClinicSetupChecksRepository(sql: Sql): ClinicSetupChecksRepository {
  return {
    async get(clinicId) {
      const rows = await sql<ClinicSetupCheckSnapshot[]>`
        SELECT * FROM clinic_setup_checks WHERE clinic_id = ${clinicId}
      `
      return rows[0] ?? null
    },

    async save(clinicId, issueKeys, issues) {
      await sql`
        INSERT INTO clinic_setup_checks (clinic_id, issue_keys, issues, checked_at)
        VALUES (${clinicId}, ${issueKeys}, ${sql.json(toJson(issues))}, NOW())
        ON CONFLICT (clinic_id) DO UPDATE
          SET issue_keys = EXCLUDED.issue_keys, issues = EXCLUDED.issues, checked_at = NOW()
      `
    },
  }
}
