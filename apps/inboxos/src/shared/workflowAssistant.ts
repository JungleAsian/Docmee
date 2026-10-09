import type { WorkflowNode, WorkflowEdge, WorkflowGroup } from './types'
import { pushHistory, type HistoryState } from './workflowHistory'

export type AssistantGraph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] }
export function workflowGraphKey(graph: AssistantGraph) {
  return JSON.stringify({ nodes: graph.nodes, edges: graph.edges })
}
export function pushWorkflowProposal(
  history: HistoryState<AssistantGraph & { groups: WorkflowGroup[] }>,
  proposal: AssistantGraph,
  baseKey: string,
) {
  return workflowGraphKey(history.present) === baseKey
    ? pushHistory(history, { ...proposal, groups: [] }) : history
}
export function canApplyWorkflowProposal(input: {
  role?: string; status: string; clinicId: string; proposalClinicId: string;
  baseKey: string; currentGraph: AssistantGraph; reviewed: boolean;
}) {
  return input.role === 'ia_studio_admin' && input.status === 'draft' && input.reviewed
    && input.clinicId === input.proposalClinicId && input.baseKey === workflowGraphKey(input.currentGraph)
}
