import { describe, expect, it } from 'vitest'
import { canApplyWorkflowProposal, pushWorkflowProposal, workflowGraphKey } from './workflowAssistant'
import { createHistory, undoHistory } from './workflowHistory'

const graph = { nodes: [], edges: [] }
const base = { role: 'ia_studio_admin', status: 'draft', clinicId: 'clinic-a', proposalClinicId: 'clinic-a', baseKey: workflowGraphKey(graph), currentGraph: graph }
describe('workflow assistant draft application', () => {
  it('replaces a draft in exactly one Undo step and restores its visual groups', () => {
    const previous = { ...graph, groups: [{ id: 'group', label: 'Original', nodeIds: [], collapsed: true }] }
    const history = createHistory(previous)
    const applied = pushWorkflowProposal(history, graph, workflowGraphKey(previous))
    expect(applied.past).toEqual([previous])
    expect(applied.present.groups).toEqual([])
    expect(undoHistory(applied).present).toEqual(previous)
    expect(pushWorkflowProposal(history, graph, 'stale')).toBe(history)
  })
  it('allows only reviewed proposals on the unchanged selected clinic draft', () => {
    expect(canApplyWorkflowProposal({ ...base, reviewed: true })).toBe(true)
    expect(canApplyWorkflowProposal({ ...base, reviewed: false })).toBe(false)
    expect(canApplyWorkflowProposal({ ...base, reviewed: true, role: 'clinic_admin' })).toBe(false)
    expect(canApplyWorkflowProposal({ ...base, reviewed: true, status: 'published' })).toBe(false)
    expect(canApplyWorkflowProposal({ ...base, reviewed: true, proposalClinicId: 'clinic-b' })).toBe(false)
    expect(canApplyWorkflowProposal({ ...base, reviewed: true, currentGraph: { ...graph, edges: [{ id: 'e', source: 'a', target: 'b' }] } })).toBe(false)
  })
})
