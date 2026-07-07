// P18 (Gap #34): Custom conversation flows — keyword-triggered scripted replies
// that bypass intent classification / the LLM. Managed in Admin Studio.
import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type {
  CustomFlow,
  CustomFlowAction,
  CustomFlowLanguage,
  CustomFlowStep,
} from '../types/index.js'

export interface CreateCustomFlowInput {
  clinicId: string
  name: string
  triggerKeywords: string[]
  messages: string[]
  action?: CustomFlowAction | null
  language?: CustomFlowLanguage
  enabled?: boolean
  steps?: CustomFlowStep[]
  startStepId?: string | null
}

export interface UpdateCustomFlowInput {
  name?: string
  triggerKeywords?: string[]
  messages?: string[]
  action?: CustomFlowAction | null
  language?: CustomFlowLanguage
  enabled?: boolean
  steps?: CustomFlowStep[]
  startStepId?: string | null
}

export interface CustomFlowsRepository {
  listByClinic(clinicId: string): Promise<CustomFlow[]>
  /** Enabled flows only — what the bot evaluates on each inbound message. */
  listEnabled(clinicId: string): Promise<CustomFlow[]>
  findById(clinicId: string, id: string): Promise<CustomFlow | null>
  create(data: CreateCustomFlowInput): Promise<CustomFlow>
  update(clinicId: string, id: string, data: UpdateCustomFlowInput): Promise<CustomFlow>
  delete(clinicId: string, id: string): Promise<void>
}

export function createCustomFlowsRepository(sql: Sql): CustomFlowsRepository {
  return {
    async listByClinic(clinicId) {
      return sql<CustomFlow[]>`
        SELECT * FROM custom_flows WHERE clinic_id = ${clinicId} ORDER BY created_at DESC
      `
    },

    async listEnabled(clinicId) {
      return sql<CustomFlow[]>`
        SELECT * FROM custom_flows WHERE clinic_id = ${clinicId} AND enabled = TRUE ORDER BY created_at
      `
    },

    async findById(clinicId, id) {
      const rows = await sql<CustomFlow[]>`
        SELECT * FROM custom_flows WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async create(data) {
      const rows = await sql<CustomFlow[]>`
        INSERT INTO custom_flows (clinic_id, name, trigger_keywords, messages, action, language, enabled, steps, start_step_id)
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${sql.json(data.triggerKeywords)},
          ${sql.json(data.messages)},
          ${data.action     ?? null},
          ${data.language    ?? 'both'},
          ${data.enabled     ?? true},
          ${sql.json(toJson(data.steps ?? []))},
          ${data.startStepId ?? null}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<CustomFlow[]>`
        UPDATE custom_flows SET
          name             = COALESCE(${data.name ?? null}, name),
          trigger_keywords = CASE WHEN ${data.triggerKeywords !== undefined} THEN ${sql.json(data.triggerKeywords ?? [])} ELSE trigger_keywords END,
          messages         = CASE WHEN ${data.messages !== undefined} THEN ${sql.json(data.messages ?? [])} ELSE messages END,
          action           = CASE WHEN ${data.action !== undefined} THEN ${data.action ?? null} ELSE action END,
          language         = COALESCE(${data.language ?? null}, language),
          enabled          = COALESCE(${data.enabled  ?? null}, enabled),
          steps            = CASE WHEN ${data.steps !== undefined} THEN ${sql.json(toJson(data.steps ?? []))} ELSE steps END,
          start_step_id    = CASE WHEN ${data.startStepId !== undefined} THEN ${data.startStepId ?? null} ELSE start_step_id END
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Custom flow not found: ${id}`)
      return rows[0]
    },

    async delete(clinicId, id) {
      await sql`DELETE FROM custom_flows WHERE clinic_id = ${clinicId} AND id = ${id}`
    },
  }
}
