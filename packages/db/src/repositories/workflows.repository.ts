// Rev 3: N8N-style automation workflows — CRUD + the engine's trigger lookup.
import type { Sql, TxSql } from '../client.js'
import { toJson } from '../client.js'
import type { Workflow, WorkflowDocumentV2, WorkflowEdge, WorkflowNode, WorkflowRevision, WorkflowStatus } from '../types/index.js'
import { normalizeWorkflowStatus, type WorkflowLifecycleAction, workflowLifecycleTransition } from '../workflows/workflow-lifecycle.js'

export interface CreateWorkflowInput {
  clinicId: string
  name: string
  status?: WorkflowStatus
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  document?: WorkflowDocumentV2
  actorId?: string
  reason?: string
}

export interface UpdateWorkflowInput {
  name?: string
  status?: WorkflowStatus
  nodes?: WorkflowNode[]
  edges?: WorkflowEdge[]
  document?: WorkflowDocumentV2
  /** Optional optimistic-lock token supplied by an editor that already read the workflow. */
  expectedVersion?: number
  actorId?: string
  reason?: string
}

export interface WorkflowsRepository {
  listByClinic(clinicId: string): Promise<Workflow[]>
  findById(clinicId: string, id: string): Promise<Workflow | null>
  /** Immutable graph lookup for a queued or paused execution. */
  findRevision(clinicId: string, workflowId: string, revisionId: string): Promise<WorkflowRevision | null>
  listRevisions(clinicId: string, workflowId: string): Promise<WorkflowRevision[]>
  /** Engine entry: active workflows whose trigger node matches `triggerType`. */
  listActiveByTrigger(clinicId: string, triggerType: string): Promise<Workflow[]>
  create(data: CreateWorkflowInput): Promise<Workflow>
  update(clinicId: string, id: string, data: UpdateWorkflowInput): Promise<Workflow | null>
  transitionLifecycle(clinicId: string, id: string, action: WorkflowLifecycleAction, data?: { actorId?: string; reason?: string; expectedVersion?: number }): Promise<Workflow | null>
  restoreRevision(clinicId: string, id: string, revisionId: string, data?: { actorId?: string; reason?: string; expectedVersion?: number }): Promise<Workflow | null>
  /** Returns false when no workflow exists in this clinic scope. */
  delete(clinicId: string, id: string): Promise<boolean>
}

type WorkflowSql = Sql | TxSql

/** Create an immutable graph snapshot and atomically make it published. */
async function activateRevision(tx: WorkflowSql, workflow: Workflow, metadata: { actorId?: string; reason?: string } = {}): Promise<Workflow> {
  if (workflow.activeRevisionId) {
    await tx`
      UPDATE workflow_revisions SET status = 'superseded'
      WHERE clinic_id = ${workflow.clinicId} AND workflow_id = ${workflow.id} AND id = ${workflow.activeRevisionId}
    `
  }
  const revisions = await tx<WorkflowRevision[]>`
    INSERT INTO workflow_revisions (clinic_id, workflow_id, definition, revision_number, status, author_id, reason)
    VALUES (
      ${workflow.clinicId}, ${workflow.id},
      ${tx.json(toJson({ nodes: workflow.nodes, edges: workflow.edges }))},
      (SELECT COALESCE(MAX(revision_number), 0) + 1 FROM workflow_revisions WHERE workflow_id = ${workflow.id}),
      'published', ${metadata.actorId ?? null}, ${metadata.reason ?? null}
    )
    RETURNING *
  `
  const revision = revisions[0]
  if (!revision) throw new Error(`Could not create revision for workflow ${workflow.id}`)
  const workflows = await tx<Workflow[]>`
    UPDATE workflows SET active_revision_id = ${revision.id}, revision_number = ${revision.revisionNumber ?? 1}
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

/** Transitional V1-to-V2 adapter. The database keeps nodes/edges during the
 * client migration, while this generated document is the canonical split view
 * exposed to newer callers. */
function legacyDocument(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocumentV2 {
  return {
    version: 2,
    definition: {
      nodes: nodes.map(({ x: _x, y: _y, ...node }) => node),
      edges: edges.map((edge) => ({ ...edge })),
    },
    presentation: {
      nodes: Object.fromEntries(nodes.map((node) => [node.id, { x: node.x, y: node.y }])),
    },
  }
}

export function normalizeWorkflowGraph(w: Workflow): Workflow {
  const nodes = parseGraphColumn(w.nodes)
  const edges = parseGraphColumn(w.edges)
  const document = parseGraphColumn(w.document)
  return {
    ...w,
    status: normalizeWorkflowStatus(w.status),
    documentVersion: w.documentVersion ?? 1,
    nodes,
    edges,
    document: document ?? (Array.isArray(nodes) && Array.isArray(edges) ? legacyDocument(nodes, edges) : null),
  }
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

    async listRevisions(clinicId, workflowId) {
      return sql<WorkflowRevision[]>`
        SELECT * FROM workflow_revisions
        WHERE clinic_id = ${clinicId} AND workflow_id = ${workflowId}
        ORDER BY revision_number DESC NULLS LAST, created_at DESC
      `
    },

    async listActiveByTrigger(clinicId, triggerType) {
      const rows = await sql<Workflow[]>`
        SELECT * FROM workflows
        WHERE clinic_id = ${clinicId} AND status = 'published'
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
          INSERT INTO workflows (clinic_id, name, status, nodes, edges, document)
          VALUES (
            ${data.clinicId},
            ${data.name},
            ${data.status ?? 'draft'},
            ${tx.json(toJson(data.nodes ?? []))},
            ${tx.json(toJson(data.edges ?? []))},
            ${tx.json(toJson((data.document ?? legacyDocument(data.nodes ?? [], data.edges ?? [])) as unknown as Record<string, unknown>))}
          )
          RETURNING *
        `
        const workflow = normalizeWorkflowGraph(rows[0]!)
        return workflow.status === 'published' ? activateRevision(tx, workflow, data) : workflow
      }) as unknown as Promise<Workflow>)
    },

    async update(clinicId, id, data) {
      return (sql.begin(async (tx) => {
        const currentRows = await tx<Workflow[]>`
          SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE
        `
        const current = currentRows[0] ? normalizeWorkflowGraph(currentRows[0]) : null
        if (!current) return null
        if (data.expectedVersion !== undefined && current.documentVersion !== data.expectedVersion) return null
        const effectiveNodes = data.nodes ?? current.nodes
        const effectiveEdges = data.edges ?? current.edges
        const effectiveDocument = data.document ?? (data.nodes !== undefined || data.edges !== undefined
          ? legacyDocument(effectiveNodes, effectiveEdges)
          : undefined)
        const rows = await tx<Workflow[]>`
          UPDATE workflows SET
            name   = COALESCE(${data.name ?? null}, name),
            status = COALESCE(${data.status ?? null}, status),
            nodes  = COALESCE(${data.nodes !== undefined ? tx.json(toJson(data.nodes)) : null}, nodes),
            edges  = COALESCE(${data.edges !== undefined ? tx.json(toJson(data.edges)) : null}, edges),
            document = COALESCE(${effectiveDocument !== undefined ? tx.json(toJson(effectiveDocument as unknown as Record<string, unknown>)) : null}, document),
            document_version = document_version + 1
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        const workflow = normalizeWorkflowGraph(rows[0]!)
        const graphChanged = data.document !== undefined
          ? JSON.stringify(data.document.definition) !== JSON.stringify(current.document?.definition)
          : data.nodes !== undefined || data.edges !== undefined
        const activated = current.status !== 'published' && workflow.status === 'published'
        return workflow.status === 'published' && (graphChanged || activated)
          ? activateRevision(tx, workflow, data)
          : workflow
      }) as unknown as Promise<Workflow | null>)
    },

    async transitionLifecycle(clinicId, id, action, data = {}) {
      return (sql.begin(async (tx) => {
        const currentRows = await tx<Workflow[]>`
          SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE
        `
        const current = currentRows[0] ? normalizeWorkflowGraph(currentRows[0]) : null
        if (!current || (data.expectedVersion !== undefined && current.documentVersion !== data.expectedVersion)) return null
        const nextStatus = workflowLifecycleTransition(current.status, action)
        if (!nextStatus) return null
        const rows = await tx<Workflow[]>`
          UPDATE workflows SET
            status = ${nextStatus},
            lifecycle_changed_at = NOW(),
            archived_at = CASE WHEN ${nextStatus === 'archived'} THEN NOW() ELSE archived_at END,
            document_version = document_version + 1
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        const workflow = normalizeWorkflowGraph(rows[0]!)
        return nextStatus === 'published' ? activateRevision(tx, workflow, data) : workflow
      }) as unknown as Promise<Workflow | null>)
    },

    async restoreRevision(clinicId, id, revisionId, data = {}) {
      return (sql.begin(async (tx) => {
        const currentRows = await tx<Workflow[]>`
          SELECT * FROM workflows WHERE clinic_id = ${clinicId} AND id = ${id} FOR UPDATE
        `
        const current = currentRows[0] ? normalizeWorkflowGraph(currentRows[0]) : null
        if (!current || (data.expectedVersion !== undefined && current.documentVersion !== data.expectedVersion)) return null
        const revisionRows = await tx<WorkflowRevision[]>`
          SELECT * FROM workflow_revisions
          WHERE clinic_id = ${clinicId} AND workflow_id = ${id} AND id = ${revisionId} LIMIT 1
        `
        const revision = revisionRows[0]
        if (!revision) return null
        const document = legacyDocument(revision.definition.nodes, revision.definition.edges)
        const rows = await tx<Workflow[]>`
          UPDATE workflows SET
            status = 'draft', nodes = ${tx.json(toJson(revision.definition.nodes))}, edges = ${tx.json(toJson(revision.definition.edges))},
            document = ${tx.json(toJson(document as unknown as Record<string, unknown>))},
            lifecycle_changed_at = NOW(), archived_at = NULL, document_version = document_version + 1
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        return normalizeWorkflowGraph(rows[0]!)
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
