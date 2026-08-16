import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

const nodeKinds = new Map<string, WorkflowNode['kind']>([
  ['trigger.message_keyword', 'trigger'],
  ['trigger.patient_upset', 'trigger'],
  ['logic.condition', 'logic'],
  ['logic.delay', 'logic'],
  ['logic.wait_for_reply', 'logic'],
  ['logic.ai_classify_intent', 'logic'],
  ['action.send_message', 'action'],
  ['action.send_template', 'action'],
  ['action.notify_secretary', 'action'],
  ['action.add_tag', 'action'],
  ['action.ai_draft', 'action'],
  ['action.approval', 'action'],
  ['action.ask_capture', 'action'],
  ['action.extract_booking_details', 'action'],
  ['action.check_availability', 'action'],
  ['action.available_slots', 'action'],
  ['action.offer_slots', 'action'],
  ['action.interactive_menu', 'action'],
  ['action.revalidate_slot', 'action'],
  ['action.create_or_reschedule_booking', 'action'],
  ['action.transcribe_booking_voice', 'action'],
  ['action.end', 'action'],
])

/** Only these triggers have an event producer in the worker runtime. */
export const SUPPORTED_WORKFLOW_TRIGGER_TYPES = ['trigger.message_keyword', 'trigger.patient_upset'] as const

export interface WorkflowValidationOptions {
  /** Active workflows must be complete. Drafts may start as an empty canvas. */
  requireTrigger?: boolean
}

/**
 * Validate the persisted workflow contract before it can reach a worker. The engine
 * deliberately remains a small executor; this is the single structural gate for
 * HTTP writes and any future import/test endpoint.
 */
export function validateWorkflowDefinition(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  { requireTrigger = false }: WorkflowValidationOptions = {},
): string[] {
  const errors: string[] = []
  const ids = new Set<string>()
  const edgeIds = new Set<string>()

  for (const node of nodes) {
    if (ids.has(node.id)) errors.push(`Duplicate node id: ${node.id}`)
    ids.add(node.id)
    const expectedKind = nodeKinds.get(node.type)
    if (!expectedKind) errors.push(`Unsupported node type: ${node.type}`)
    else if (expectedKind !== node.kind) errors.push(`Node ${node.id} has kind ${node.kind}; ${node.type} requires ${expectedKind}`)
  }

  const triggers = nodes.filter((node) => node.kind === 'trigger')
  if (triggers.length > 1) errors.push('A workflow may have exactly one trigger')
  if (requireTrigger && triggers.length !== 1) errors.push('An active workflow requires exactly one trigger')

  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) errors.push(`Duplicate edge id: ${edge.id}`)
    edgeIds.add(edge.id)
    if (!ids.has(edge.source)) errors.push(`Edge ${edge.id} has an unknown source: ${edge.source}`)
    if (!ids.has(edge.target)) errors.push(`Edge ${edge.id} has an unknown target: ${edge.target}`)
    if (edge.source === edge.target) errors.push(`Edge ${edge.id} cannot point to the same node`)
    const sourceEdges = outgoing.get(edge.source) ?? []
    sourceEdges.push(edge)
    outgoing.set(edge.source, sourceEdges)
  }

  for (const node of nodes) {
    // Draft canvases may be incomplete while they are being edited. Still reject
    // malformed IDs/types/edges above, but reserve executable-graph requirements
    // for activation and worker load.
    if (!requireTrigger) continue
    const next = outgoing.get(node.id) ?? []
    if (node.type === 'action.end' && next.length > 0) errors.push(`End node ${node.id} cannot have outgoing edges`)
    if (node.type !== 'action.end' && node.type !== 'logic.condition' && node.type !== 'logic.ai_classify_intent' && next.length !== 1) {
      errors.push(`Node ${node.id} must have exactly one successor`)
    }
    if (node.type === 'logic.condition') {
      const handles = new Set<string>()
      for (const edge of next) {
        if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
          errors.push(`Condition edge ${edge.id} must use the true or false handle`)
        }
        if (edge.sourceHandle && handles.has(edge.sourceHandle)) errors.push(`Condition node ${node.id} has an ambiguous ${edge.sourceHandle} branch`)
        if (edge.sourceHandle) handles.add(edge.sourceHandle)
      }
      if (!handles.has('true') || !handles.has('false')) errors.push(`Condition node ${node.id} requires true and false successors`)
    }
    if (node.type === 'logic.ai_classify_intent') {
      const handles = new Set(next.map((edge) => edge.sourceHandle).filter((handle): handle is string => Boolean(handle)))
      for (const handle of ['high', 'low', 'error']) {
        if (!handles.has(handle)) errors.push(`Intent classifier ${node.id} requires a ${handle} successor`)
      }
      if (handles.size !== next.length) errors.push(`Intent classifier ${node.id} has an unlabeled or ambiguous branch`)
    }
    if (node.type === 'action.interactive_menu') {
      const handles = new Set(next.map((edge) => edge.sourceHandle).filter((handle): handle is string => Boolean(handle)))
      for (const edge of next) {
        if (edge.sourceHandle !== 'selected') {
          errors.push(`Interactive menu edge ${edge.id} must use the selected handle`)
        }
      }
      if (!handles.has('selected')) errors.push(`Interactive menu ${node.id} requires a selected successor`)
    }
    if (node.type === 'logic.delay') {
      const amount = Number(node.config?.['amount'])
      if (!Number.isFinite(amount) || amount <= 0) errors.push(`Delay node ${node.id} requires a positive amount`)
      if (!['minute', 'hour', 'day'].includes(String(node.config?.['unit'] ?? ''))) errors.push(`Delay node ${node.id} has an invalid unit`)
    }
    if (node.type === 'action.send_message' && !String(node.config?.['text'] ?? '').trim()) {
      errors.push(`Message node ${node.id} requires text`)
    }
  }

  if (triggers.length !== 1) return errors

  const reachable = new Set<string>()
  const visiting = new Set<string>()
  const visit = (id: string): void => {
    if (visiting.has(id)) {
      errors.push(`Cycle detected at node: ${id}`)
      return
    }
    if (reachable.has(id)) return
    visiting.add(id)
    reachable.add(id)
    for (const edge of outgoing.get(id) ?? []) visit(edge.target)
    visiting.delete(id)
  }
  visit(triggers[0]!.id)

  for (const node of nodes) {
    if (!reachable.has(node.id)) errors.push(`Node ${node.id} is unreachable from the trigger`)
  }
  return errors
}
