import { describe, expect, it } from 'vitest'
import { isBranchingNode, resequenceLinearEdges } from './workflowLinearEdges'
import type { WorkflowEdge, WorkflowNode } from './types'

const node = (id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  kind: type.startsWith('trigger.') ? 'trigger' : type.startsWith('logic.') ? 'logic' : 'action',
  type,
  config,
  x: 0,
  y: 0,
})
const edge = (id: string, source: string, target: string, sourceHandle?: string | null): WorkflowEdge => ({
  id,
  source,
  target,
  ...(sourceHandle !== undefined ? { sourceHandle } : {}),
})

describe('isBranchingNode', () => {
  it('is false for the trigger', () => {
    expect(isBranchingNode(node('t', 'trigger.message_keyword'))).toBe(false)
  })

  it('is false for plain linear actions', () => {
    expect(isBranchingNode(node('a', 'action.send_message'))).toBe(false)
    expect(isBranchingNode(node('a', 'action.end'))).toBe(false)
  })

  it('is true for condition, ai_classify_intent, interactive_menu, and ai_agent', () => {
    expect(isBranchingNode(node('c', 'logic.condition'))).toBe(true)
    expect(isBranchingNode(node('c', 'logic.ai_classify_intent'))).toBe(true)
    expect(isBranchingNode(node('m', 'action.interactive_menu'))).toBe(true)
    expect(isBranchingNode(node('a', 'action.ai_agent'))).toBe(true)
  })
})

describe('resequenceLinearEdges', () => {
  it('chains a trigger + linear steps in array order, including the trigger', () => {
    const steps = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message'), node('b', 'action.send_message')]
    const edges = resequenceLinearEdges(steps, [])
    expect(edges).toEqual([
      { id: 'e_t_a_seq', source: 't', target: 'a', sourceHandle: null },
      { id: 'e_a_b_seq', source: 'a', target: 'b', sourceHandle: null },
    ])
  })

  it('the last step gets no outgoing edge (ends the workflow)', () => {
    const steps = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message')]
    const edges = resequenceLinearEdges(steps, [])
    expect(edges).toHaveLength(1)
    expect(edges[0]!.target).toBe('a')
  })

  it('re-derives the chain after inserting a step in the middle', () => {
    const before = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message'), node('b', 'action.send_message')]
    const afterInsert = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message'), node('new', 'action.add_tag'), node('b', 'action.send_message')]
    const initial = resequenceLinearEdges(before, [])
    const resequenced = resequenceLinearEdges(afterInsert, initial)
    expect(resequenced.map((e) => `${e.source}->${e.target}`)).toEqual(['t->a', 'a->new', 'new->b'])
  })

  it('re-links neighbors after removing a middle step', () => {
    const steps = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message'), node('b', 'action.send_message'), node('c', 'action.send_message')]
    const initial = resequenceLinearEdges(steps, [])
    const afterRemove = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message'), node('c', 'action.send_message')]
    const resequenced = resequenceLinearEdges(afterRemove, initial)
    expect(resequenced.map((e) => `${e.source}->${e.target}`)).toEqual(['t->a', 'a->c'])
  })

  it('leaves a branching node\'s hand-wired edges untouched across a reorder', () => {
    const steps = [
      node('t', 'trigger.message_keyword'),
      node('cond', 'logic.condition'),
      node('yes_step', 'action.send_message'),
      node('no_step', 'action.send_message'),
    ]
    const handWired = [
      edge('e1', 'cond', 'yes_step', 'true'),
      edge('e2', 'cond', 'no_step', 'false'),
    ]
    // Reorder the two linear tail steps -- the condition's own hand-wired
    // branch edges must survive completely unchanged.
    const reordered = [
      node('t', 'trigger.message_keyword'),
      node('cond', 'logic.condition'),
      node('no_step', 'action.send_message'),
      node('yes_step', 'action.send_message'),
    ]
    const resequenced = resequenceLinearEdges(reordered, handWired)
    expect(resequenced).toContainEqual(edge('e1', 'cond', 'yes_step', 'true'))
    expect(resequenced).toContainEqual(edge('e2', 'cond', 'no_step', 'false'))
  })

  it('preserves a branch target that points earlier in the list (loop-back menu)', () => {
    const steps = [
      node('t', 'trigger.message_keyword'),
      node('menu', 'action.interactive_menu', { options: [{ optionId: 'again', title: 'Again' }] }),
      node('done', 'action.end'),
    ]
    const loopBack = [edge('e1', 'menu', 't', 'again')]
    const resequenced = resequenceLinearEdges(steps, loopBack)
    expect(resequenced).toContainEqual(edge('e1', 'menu', 't', 'again'))
  })

  it("updates the trigger's auto-edge when the step after it changes", () => {
    const steps = [node('t', 'trigger.message_keyword'), node('a', 'action.send_message')]
    const initial = resequenceLinearEdges(steps, [])
    const swapped = [node('t', 'trigger.message_keyword'), node('z', 'action.send_message')]
    const resequenced = resequenceLinearEdges(swapped, initial)
    expect(resequenced).toEqual([{ id: 'e_t_z_seq', source: 't', target: 'z', sourceHandle: null }])
  })

  it('drops an unwired branch edge that points at a step no longer in the list', () => {
    // An edge sourced from a node NOT present in `steps` at all is left alone
    // (defensive) -- but here the branching source IS present, so its own
    // stale edge to a since-removed target is simply kept as-is (the caller/
    // UI is responsible for re-wiring a dangling branch target, same as the
    // canvas today).
    const steps = [node('t', 'trigger.message_keyword'), node('cond', 'logic.condition'), node('a', 'action.send_message')]
    const edges = [edge('e1', 'cond', 'removed_step', 'true')]
    const resequenced = resequenceLinearEdges(steps, edges)
    expect(resequenced).toContainEqual(edge('e1', 'cond', 'removed_step', 'true'))
  })
})
