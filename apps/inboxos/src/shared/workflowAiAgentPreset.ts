import type { WorkflowEdge, WorkflowNode } from './types'
import { findFreePosition } from './workflowLayout'

const CONTROLLED_KB_SCENARIOS = JSON.stringify([
  {
    id: 'clinic_kb_question',
    description: 'The patient asks about the clinic, its doctors, services, location, hours, policies, pricing, or booking process and the answer is supported by approved clinic knowledge.',
    action: 'reply',
  },
  {
    id: 'human_or_unsafe',
    description: 'The patient asks for a person, the answer is missing or uncertain, sources conflict, or the request is medical, safety-sensitive, or unsupported.',
    action: 'handoff',
  },
])

export const CONTROLLED_KB_AGENT_CONFIG: Record<string, unknown> = {
  agentProvider: 'inherit',
  agentModel: '',
  agentMaxTokens: '512',
  personality: 'Helpful clinic knowledge assistant',
  communicationStyle: 'friendly',
  customInstructions: 'Answer only from the clinic knowledge base and current clinic context. Treat approved clinic knowledge as the source of truth. Never use general model knowledge to fill a gap, diagnose, or provide unsupported medical advice. If the answer is unavailable, uncertain, conflicting, safety-sensitive, or the patient requests a person, hand off to the secretary.',
  scenarios: CONTROLLED_KB_SCENARIOS,
}

function uniqueNodeId(nodes: WorkflowNode[], base: string): string {
  const used = new Set(nodes.map((node) => node.id))
  let suffix = 1
  while (used.has(`${base}_${suffix}`)) suffix++
  return `${base}_${suffix}`
}

function uniqueEdgeId(edges: WorkflowEdge[], base: string): string {
  const used = new Set(edges.map((edge) => edge.id))
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}_${suffix}`)) suffix++
  return `${base}_${suffix}`
}

export interface ControlledKbAgentPresetOptions {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  position: { x: number; y: number }
  incoming?: { source: string; sourceHandle?: string }
  terminalNodeId?: string
}

/**
 * Insert the safe authoring preset for the existing RAG-backed AI Agent
 * runtime. The preset is intentionally a complete subgraph: a grounded reply
 * ends normally, while every fail-closed outcome hands the conversation to a
 * secretary before ending.
 */
export function insertControlledKbAgentPreset({
  nodes,
  edges,
  position,
  incoming,
  terminalNodeId,
}: ControlledKbAgentPresetOptions): { nodes: WorkflowNode[]; edges: WorkflowEdge[]; selectedNodeId: string } {
  const agentId = uniqueNodeId(nodes, 'ai_agent')
  const handoffId = uniqueNodeId(nodes, 'kb_handoff')
  const existingTerminal = terminalNodeId
    ? nodes.find((node) => node.id === terminalNodeId && node.type === 'action.end')
    : undefined
  const endId = existingTerminal?.id ?? uniqueNodeId(nodes, 'kb_end')

  const agentPosition = findFreePosition(nodes, position)
  const agent: WorkflowNode = {
    id: agentId,
    kind: 'action',
    type: 'action.ai_agent',
    config: { ...CONTROLLED_KB_AGENT_CONFIG },
    x: Math.round(agentPosition.x),
    y: Math.round(agentPosition.y),
  }
  const handoffPosition = findFreePosition([...nodes, agent], { x: agent.x + 300, y: agent.y + 180 })
  const handoff: WorkflowNode = {
    id: handoffId,
    kind: 'action',
    type: 'action.handoff_to_secretary',
    config: {},
    x: Math.round(handoffPosition.x),
    y: Math.round(handoffPosition.y),
  }
  const endPosition = existingTerminal
    ? { x: existingTerminal.x, y: existingTerminal.y }
    : findFreePosition([...nodes, agent, handoff], { x: agent.x + 600, y: agent.y })
  const end: WorkflowNode = existingTerminal ?? {
    id: endId,
    kind: 'action',
    type: 'action.end',
    config: {},
    x: Math.round(endPosition.x),
    y: Math.round(endPosition.y),
  }

  const nextEdges = [...edges]
  const addEdge = (source: string, target: string, sourceHandle?: string) => {
    const base = `e_${source}_${target}_${sourceHandle ?? 'default'}`
    nextEdges.push({
      id: uniqueEdgeId(nextEdges, base),
      source,
      target,
      ...(sourceHandle ? { sourceHandle } : {}),
    })
  }

  if (incoming) addEdge(incoming.source, agentId, incoming.sourceHandle)
  addEdge(agentId, endId, 'replied')
  addEdge(agentId, handoffId, 'handoff')
  addEdge(agentId, handoffId, 'no_match')
  addEdge(agentId, handoffId, 'error')
  addEdge(handoffId, endId)

  return {
    nodes: [...nodes, agent, handoff, ...(existingTerminal ? [] : [end])],
    edges: nextEdges,
    selectedNodeId: agentId,
  }
}
