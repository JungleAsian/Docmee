import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { parseMenuOptions, MENU_RESERVED_HANDLES } from './workflow-engine.js'

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
  ['action.interactive_menu', 'action'],
  ['action.extract_booking_details', 'action'],
  ['action.check_availability', 'action'],
  ['action.offer_slots', 'action'],
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
    if (
      node.type !== 'action.end' &&
      node.type !== 'logic.condition' &&
      node.type !== 'logic.ai_classify_intent' &&
      node.type !== 'action.interactive_menu' &&
      next.length !== 1
    ) {
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
      const options = parseMenuOptions(node.config)
      const variant = String(node.config?.['variant'] ?? 'button')
      const limit = variant === 'list' ? 10 : 3
      if (options.length === 0) {
        errors.push(`Interactive menu ${node.id} requires at least one option`)
      } else if (options.length > limit) {
        errors.push(`Interactive menu ${node.id} has too many options for variant "${variant}" (max ${limit})`)
      }
      const seen = new Set<string>()
      for (const opt of options) {
        if (seen.has(opt.optionId)) errors.push(`Interactive menu ${node.id} has a duplicate option "${opt.optionId}"`)
        seen.add(opt.optionId)
        if (opt.title.length > 24) errors.push(`Interactive menu ${node.id} option "${opt.optionId}" title exceeds 24 chars`)
      }
      // Every option handle needs an edge; reserved handles are optional.
      const validHandles = new Set<string>([...seen, ...MENU_RESERVED_HANDLES])
      const wired = new Set<string>()
      for (const edge of next) {
        const h = edge.sourceHandle ?? ''
        if (!validHandles.has(h)) errors.push(`Interactive menu edge ${edge.id} uses an unknown handle "${h}"`)
        if (wired.has(h)) errors.push(`Interactive menu ${node.id} has an ambiguous "${h}" branch`)
        wired.add(h)
      }
      for (const opt of seen) {
        if (!wired.has(opt)) errors.push(`Interactive menu ${node.id} option "${opt}" has no successor`)
      }
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

  // Cycle detection is barrier-aware. Nodes that PAUSE the run — interactive
  // menus and wait_for_reply (await the patient's next message), delay, and
  // approval — end a synchronous segment: control returns to the queue and the
  // run resumes on a later turn. So a loop is only illegal when it is fully
  // synchronous (spins within one turn); conversational loops that pass through
  // a pause node (footer "0" → main menu, an unrecognized reply re-showing a
  // menu) are legitimate and runtime-safe (the engine's visited guard + MAX_STEPS
  // still bound a single turn). Each pause node seeds a fresh DFS segment.
  const PAUSE_NODE_TYPES = new Set(['action.interactive_menu', 'logic.wait_for_reply', 'logic.delay', 'action.approval'])
  const typeById = new Map(nodes.map((node) => [node.id, node.type]))
  const reachable = new Set<string>()
  const color = new Map<string, 'gray' | 'black'>()
  const roots: string[] = [triggers[0]!.id]
  const seenRoots = new Set<string>(roots)

  const dfs = (id: string): void => {
    color.set(id, 'gray')
    reachable.add(id)
    for (const edge of outgoing.get(id) ?? []) {
      const target = edge.target
      reachable.add(target)
      if (PAUSE_NODE_TYPES.has(typeById.get(target) ?? '')) {
        // Barrier: the current synchronous segment ends here; explore the pause
        // node's own outgoing edges as a separate segment.
        if (!seenRoots.has(target)) {
          seenRoots.add(target)
          roots.push(target)
        }
        continue
      }
      const c = color.get(target)
      if (c === 'gray') errors.push(`Cycle detected at node: ${target}`)
      else if (c !== 'black') dfs(target)
    }
    color.set(id, 'black')
  }

  while (roots.length > 0) {
    const root = roots.shift()!
    if (color.get(root) === 'black') continue
    dfs(root)
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) errors.push(`Node ${node.id} is unreachable from the trigger`)
  }
  return errors
}
