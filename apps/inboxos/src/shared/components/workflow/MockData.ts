import type { WorkflowEdge, WorkflowGroup, WorkflowNode } from '../../types'
import { layoutWorkflow } from '../../workflowLayout'

/** Synthetic clinic flow: no patient identifiers, provider calls, or bookings. */
export function createHugeWorkflow() {
  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []
  const groups: WorkflowGroup[] = []
  const titles = ['Intake & triage', 'Booking choices', 'Follow-up & handoff']
  for (let section = 0; section < 3; section++) {
    const id = (step: number) => `demo-${section}-${step}`
    const local: WorkflowNode[] = Array.from({ length: 12 }, (_, step) => {
      const trigger = section === 0 && step === 0
      const condition = [1, 3, 6].includes(step)
      const end = section === 2 && step === 11
      return {
        id: id(step), kind: trigger ? 'trigger' : condition ? 'logic' : 'action',
        type: trigger ? 'trigger.message_keyword' : condition ? 'logic.condition' : end ? 'action.end' : 'action.send_message',
        config: { customLabel: `${titles[section]} · ${step + 1}`, ...(trigger ? { keywords: ['demo'] } : condition
          ? { field: 'patient.name', op: 'exists', value: '' }
          : end ? {} : { text: 'Example step for canvas preview.' }) },
        x: 0, y: 0,
      }
    })
    const links: [number, number, string?][] = [
      [0, 1], [1, 2, 'true'], [1, 3, 'false'], [2, 4], [3, 4, 'true'], [3, 5, 'false'],
      [4, 6], [5, 6], [6, 7, 'true'], [6, 8, 'false'], [7, 9], [8, 9], [9, 10], [10, 11],
    ]
    const localEdges = links.map(([source, target, sourceHandle], index) => ({
      id: `demo-edge-${section}-${index}`, source: id(source), target: id(target), ...(sourceHandle ? { sourceHandle } : {}),
    }))
    // Compact saved origins let expansion demonstrate reversible collision reflow.
    nodes.push(...layoutWorkflow(local, localEdges).map((node) => ({ ...node, x: node.x + section * 384, y: node.y + 96 })))
    edges.push(...localEdges)
    if (section < 2) edges.push({ id: 'bridge-' + section, source: id(11), target: `demo-${section + 1}-0` })
    groups.push({ id: 'demo-group-' + section, label: titles[section]!, nodeIds: local.map((node) => node.id), collapsed: true })
  }
  return { nodes, edges, groups }
}
