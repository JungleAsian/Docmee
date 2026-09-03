// Rev 3: N8N-style automation workflows — CRUD + the engine's trigger lookup.
import type { Sql, TxSql } from '../client.js'
import { toJson } from '../client.js'
import type { Workflow, WorkflowEdge, WorkflowNode, WorkflowRevision, WorkflowStatus } from '../types/index.js'

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
  /** Immutable graph lookup for a queued or paused execution. */
  findRevision(clinicId: string, workflowId: string, revisionId: string): Promise<WorkflowRevision | null>
  /** Engine entry: active workflows whose trigger node matches `triggerType`. */
  listActiveByTrigger(clinicId: string, triggerType: string): Promise<Workflow[]>
  create(data: CreateWorkflowInput): Promise<Workflow>
  update(clinicId: string, id: string, data: UpdateWorkflowInput): Promise<Workflow | null>
  /** Returns false when no workflow exists in this clinic scope. */
  delete(clinicId: string, id: string): Promise<boolean>
}

type WorkflowSql = Sql | TxSql

/** Create an immutable graph snapshot and atomically make it active. */
async function activateRevision(tx: WorkflowSql, workflow: Workflow): Promise<Workflow> {
  const revisions = await tx<WorkflowRevision[]>`
    INSERT INTO workflow_revisions (clinic_id, workflow_id, definition)
    VALUES (${workflow.clinicId}, ${workflow.id}, ${tx.json(toJson({ nodes: workflow.nodes, edges: workflow.edges }))})
    RETURNING *
  `
  const revision = revisions[0]
  if (!revision) throw new Error(`Could not create revision for workflow ${workflow.id}`)
  const workflows = await tx<Workflow[]>`
    UPDATE workflows SET active_revision_id = ${revision.id}
    WHERE clinic_id = ${workflow.clinicId} AND id = ${workflow.id}
    RETURNING *
  `
  if (!workflows[0]) throw new Error(`Could not activate revision for workflow ${workflow.id}`)
  return normalizeWorkflowGraph(workflows[0])
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

    async findRevision(clinicId, workflowId, revisionId) {
      const rows = await sql<WorkflowRevision[]>`
        SELECT * FROM workflow_revisions
        WHERE clinic_id = ${clinicId} AND workflow_id = ${workflowId} AND id = ${revisionId}
        LIMIT 1
      `
      return rows[0] ?? null
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
      return (sql.begin(async (tx) => {
        const rows = await tx<Workflow[]>`
          INSERT INTO workflows (clinic_id, name, status, nodes, edges)
          VALUES (
            ${data.clinicId},
            ${data.name},
            ${data.status ?? 'draft'},
            ${tx.json(toJson(data.nodes ?? []))},
            ${tx.json(toJson(data.edges ?? []))}
          )
          RETURNING *
        `
        const workflow = normalizeWorkflowGraph(rows[0]!)
        return workflow.status === 'active' ? activateRevision(tx, workflow) : workflow
      }) as unknown as Promise<Workflow>)
    },

    async update(clinicId, id, data) {
      return (sql.begin(async (tx) => {
        const currentRows = await tx<Workflow[]>`
          SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE
        `
        const current = currentRows[0] ? normalizeWorkflowGraph(currentRows[0]) : null
        if (!current) return null
        const rows = await tx<Workflow[]>`
          UPDATE workflows SET
            name   = COALESCE(${data.name ?? null}, name),
            status = COALESCE(${data.status ?? null}, status),
            nodes  = COALESCE(${data.nodes !== undefined ? tx.json(toJson(data.nodes)) : null}, nodes),
            edges  = COALESCE(${data.edges !== undefined ? tx.json(toJson(data.edges)) : null}, edges)
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        const workflow = normalizeWorkflowGraph(rows[0]!)
        const graphChanged = data.nodes !== undefined || data.edges !== undefined
        const activated = current.status !== 'active' && workflow.status === 'active'
        return workflow.status === 'active' && (graphChanged || activated)
          ? activateRevision(tx, workflow)
          : workflow
      }) as unknown as Promise<Workflow | null>)
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
