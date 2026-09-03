import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

/**
 * The workflow canvas is intentionally a control-flow graph today. Keeping the
 * port contract in one pure module makes that constraint explicit, while giving
 * future data ports a single extension point instead of scattering node-type
 * checks through the editor and worker.
 */
export interface WorkflowPort {
  id: string
  direction: 'input' | 'output'
  kind: 'control'
}

export function workflowPortsForNode(node: WorkflowNode): WorkflowPort[] {
  const ports: WorkflowPort[] = []
  if (node.kind !== 'trigger') ports.push({ id: 'in', direction: 'input', kind: 'control' })
  if (node.type !== 'action.end') ports.push({ id: 'out', direction: 'output', kind: 'control' })
  return ports
}

/** Returns a human-readable error when an edge violates the node port contract. */
export function validateWorkflowPortConnection(
  edge: WorkflowEdge,
  source: WorkflowNode | undefined,
  target: WorkflowNode | undefined,
): string | null {
  // Missing endpoints are reported by the structural validator, which can give
  // a clearer repair action than a port-level error can.
  if (!source || !target) return null
  if (!workflowPortsForNode(source).some((port) => port.direction === 'output')) {
    return `Edge ${edge.id} leaves end node ${source.id}, which has no output port. Delete this connection because an end node cannot continue to another step.`
  }
  if (!workflowPortsForNode(target).some((port) => port.direction === 'input')) {
    return `Edge ${edge.id} targets trigger node ${target.id}, which has no input port. Connect the edge to a workflow step after the trigger instead.`
  }
  return null
}
