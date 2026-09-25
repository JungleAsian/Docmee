import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
import type { WorkflowNode } from './types'
import { insertControlledKbAgentPreset } from './workflowAiAgentPreset'

const trigger: WorkflowNode = {
  id: 'trigger',
  kind: 'trigger',
  type: 'trigger.message_keyword',
  config: {},
  x: 0,
  y: 0,
}

describe('controlled clinic KB AI Agent preset', () => {
  it('inserts a valid fail-closed AI Agent subgraph with every outcome routed', () => {
    const result = insertControlledKbAgentPreset({
      nodes: [trigger],
      edges: [],
      position: { x: 280, y: 40 },
      incoming: { source: trigger.id },
    })

    const agent = result.nodes.find((node) => node.id === result.selectedNodeId)
    const handoff = result.nodes.find((node) => node.type === 'action.handoff_to_secretary')
    const end = result.nodes.find((node) => node.type === 'action.end')

    expect(agent).toMatchObject({
      kind: 'action',
      type: 'action.ai_agent',
      config: {
        agentProvider: 'inherit',
        agentModel: '',
        knowledgePolicy: 'strict_kb',
        communicationStyle: 'friendly',
        personality: 'Helpful clinic knowledge assistant',
      },
    })
    expect(String(agent?.config.customInstructions).toLowerCase()).toContain('only from the clinic knowledge base')
    expect(JSON.parse(String(agent?.config.scenarios))).toEqual([
      expect.objectContaining({ id: 'clinic_kb_question', action: 'reply' }),
      expect.objectContaining({ id: 'human_or_unsafe', action: 'handoff' }),
    ])
    expect(handoff).toBeDefined()
    expect(end).toBeDefined()

    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: trigger.id, target: agent?.id }),
      expect.objectContaining({ source: agent?.id, target: end?.id, sourceHandle: 'replied' }),
      expect.objectContaining({ source: agent?.id, target: handoff?.id, sourceHandle: 'handoff' }),
      expect.objectContaining({ source: agent?.id, target: handoff?.id, sourceHandle: 'no_match' }),
      expect.objectContaining({ source: agent?.id, target: handoff?.id, sourceHandle: 'error' }),
      expect.objectContaining({ source: handoff?.id, target: end?.id }),
    ]))
    expect(validateWorkflowDefinition(result.nodes, result.edges, { requireTrigger: true })).toEqual([])
  })

  it('generates collision-free node and edge ids when inserted more than once', () => {
    const first = insertControlledKbAgentPreset({ nodes: [], edges: [], position: { x: 0, y: 0 } })
    const second = insertControlledKbAgentPreset({ nodes: first.nodes, edges: first.edges, position: { x: 0, y: 320 } })

    expect(new Set(second.nodes.map((node) => node.id)).size).toBe(second.nodes.length)
    expect(new Set(second.edges.map((edge) => edge.id)).size).toBe(second.edges.length)
  })

  it('can reuse an existing terminal node in the Guided builder', () => {
    const terminal: WorkflowNode = { id: 'existing_end', kind: 'action', type: 'action.end', config: {}, x: 0, y: 0 }
    const result = insertControlledKbAgentPreset({
      nodes: [trigger, terminal],
      edges: [],
      position: { x: 0, y: 0 },
      terminalNodeId: terminal.id,
    })

    expect(result.nodes.filter((node) => node.type === 'action.end')).toEqual([terminal])
    expect(result.edges).toContainEqual(expect.objectContaining({
      source: expect.stringMatching(/^ai_agent_/),
      target: terminal.id,
      sourceHandle: 'replied',
    }))
  })
})
