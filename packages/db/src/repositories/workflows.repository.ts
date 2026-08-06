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
  /** Returns false when no workflow exists in this clinic scope. */
  delete(clinicId: string, id: string): Promise<boolean>
}

/**
 * Defensive normalization: a workflow written outside the app (seed scripts,
 * manual SQL with a string parameter) can leave nodes/edges double-encoded —
 * jsonb holding a JSON *string* instead of an array. The editor assumes arrays
 * and hard-crashes at mount (`.map is not a function`) on such a row, so parse
 * the string form back into the real value here, once, at the boundary.
 */
function parseGraphColumn<T>(value: T): T {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as T
  } catch {
    return value
  }
}

export function normalizeWorkflowGraph(w: Workflow): Workflow {
  return { ...w, nodes: parseGraphColumn(w.nodes), edges: parseGraphColumn(w.edges) }
}

export function createWorkflowsRepository(sql: Sql): WorkflowsRepository {
  return {
    async listByClinic(clinicId) {
      const rows = await sql<Workflow[]>`SELECT * FROM workflows WHERE clinic_id = ${clinicId} ORDER BY updated_at DESC`
      return rows.map(normalizeWorkflowGraph)
    },

    async findById(clinicId, id) {
      const rows = await sql<Workflow[]>`
        SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ? normalizeWorkflowGraph(rows[0]) : null
    },

    async listActiveByTrigger(clinicId, triggerType) {
      const rows = await sql<Workflow[]>`
        SELECT * FROM workflows
        WHERE clinic_id = ${clinicId} AND status = 'active'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(nodes) AS n
            WHERE n->>'kind' = 'trigger' AND n->>'type' = ${triggerType}
          )
        ORDER BY updated_at DESC
      `
      return rows.map(normalizeWorkflowGraph)
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
      return normalizeWorkflowGraph(rows[0]!)
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
      return rows[0] ? normalizeWorkflowGraph(rows[0]) : null
    },

    async delete(clinicId, id) {
      const rows = await sql<[{ id: string }]>`
        DELETE FROM workflows
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING id
      `
      return rows.length > 0
    },
  }
}
