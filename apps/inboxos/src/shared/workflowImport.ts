// Workflow JSON export/import. Client-only, no backend involved — export
// serializes the exact in-memory {nodes, edges} shape the editor already
// persists; import is a light STRUCTURAL guard only (required keys present,
// right basic types), deliberately not a semantic validator, since
// apps/inboxos stays free of a @docmee/agents runtime dependency (the same
// boundary respected everywhere else in this file's siblings). Full semantic
// validation (dangling edges, missing successors, option-count caps, etc.)
// is inherited for free the moment the admin clicks Save — same
// ApiError.details path any other edit already goes through.
import type { WorkflowNode, WorkflowEdge } from './types'

/** Bumped only if the export shape ever changes incompatibly. */
const EXPORT_MARKER = 1 as const

export interface WorkflowExportFile {
  docmeeWorkflowExport: typeof EXPORT_MARKER
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

/** `clinicId` and `status` are deliberately NOT serialized: a file exported
 *  from one clinic should be importable into another (portability), and an
 *  imported workflow must never auto-inherit "active" status — cross-clinic
 *  config (doctor ids, tags, workflow references) generally won't resolve in
 *  the target clinic, so auto-activating would be unsafe. Import always
 *  behaves like creating a brand-new draft. */
export function serializeWorkflowExport(name: string, nodes: WorkflowNode[], edges: WorkflowEdge[]): string {
  const file: WorkflowExportFile = { docmeeWorkflowExport: EXPORT_MARKER, name, nodes, edges }
  return JSON.stringify(file, null, 2)
}

export type ParseWorkflowExportResult =
  | { ok: true; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }
  | { ok: false; error: 'wf.import.invalidJson' | 'wf.import.notAWorkflowExport' | 'wf.import.invalidShape' }

function isValidNode(value: unknown): value is WorkflowNode {
  if (!value || typeof value !== 'object') return false
  const n = value as Record<string, unknown>
  return (
    typeof n['id'] === 'string' &&
    (n['kind'] === 'trigger' || n['kind'] === 'logic' || n['kind'] === 'action') &&
    typeof n['type'] === 'string' &&
    typeof n['x'] === 'number' &&
    typeof n['y'] === 'number' &&
    typeof n['config'] === 'object' &&
    n['config'] !== null
  )
}

function isValidEdge(value: unknown): value is WorkflowEdge {
  if (!value || typeof value !== 'object') return false
  const e = value as Record<string, unknown>
  return typeof e['id'] === 'string' && typeof e['source'] === 'string' && typeof e['target'] === 'string'
}

export function parseWorkflowExport(raw: string): ParseWorkflowExportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'wf.import.invalidJson' }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'wf.import.invalidJson' }
  const p = parsed as Record<string, unknown>
  if (p['docmeeWorkflowExport'] !== EXPORT_MARKER) return { ok: false, error: 'wf.import.notAWorkflowExport' }
  if (!Array.isArray(p['nodes']) || !Array.isArray(p['edges'])) return { ok: false, error: 'wf.import.invalidShape' }

  const nodes = p['nodes'] as unknown[]
  const edges = p['edges'] as unknown[]
  if (!nodes.every(isValidNode) || !edges.every(isValidEdge)) return { ok: false, error: 'wf.import.invalidShape' }

  return {
    ok: true,
    name: typeof p['name'] === 'string' ? p['name'] : '',
    nodes: nodes as WorkflowNode[],
    edges: edges as WorkflowEdge[],
  }
}
