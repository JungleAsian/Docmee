import type { WorkflowNode, WorkflowEdge } from './types'
import { branchRows } from './workflowNodes'

/** Prevent ambiguous wiring while drawing, before users reach Publish. */
export function canConnectWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], connection: { source: string; target: string; sourceHandle?: string | null }): boolean {
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target || source.type === 'action.end' || target.kind === 'trigger') return false
  if (source.id === target.id && !['action.interactive_menu', 'action.offer_slot_menu', 'logic.wait_for_reply', 'logic.delay', 'action.approval'].includes(source.type)) return false
  const branches = branchRows(source)
  const handle = connection.sourceHandle || ''
  if (branches.length && !branches.some((branch) => branch.key === handle)) return false
  return !edges.some((edge) => edge.source === source.id && (!branches.length || (edge.sourceHandle || '') === handle))
}
