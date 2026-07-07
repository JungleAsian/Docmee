// Rev 3: N8N-style automation workflows — CRUD + the engine's trigger lookup.
import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowStatus } from '../types/index.js'

export interface CreateWorkflowInput {
  clinicId: string
  name: string
  status?: WorkflowStatus
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

export interface UpdateWorkflowInput {
  name?: string
  status?: WorkflowStatus
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
}

export interface WorkflowsRepository {
  listByClinic(clinicId: string): Promise<Workflow[]>
  findById(clinicId: string, id: string): Promise<Workflow | null>
  /** Engine entry: active workflows whose trigger node matches `triggerType`. */
  listActiveByTrigger(clinicId: string, triggerType: string): Promise<Workflow[]>
  create(data: CreateWorkflowInput): Promise<Workflow>
  update(clinicId: string, id: string, data: UpdateWorkflowInput): Promise<Workflow | null>
  delete(clinicId: string, id: string): Promise<void>
}

export function createWorkflowsRepository(sql: Sql): WorkflowsRepository {
  return {
    async listByClinic(clinicId) {
      return sql<Workflow[]>`SELECT * FROM workflows WHERE clinic_id = ${clinicId} ORDER BY updated_at DESC`
    },

    async findById(clinicId, id) {
      const rows = await sql<Workflow[]>`
        SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async listActiveByTrigger(clinicId, triggerType) {
      return sql<Workflow[]>`
        SELECT * FROM workflows
        WHERE clinic_id = ${clinicId} AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(nodes) AS n
            WHERE n->>'kind' = 'trigger' AND n->>'type' = ${triggerType}
          )
        ORDER BY updated_at DESC
      `
    },

    async create(data) {
      const rows = await sql<Workflow[]>`
        INSERT INTO workflows (clinic_id, name, status, nodes, edges)
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${data.status ?? 'draft'},
          ${sql.json(toJson(data.nodes ?? []))},
          ${sql.json(toJson(data.edges ?? []))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<Workflow[]>`
        UPDATE workflows SET
          name   = COALESCE(${data.name ?? null}, name),
          status = COALESCE(${data.status ?? null}, status),
          nodes  = COALESCE(${data.nodes ? sql.json(toJson(data.nodes)) : null}, nodes),
          edges  = COALESCE(${data.edges ? sql.json(toJson(data.edges)) : null}, edges)
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      return rows[0] ?? null
    },

    async delete(clinicId, id) {
      await sql`DELETE FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id}`
    },
  }
}
