// Pure edge-sequencing logic for the Guided (linear/fill-in-the-blank) workflow
// editor. Mirrors workflowLayout.ts's convention of keeping graph-shape logic
// dependency-free of React so it stays directly unit-testable.
//
// The Guided editor renders `steps` (trigger, then the body nodes) as a plain
// ordered list. A non-branching node's "next step" is simply the next card in
// that list -- no edge-picker UI needed, it's implicit in the array order. A
// branching node (condition, interactive_menu, ai_classify_intent, ai_agent)
// instead gets one dropdown per branchRows() handle, and those edges are
// hand-wired by the admin -- they can point at ANY step (including one earlier
// in the list, for a loop-back menu) since the data model has no positional
// constraint.
import type { WorkflowEdge, WorkflowNode } from './types'
import { branchRows } from './workflowNodes'

/** True when a node type has any branch handles per branchRows() -- i.e. its
 *  "next step" cannot be inferred from array order and needs an explicit
 *  per-handle target picker instead of the plain sequential chain. */
export function isBranchingNode(node: WorkflowNode): boolean {
  return branchRows(node).length > 0
}

/**
 * Recomputes the single auto-chained edge for every non-branching node in
 * `steps`, given the current step order. Edges sourced from a branching node
 * still present in `steps` are left completely untouched (kept as-is,
 * wherever their target is -- including a target that was since removed; the
 * caller/UI is responsible for prompting a re-wire, same as the canvas
 * today). Every other edge -- sourced from a linear step, OR from a step no
 * longer present in `steps` at all (removed) -- is dropped; linear edges are
 * then rebuilt fresh from the current array order, so reordering, inserting,
 * or removing a step always produces a correct, minimal chain with no stale
 * leftovers.
 */
export function resequenceLinearEdges(steps: WorkflowNode[], edges: WorkflowEdge[]): WorkflowEdge[] {
  const stepById = new Map(steps.map((s) => [s.id, s]))

  const kept = edges.filter((e) => {
    const source = stepById.get(e.source)
    return source ? isBranchingNode(source) : false
  })

  const rebuilt: WorkflowEdge[] = []
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]!
    if (isBranchingNode(step)) continue
    const next = steps[i + 1]!
    rebuilt.push({ id: `e_${step.id}_${next.id}_seq`, source: step.id, target: next.id, sourceHandle: null })
  }

  return [...kept, ...rebuilt]
}
