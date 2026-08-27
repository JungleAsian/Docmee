import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { parseMenuOptions, MENU_RESERVED_HANDLES, parseAiAgentScenarios } from './workflow-engine.js'

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
  ['action.handoff_to_secretary', 'action'],
  ['action.add_tag', 'action'],
  ['action.ai_draft', 'action'],
  ['action.approval', 'action'],
  ['action.ask_capture', 'action'],
  ['action.interactive_menu', 'action'],
  ['action.extract_booking_details', 'action'],
  ['action.check_availability', 'action'],
  ['action.offer_slots', 'action'],
  ['action.offer_slot_menu', 'action'],
  ['action.create_or_reschedule_booking', 'action'],
  ['action.transcribe_booking_voice', 'action'],
  ['action.ai_agent', 'action'],
  ['action.end', 'action'],
])

/** Only these triggers have an event producer in the worker runtime. */
export const SUPPORTED_WORKFLOW_TRIGGER_TYPES = ['trigger.message_keyword', 'trigger.patient_upset'] as const

/**
 * Nodes that PAUSE the run — interactive menus and wait_for_reply (await the
 * patient's next message), delay, and approval — end a synchronous segment:
 * control returns to the queue and the run resumes on a later turn.
 */
const PAUSE_NODE_TYPES = new Set([
  'action.interactive_menu',
  'action.offer_slot_menu',
  'logic.wait_for_reply',
  'logic.delay',
  'action.approval',
])

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
    if (ids.has(node.id)) {
      errors.push(`Two nodes share the id "${node.id}" (duplicate node id). This usually happens after copy-pasting a node — delete or rename one of them so every node has a unique id.`)
    }
    ids.add(node.id)
    const expectedKind = nodeKinds.get(node.type)
    if (!expectedKind) {
      errors.push(`Node ${node.id} has type "${node.type}" (unsupported node type), which this workflow runner doesn't recognize. Replace it with a node from the builder's node panel instead of a custom/imported type.`)
    } else if (expectedKind !== node.kind) {
      errors.push(`Node ${node.id} is marked as kind "${node.kind}", but its type "${node.type}" should be kind "${expectedKind}" (kind/type mismatch). This is a data-consistency issue, usually from a hand-edited import — recreate the node from the builder's node panel instead of editing the JSON directly.`)
    }
  }

  const triggers = nodes.filter((node) => node.kind === 'trigger')
  if (triggers.length > 1) {
    errors.push(`This workflow has ${triggers.length} trigger nodes, but a workflow may have exactly one trigger. Delete all but one trigger node.`)
  }
  if (requireTrigger && triggers.length !== 1) {
    errors.push('This workflow has no trigger node, so it can never start (an active workflow requires exactly one trigger). Add exactly one trigger node — e.g. "Message keyword" or "Patient upset" — from the node panel.')
  }

  const typeByIdEarly = new Map(nodes.map((node) => [node.id, node.type]))
  const outgoing = new Map<string, WorkflowEdge[]>()
  for (const edge of edges) {
    if (edgeIds.has(edge.id)) {
      errors.push(`Two edges share the id "${edge.id}" (duplicate edge id). This usually happens after copy-pasting a connection — delete or reconnect one of them.`)
    }
    edgeIds.add(edge.id)
    if (!ids.has(edge.source)) {
      errors.push(`Edge ${edge.id} starts from node "${edge.source}", which no longer exists on the canvas (unknown source). Delete this edge, or reconnect it from an existing node.`)
    }
    if (!ids.has(edge.target)) {
      errors.push(`Edge ${edge.id} points to node "${edge.target}", which no longer exists on the canvas (unknown target). Delete this edge, or reconnect it to an existing node.`)
    }
    // Self-loops are legal on pause nodes only: an interactive menu re-showing
    // itself on an unmatched reply (default) or a footer restart resumes on the
    // patient's next turn, so the loop is conversational, not synchronous. A
    // self-loop on any other node would spin within a single turn.
    if (edge.source === edge.target && !PAUSE_NODE_TYPES.has(typeByIdEarly.get(edge.source) ?? '')) {
      errors.push(`Edge ${edge.id} connects node "${edge.source}" back to itself (cannot point to the same node). Only a menu, wait-for-reply, delay, or approval node can loop to itself — remove this edge, or route it to a different node.`)
    }
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
    if (node.type === 'action.end' && next.length > 0) {
      errors.push(`The end node ${node.id} has ${next.length} outgoing edge${next.length === 1 ? '' : 's'}, but an end node must be a dead end (cannot have outgoing edges). Delete the edge(s) leaving this node.`)
    }
    if (
      node.type !== 'action.end' &&
      node.type !== 'logic.condition' &&
      node.type !== 'logic.ai_classify_intent' &&
      node.type !== 'action.interactive_menu' &&
      node.type !== 'action.offer_slot_menu' &&
      node.type !== 'action.ai_agent' &&
      next.length !== 1
    ) {
      errors.push(
        next.length === 0
          ? `Node ${node.id} has no outgoing edge (must have exactly one successor). Connect it to the next node in the flow.`
          : `Node ${node.id} has ${next.length} outgoing edges (must have exactly one successor). Delete the extra edge(s) so it points to exactly one next node.`,
      )
    }
    if (node.type === 'logic.condition') {
      const handles = new Set<string>()
      for (const edge of next) {
        if (edge.sourceHandle !== 'true' && edge.sourceHandle !== 'false') {
          errors.push(`Condition edge ${edge.id} isn't connected to node ${node.id}'s True or False output (must use the true or false handle). Delete it and drag a new edge from the True or False handle.`)
        }
        if (edge.sourceHandle && handles.has(edge.sourceHandle)) {
          errors.push(`Condition node ${node.id} has more than one edge leaving its "${edge.sourceHandle}" branch (ambiguous ${edge.sourceHandle} branch). Keep only one edge per branch — delete the extra one.`)
        }
        if (edge.sourceHandle) handles.add(edge.sourceHandle)
      }
      if (!handles.has('true') || !handles.has('false')) {
        const missing = ['true', 'false'].filter((h) => !handles.has(h))
        errors.push(`Condition node ${node.id} is missing its ${missing.join(' and ')} branch (requires true and false successors). Connect an edge from each missing handle to a next node.`)
      }
    }
    if (node.type === 'logic.ai_classify_intent') {
      const handles = new Set(next.map((edge) => edge.sourceHandle).filter((handle): handle is string => Boolean(handle)))
      for (const handle of ['high', 'low', 'error']) {
        if (!handles.has(handle)) errors.push(`Intent classifier ${node.id} is missing its "${handle}" branch (requires a ${handle} successor). Connect an edge from the "${handle}" handle to a next node.`)
      }
      if (handles.size !== next.length) {
        errors.push(`Intent classifier ${node.id} has an edge with no branch label, or two edges sharing the same branch (unlabeled or ambiguous branch). Each outgoing edge must come from exactly one of the high/low/error handles — check for a stray or duplicate connection.`)
      }
    }
    if (node.type === 'action.interactive_menu') {
      const options = parseMenuOptions(node.config)
      const optionSource = String(node.config?.['optionSource'] ?? 'static')
      const dynamic = optionSource === 'clinic_doctors' || optionSource === 'doctor_services'
      if (!['static', 'clinic_doctors', 'doctor_services'].includes(optionSource)) {
        errors.push(`Interactive menu ${node.id} has invalid optionSource "${optionSource}".`)
      }
      // Matches the worker's own default (workflow-runner.worker.ts) and the
      // Studio dropdown's first/visually-selected enum entry — an untouched
      // node must validate the same way it looks and the same way it'll run.
      const variant = String(node.config?.['variant'] ?? 'list')
      const limit = variant === 'list' ? 10 : 3
      if (!dynamic && options.length === 0) {
        errors.push(`Interactive menu ${node.id} has no options configured (requires at least one option). Open the node and add at least one menu option.`)
      } else if (options.length > limit) {
        errors.push(`Interactive menu ${node.id} has ${options.length} options, more than WhatsApp allows for the "${variant}" style (max ${limit}). Remove options, or switch this node to "list" style, which allows up to 10.`)
      }
      // WhatsApp's two interactive kinds cap option titles differently: a list
      // row allows 24 chars, but a reply BUTTON allows only 20 — sending a
      // longer button title doesn't truncate, it's rejected outright (#131009
      // "Parameter value is not valid"), which the send path's catch silently
      // downgrades to a plain-text fallback with no tappable options at all.
      const titleLimit = variant === 'list' ? 24 : 20
      const seen = new Set<string>()
      for (const opt of options) {
        if (seen.has(opt.optionId)) {
          errors.push(`Interactive menu ${node.id} has two options sharing the id "${opt.optionId}" (duplicate option). Give each option a unique id — rename one of the duplicates.`)
        }
        seen.add(opt.optionId)
        if (opt.title.length > titleLimit) {
          errors.push(`Interactive menu ${node.id}'s option "${opt.optionId}" title is longer than WhatsApp's ${titleLimit}-character limit for the "${variant}" style (title exceeds ${titleLimit} chars). Shorten the option's title.`)
        }
      }
      // Static menus expose one handle per authored option. Dynamic menus use
      // fixed outcomes because their database ids are only known at runtime.
      const validHandles = new Set<string>(dynamic
        ? ['selected', 'empty', 'restart', 'livechat']
        : [...seen, ...MENU_RESERVED_HANDLES])
      const wired = new Set<string>()
      for (const edge of next) {
        const h = edge.sourceHandle ?? ''
        if (!validHandles.has(h)) {
          errors.push(`Interactive menu edge ${edge.id} is connected to option "${h}", which doesn't exist on node ${node.id} (unknown handle "${h}") — it was likely renamed or deleted. Reconnect this edge to one of the menu's current options, or delete the edge.`)
        }
        if (wired.has(h)) {
          errors.push(`Interactive menu ${node.id} has more than one edge leaving its "${h}" option (ambiguous "${h}" branch). Each option can only lead to one next node — delete the extra edge.`)
        }
        wired.add(h)
      }
      if (dynamic) {
        for (const required of ['selected', 'empty']) {
          if (!wired.has(required)) {
            const article = required === 'empty' ? 'an' : 'a'
            errors.push(`Interactive menu ${node.id} requires ${article} "${required}" successor for dynamic options.`)
          }
        }
      } else {
        for (const opt of seen) {
          if (!wired.has(opt)) {
            errors.push(`Interactive menu ${node.id}'s option "${opt}" isn't connected to anything (has no successor). Drag an edge from that option to the node it should lead to.`)
          }
        }
      }
    }
    if (node.type === 'action.offer_slot_menu') {
      // Matches the worker's three call sites (all default to 'date') — an
      // untouched node must not fail validation before the admin ever touches
      // the picker-mode dropdown.
      const mode = String(node.config?.['pickerMode'] ?? 'date')
      if (mode !== 'date' && mode !== 'time') {
        errors.push(`Slot menu ${node.id} has picker mode "${mode}", which isn't valid (invalid pickerMode "${mode}" — must be "date" or "time"). Open the node and choose a valid picker mode.`)
      }
      const validHandles = new Set(['selected', 'empty', 'restart', 'livechat'])
      const wired = new Set<string>()
      for (const edge of next) {
        const h = edge.sourceHandle ?? ''
        if (!validHandles.has(h)) {
          errors.push(`Slot menu edge ${edge.id} is connected to a branch "${h}" that node ${node.id} doesn't produce (unknown handle "${h}" — valid branches are selected/empty/restart/livechat). Reconnect this edge to one of those, or delete it.`)
        }
        if (wired.has(h)) {
          errors.push(`Slot menu ${node.id} has more than one edge leaving its "${h}" branch (ambiguous "${h}" branch). Keep only one edge per branch — delete the extra edge.`)
        }
        wired.add(h)
      }
      if (!wired.has('selected')) {
        errors.push(`Slot menu ${node.id} has no "selected" branch connected (requires a "selected" successor). Add an edge from the node's "selected" handle to what should happen once the patient picks a slot.`)
      }
      if (!wired.has('empty')) {
        errors.push(`Slot menu ${node.id} has no "empty" branch connected (requires an "empty" successor for when no slots are available). Add an edge from the node's "empty" handle to what should happen then.`)
      }
    }
    if (node.type === 'action.ai_agent') {
      const style = String(node.config?.['communicationStyle'] ?? '')
      if (style && !['professional', 'friendly', 'brief'].includes(style)) {
        errors.push(`AI Agent ${node.id} has communication style "${style}", which isn't valid (invalid communicationStyle "${style}" — must be professional, friendly, or brief). Open the node and choose a valid style.`)
      }
      const scenarios = parseAiAgentScenarios(node.config)
      if (scenarios.length === 0) {
        errors.push(`AI Agent ${node.id} has no scenarios configured (requires at least one scenario). Open the node and add at least one scenario describing when it should respond.`)
      }
      const seenScenarioIds = new Set<string>()
      for (const s of scenarios) {
        if (seenScenarioIds.has(s.id)) {
          errors.push(`AI Agent ${node.id} has two scenarios sharing the id "${s.id}" (duplicate scenario id). Give each scenario a unique id — rename one of the duplicates.`)
        }
        seenScenarioIds.add(s.id)
        if (!s.description.trim()) {
          errors.push(`AI Agent ${node.id} has a scenario with no description. Open the node and describe what this scenario should handle.`)
        }
        if (s.action === 'route' && !s.targetWorkflowId?.trim()) {
          errors.push(`AI Agent ${node.id}'s scenario "${s.id}" is set to "route" but has no target workflow (requires a target workflow). Open the node and choose which workflow it should hand off to.`)
        }
      }
      const handles = new Set(next.map((edge) => edge.sourceHandle).filter((h): h is string => Boolean(h)))
      for (const handle of ['replied', 'handoff', 'no_match', 'error']) {
        if (!handles.has(handle)) {
          errors.push(`AI Agent ${node.id} is missing its "${handle}" branch (requires a ${handle} successor). Connect an edge from the node's "${handle}" handle to a next node.`)
        }
      }
      const validHandles = new Set(['replied', 'handoff', 'no_match', 'error'])
      const wired = new Set<string>()
      for (const edge of next) {
        const h = edge.sourceHandle ?? ''
        if (!validHandles.has(h)) {
          errors.push(`AI Agent edge ${edge.id} is connected to a branch "${h}" that node ${node.id} doesn't produce (unknown handle "${h}" — valid branches are replied/handoff/no_match/error). Reconnect this edge to one of those, or delete it.`)
        }
        if (wired.has(h)) {
          errors.push(`AI Agent ${node.id} has more than one edge leaving its "${h}" branch (ambiguous "${h}" branch). Keep only one edge per branch — delete the extra edge.`)
        }
        wired.add(h)
      }
    }
    if (node.type === 'logic.delay') {
      const amount = Number(node.config?.['amount'])
      if (!Number.isFinite(amount) || amount <= 0) {
        errors.push(`Delay node ${node.id} has no delay amount set, or it's zero or negative (requires a positive amount). Open the node and enter a positive number.`)
      }
      if (!['minute', 'hour', 'day'].includes(String(node.config?.['unit'] ?? ''))) {
        errors.push(`Delay node ${node.id} has no valid time unit selected (invalid unit — must be minute, hour, or day). Open the node and choose a unit.`)
      }
    }
    if (node.type === 'action.send_message' && !String(node.config?.['text'] ?? '').trim()) {
      errors.push(`Message node ${node.id} has no message text (requires text). Open the node and write the message it should send.`)
    }
  }

  if (triggers.length !== 1) return errors

  // Cycle detection is barrier-aware. So a loop is only illegal when it is fully
  // synchronous (spins within one turn); conversational loops that pass through
  // a pause node (footer "0" → main menu, an unrecognized reply re-showing a
  // menu) are legitimate and runtime-safe (the engine's visited guard + MAX_STEPS
  // still bound a single turn). Each pause node seeds a fresh DFS segment.
  const typeById = typeByIdEarly
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
      if (c === 'gray') {
        errors.push(`Node ${target} is part of a loop that never pauses for a patient reply (Cycle detected at node: ${target}) — e.g. two message nodes pointing back at each other. Break the cycle by routing through an end node, or loop back through a menu/wait-for-reply/delay/approval node instead, which can pause between turns.`)
      } else if (c !== 'black') dfs(target)
    }
    color.set(id, 'black')
  }

  while (roots.length > 0) {
    const root = roots.shift()!
    if (color.get(root) === 'black') continue
    dfs(root)
  }

  for (const node of nodes) {
    if (!reachable.has(node.id)) {
      errors.push(`Node ${node.id} has no path from the trigger (unreachable from the trigger), so it will never run. Connect it to the rest of the workflow, or delete it if it's no longer needed.`)
    }
  }
  return errors
}
