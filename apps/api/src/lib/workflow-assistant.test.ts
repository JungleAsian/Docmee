import { describe, expect, it } from 'vitest'
import { parseWorkflowProposal, workflowAssistantContext } from './workflow-assistant.js'

const graph = {
  nodes: [
    { id: 'start', kind: 'trigger' as const, type: 'trigger.message_keyword', config: { keywords: 'any words' }, x: 0, y: 0 },
    { id: 'end', kind: 'action' as const, type: 'action.end', config: {}, x: 300, y: 0 },
  ],
  edges: [{ id: 'edge', source: 'start', target: 'end' }],
}
const proposal = (changes = {}) => JSON.stringify({ kind: 'proposal', summary: 'A draft', ...graph, ...changes })

describe('workflow assistant boundary', () => {
  it('accepts a complete graph using the existing validator', () => {
    expect(parseWorkflowProposal(proposal()).kind).toBe('proposal')
  })
  it('rejects invalid connections and unsupported node types', () => {
    expect(() => parseWorkflowProposal(proposal({ edges: [{ id: 'bad', source: 'start', target: 'missing' }] }))).toThrow()
    expect(() => parseWorkflowProposal(proposal({ nodes: [{ ...graph.nodes[0], type: 'action.execute_shell' }] }))).toThrow()
  })
  it('rejects provider overrides, hidden settings, and malformed output', () => {
    expect(() => parseWorkflowProposal(proposal({ nodes: [{ ...graph.nodes[0], config: { keywords: 'hi', apiKey: 'secret' } }, graph.nodes[1]] }))).toThrow()
    expect(() => parseWorkflowProposal(proposal({ nodes: [{ ...graph.nodes[0], config: { keywords: 'hi', agentProvider: 'claude_cli' } }, graph.nodes[1]] }))).toThrow()
    expect(() => parseWorkflowProposal('```json\n' + proposal() + '\n```')).toThrow()
    expect(() => parseWorkflowProposal(proposal({ publish: true }))).toThrow()
  })
  it('asks for clarification without inventing missing clinic details', () => {
    expect(parseWorkflowProposal(JSON.stringify({ kind: 'clarification', question: 'Which doctor?' }))).toEqual({ kind: 'clarification', question: 'Which doctor?' })
  })
  it('rejects condition operators and message values the engine would silently coerce', () => {
    const condition = { id: 'condition', kind: 'logic', type: 'logic.condition', config: { field: 'intent', op: 'equals', value: 'booking' }, x: 150, y: 0 }
    const edges = [{ id: 'a', source: 'start', target: 'condition' }, ...['true', 'false'].map((handle) => ({ id: handle, source: 'condition', target: 'end', sourceHandle: handle }))]
    expect(parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], condition, graph.nodes[1]], edges })).kind).toBe('proposal')
    expect(() => parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], { ...condition, config: { ...condition.config, op: 'greater_than' } }, graph.nodes[1]], edges }))).toThrow()
    const message = { id: 'message', kind: 'action', type: 'action.send_message', config: { text: {} }, x: 150, y: 0 }
    expect(() => parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], message, graph.nodes[1]], edges: [{ id: 'a', source: 'start', target: 'message' }, { id: 'b', source: 'message', target: 'end' }] }))).toThrow()
  })
  it.each([
    ['logic.delay', { amount: 'later', unit: 'minute' }],
    ['logic.delay', { amount: 2, unit: 'week' }],
    ['action.send_template', { category: 'invented' }],
    ['action.add_tag', { tag: {} }],
  ])('rejects malformed %s scalar configuration', (type: string, config: Record<string, unknown>) => {
    const step = { id: 'step', kind: type.startsWith('logic.') ? 'logic' : 'action', type, config, x: 150, y: 0 }
    expect(() => parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], step, graph.nodes[1]], edges: [{ id: 'a', source: 'start', target: 'step' }, { id: 'b', source: 'step', target: 'end' }] }))).toThrow()
  })
  it('allows AI token budgets without allowing credentials', () => {
    const ai = { id: 'ai', kind: 'action', type: 'action.ai_agent', config: { agentMaxTokens: 500, scenarios: [{ id: 'general', description: 'Answer a clinic inquiry', action: 'reply' }] }, x: 150, y: 0 }
    const edges = [{ id: 'a', source: 'start', target: 'ai' }, ...['replied', 'handoff', 'no_match', 'error'].map((handle) => ({ id: handle, source: 'ai', target: 'end', sourceHandle: handle }))]
    expect(parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], ai, graph.nodes[1]], edges })).kind).toBe('proposal')
    expect(() => parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], { ...ai, config: { ...ai.config, agentMaxTokens: 100000 } }, graph.nodes[1]], edges }))).toThrow()
  })
  it('accepts the engine-supported zero response buffer', () => {
    const step = { id: 'step', kind: 'action', type: 'action.ai_draft', config: { prompt: 'Draft a clinic response', queryLimit: 2, responseBuffer: 0 }, x: 150, y: 0 }
    expect(parseWorkflowProposal(proposal({ nodes: [graph.nodes[0], step, graph.nodes[1]], edges: [{ id: 'a', source: 'start', target: 'step' }, { id: 'b', source: 'step', target: 'end' }] })).kind).toBe('proposal')
  })
  it('projects only structural evidence, excluding free text, patient data and credentials', () => {
    const privateRuns = [{ status: 'failed', context: { phone: '123' }, trace: { body: 'patient content' } }]
    const context = workflowAssistantContext({ nodes: [{ ...graph.nodes[0], config: { keywords: 'private name', token: 'secret', email: 'patient@example.test' } }], edges: graph.edges }, privateRuns)
    expect(JSON.stringify(context)).not.toMatch(/private name|secret|patient|123/)
    expect(context.recentRuns).toEqual([{ status: 'failed' }])
    expect(context.graph.nodes[0]).toMatchObject({ id: 'start', type: 'trigger.message_keyword' })
  })
})
