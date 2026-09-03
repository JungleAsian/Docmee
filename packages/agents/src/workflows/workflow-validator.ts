import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { parseMenuOptions, MENU_RESERVED_HANDLES, parseAiAgentScenarios } from './workflow-engine.js'
import { validateWorkflowPortConnection } from './workflow-ports.js'

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

export type WorkflowValidationIssueCode =
  | 'interactive_menu_unknown_handle'
  | 'unknown_handle'
  | 'missing_branch'
  | 'ambiguous_branch'
  | 'missing_successor'
  | 'duplicate_connection'
  | 'invalid_setting'
  | 'incomplete_node'
  | 'invalid_connection'
  | 'invalid_port_connection'
  | 'invalid_node'
  | 'unreachable_node'
  | 'cycle'
  | 'invalid_graph'

export interface WorkflowValidationIssue {
  code: WorkflowValidationIssueCode
  severity: 'error'
  title: string
  where: string
  whatHappened: string
  howToFix: string
  translations?: {
    es?: {
      title?: string
      whatHappened?: string
      howToFix?: string
    }
  }
  nodeId?: string
  edgeId?: string
  branch?: string
  technicalDetails: string
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

  const nodesByIdEarly = new Map(nodes.map((node) => [node.id, node]))
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
    const portError = validateWorkflowPortConnection(edge, nodesByIdEarly.get(edge.source), nodesByIdEarly.get(edge.target))
    if (portError) errors.push(portError)
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

function prettifyWorkflowId(id: string): string {
  const words = id
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Workflow'
}

function nodeLabel(node: WorkflowNode | undefined, fallbackId?: string): string {
  const customLabel = node?.config?.['customLabel']
  if (typeof customLabel === 'string' && customLabel.trim()) return customLabel.trim()
  return prettifyWorkflowId(node?.id ?? fallbackId ?? 'workflow')
}

function issueFromTechnicalDetail(
  technicalDetails: string,
  nodesById: Map<string, WorkflowNode>,
  edgesById: Map<string, WorkflowEdge>,
): WorkflowValidationIssue {
  const base = (overrides: Partial<WorkflowValidationIssue>): WorkflowValidationIssue => {
    const nodeId = overrides.nodeId
    const edgeId = overrides.edgeId
    const inferredEdge = edgeId ? edgesById.get(edgeId) : undefined
    const inferredNodeId = nodeId ?? inferredEdge?.source
    return {
      code: overrides.code ?? 'invalid_graph',
      severity: 'error',
      title: overrides.title ?? 'One workflow item needs attention',
      where: overrides.where ?? nodeLabel(inferredNodeId ? nodesById.get(inferredNodeId) : undefined, inferredNodeId),
      whatHappened: overrides.whatHappened ?? 'Something in this workflow is incomplete or no longer matches the saved graph.',
      howToFix: overrides.howToFix ?? 'Open the highlighted item, check its settings and connections, then reconnect or remove anything that no longer applies.',
      translations: overrides.translations ?? {
        es: {
          title: 'Un elemento del flujo necesita atención',
          whatHappened: 'Algo en este flujo está incompleto o ya no coincide con el gráfico guardado.',
          howToFix: 'Abre el elemento resaltado, revisa su configuración y conexiones, y vuelve a conectar o elimina lo que ya no corresponde.',
        },
      },
      technicalDetails,
      ...overrides,
    }
  }

  let match = technicalDetails.match(/^Interactive menu edge ([^\s]+) is connected to option "([^"]*)", which doesn't exist on node ([^\s]+) \(unknown handle "([^"]*)"\)/)
  if (match) {
    const [, edgeId, branch, nodeId] = match
    return base({
      code: 'interactive_menu_unknown_handle',
      title: 'One menu connection needs attention',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      edgeId,
      branch,
      whatHappened: 'A connection from this menu is not attached to a valid choice. The choice may have been renamed or removed.',
      howToFix: 'Open the menu, remove the broken connection, then reconnect the correct choice.',
      translations: {
        es: {
          title: 'Una conexión del menú necesita atención',
          whatHappened: 'Una conexión de este menú no está unida a una opción válida. Es posible que la opción se haya renombrado o eliminado.',
          howToFix: 'Abre el menú, elimina la conexión rota y vuelve a conectar la opción correcta.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Edge ([^\s]+) (?:leaves end node|targets trigger node) ([^,]+), which has no (?:output|input) port\./)
  if (match) {
    const [, edgeId] = match
    const edge = edgesById.get(edgeId)
    return base({
      code: 'invalid_port_connection',
      title: 'One connection uses an unavailable port',
      where: nodeLabel(edge?.source ? nodesById.get(edge.source) : undefined, edge?.source),
      nodeId: edge?.source,
      edgeId,
      whatHappened: 'This connection leaves a node with no output or enters a node with no input.',
      howToFix: 'Delete the connection, then connect a valid output to a valid input on the next workflow step.',
      translations: {
        es: {
          title: 'Una conexión usa un puerto no disponible',
          whatHappened: 'Esta conexión sale de un nodo sin salida o entra en un nodo sin entrada.',
          howToFix: 'Elimina la conexión y une una salida válida con la entrada válida del siguiente paso.',
        },
      },
    })
  }

  match = technicalDetails.match(/^(?:Slot menu|AI Agent) edge ([^\s]+) is connected to (?:a branch|branch) "([^"]*)" that node ([^\s]+) doesn't produce \(unknown handle/)
  if (match) {
    const [, edgeId, branch, nodeId] = match
    return base({
      code: 'unknown_handle',
      title: 'One branch connection needs attention',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      edgeId,
      branch,
      whatHappened: 'This connection is attached to an output that the node no longer provides.',
      howToFix: 'Reconnect this branch to one of the node’s current outputs, or delete the stale connection.',
      translations: {
        es: {
          title: 'Una conexión de rama necesita atención',
          whatHappened: 'Esta conexión está unida a una salida que el nodo ya no tiene.',
          howToFix: 'Vuelve a conectar esta rama a una de las salidas actuales del nodo, o elimina la conexión anterior.',
        },
      },
    })
  }

  match = technicalDetails.match(/^(Condition node|Intent classifier|Interactive menu|Slot menu|AI Agent) ([^\s]+).*missing|^Slot menu ([^\s]+) has no "([^"]+)" branch connected/)
  if (match && /missing|has no ".+" branch/.test(technicalDetails)) {
    const nodeId = match[2] ?? match[3]
    return base({
      code: 'missing_branch',
      title: 'One required branch is not connected',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This node has an outcome that patients or the workflow can reach, but that outcome has nowhere to go.',
      howToFix: 'Drag a connection from the missing output to the next safe step, such as a message, secretary handoff, restart menu, or end node.',
      translations: {
        es: {
          title: 'Falta conectar una rama requerida',
          whatHappened: 'Este nodo tiene una salida que el paciente o el flujo puede alcanzar, pero esa salida no lleva a ninguna parte.',
          howToFix: 'Arrastra una conexión desde la salida faltante hacia el siguiente paso seguro, como un mensaje, traspaso a secretaria, menú de reinicio o fin.',
        },
      },
    })
  }

  match = technicalDetails.match(/^(Condition node|Interactive menu|Slot menu|AI Agent) ([^\s]+) has more than one edge leaving its "([^"]+)"/)
  if (match) {
    const [, , nodeId, branch] = match
    return base({
      code: 'ambiguous_branch',
      title: 'One option goes to more than one place',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      branch,
      whatHappened: 'The workflow has multiple connections from the same option, so it cannot know which path to follow.',
      howToFix: 'Keep one connection for this option and delete the extra connection.',
      translations: {
        es: {
          title: 'Una opción va a más de un lugar',
          whatHappened: 'El flujo tiene varias conexiones desde la misma opción, así que no puede saber qué camino seguir.',
          howToFix: 'Deja una sola conexión para esta opción y elimina la conexión extra.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Node ([^\s]+) has (?:no outgoing edge|[0-9]+ outgoing edges)/)
  if (match) {
    const [, nodeId] = match
    return base({
      code: 'missing_successor',
      title: 'One step does not have a clear next step',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This step must continue to exactly one next step, but its next step is missing or unclear.',
      howToFix: 'Connect this step to the next node, or remove extra outgoing connections until only one remains.',
      translations: {
        es: {
          title: 'Un paso no tiene un siguiente paso claro',
          whatHappened: 'Este paso debe continuar exactamente a un siguiente paso, pero falta o no está claro.',
          howToFix: 'Conecta este paso al siguiente nodo, o elimina conexiones de salida extra hasta que quede solo una.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Edge ([^\s]+) (?:starts from|points to|connects)/)
  if (match) {
    const [, edgeId] = match
    const edge = edgesById.get(edgeId)
    return base({
      code: 'invalid_connection',
      title: 'One connection is invalid',
      where: nodeLabel(edge?.source ? nodesById.get(edge.source) : undefined, edge?.source),
      nodeId: edge?.source,
      edgeId,
      whatHappened: 'A connection points to something invalid, missing, or unsafe.',
      howToFix: 'Delete this connection and draw a new one between valid nodes.',
      translations: {
        es: {
          title: 'Una conexión no es válida',
          whatHappened: 'Una conexión apunta a algo no válido, faltante o inseguro.',
          howToFix: 'Elimina esta conexión y dibuja una nueva entre nodos válidos.',
        },
      },
    })
  }

  match = technicalDetails.match(/^(Interactive menu|Slot menu|AI Agent|Delay node) ([^\s]+) .*invalid|^Interactive menu ([^\s]+) has invalid/)
  if (match) {
    const nodeId = match[2] ?? match[3]
    return base({
      code: 'invalid_setting',
      title: 'One setting needs to be corrected',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This node has a setting that is not supported by the workflow runner.',
      howToFix: 'Open the node settings and choose a valid value from the available options.',
      translations: {
        es: {
          title: 'Hay que corregir una configuración',
          whatHappened: 'Este nodo tiene una configuración que el ejecutor del flujo no soporta.',
          howToFix: 'Abre la configuración del nodo y elige un valor válido entre las opciones disponibles.',
        },
      },
    })
  }

  match = technicalDetails.match(/^(Interactive menu|AI Agent|Delay node|Message node) ([^\s]+) .*requires|^Interactive menu ([^\s]+)'s option/)
  if (match) {
    const nodeId = match[2] ?? match[3]
    return base({
      code: 'incomplete_node',
      title: 'One node is incomplete',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This node is missing required content, options, or setup.',
      howToFix: 'Open the node, fill in the required fields, then save again.',
      translations: {
        es: {
          title: 'Un nodo está incompleto',
          whatHappened: 'A este nodo le falta contenido, opciones o configuración requerida.',
          howToFix: 'Abre el nodo, completa los campos requeridos y vuelve a guardar.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Node ([^\s]+) has no path from the trigger/)
  if (match) {
    const [, nodeId] = match
    return base({
      code: 'unreachable_node',
      title: 'One node is disconnected from the workflow',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This node is on the canvas, but the workflow can never reach it from the trigger.',
      howToFix: 'Connect it into the workflow path, or delete it if it is no longer needed.',
      translations: {
        es: {
          title: 'Un nodo está desconectado del flujo',
          whatHappened: 'Este nodo está en el lienzo, pero el flujo nunca puede llegar a él desde el disparador.',
          howToFix: 'Conéctalo dentro del camino del flujo, o elimínalo si ya no hace falta.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Node ([^\s]+) is part of a loop/)
  if (match) {
    const [, nodeId] = match
    return base({
      code: 'cycle',
      title: 'One loop needs a pause or ending',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
      whatHappened: 'This loop can run without waiting for the patient, which could make the workflow spin forever.',
      howToFix: 'Break the loop, route it to End, or make it pass through a menu, wait-for-reply, delay, or approval step.',
      translations: {
        es: {
          title: 'Un ciclo necesita una pausa o final',
          whatHappened: 'Este ciclo puede ejecutarse sin esperar al paciente, lo que podría hacer que el flujo se repita sin parar.',
          howToFix: 'Rompe el ciclo, envíalo a Fin, o haz que pase por un menú, espera de respuesta, demora o aprobación.',
        },
      },
    })
  }

  match = technicalDetails.match(/^Node ([^\s]+) /)
  if (match) {
    const [, nodeId] = match
    return base({
      code: 'invalid_node',
      title: 'One node needs attention',
      where: nodeLabel(nodesById.get(nodeId), nodeId),
      nodeId,
    })
  }

  return base({})
}

export function validateWorkflowDefinitionDetailed(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  options: WorkflowValidationOptions = {},
): WorkflowValidationIssue[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const edgesById = new Map(edges.map((edge) => [edge.id, edge]))
  return validateWorkflowDefinition(nodes, edges, options).map((detail) => issueFromTechnicalDetail(detail, nodesById, edgesById))
}
