import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
import type { WorkflowExportFile } from './workflowImport'
import type { WorkflowNode, WorkflowEdge } from './types'
import { repairDanielBookingWorkflow } from './workflowBookingRepair'
import { appointmentManagementTemplate } from './workflowTemplates'
import { simulateWorkflow } from '../../../../packages/agents/src/workflows/workflow-simulator'

// Synthetic graph matching the reviewed connections; contains no patient data.
function fixture(): WorkflowExportFile {
  const n = (id: string, type: string, config = {}): WorkflowNode => ({ id, type, kind: type.startsWith('trigger.') ? 'trigger' : 'action', config, x: 0, y: 0 })
  const e = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id: source + (sourceHandle ?? ''), source, target, sourceHandle })
  return {
    docmeeWorkflowExport: 1, name: 'Flujo_Daniel_Secretaria (TRASTEAR guiado con Chatgpt)',
    nodes: [
      n('start', 'trigger.message_keyword', { keywords: 'cita' }),
      n('interactive_menu_18', 'action.interactive_menu', { options: ['1', '2', '3', '4'].map((id) => ({ optionId: 'option_' + id, title: id })) }),
      n('ask_capture_29', 'action.ask_capture', { question: 'Nombre' }),
      n('ask_capture_27', 'action.ask_capture', { field: 'Patient phone', validation: 'phone' }),
      n('ask_capture_28', 'action.ask_capture', { field: 'Appointment reason', validation: 'text' }),
      n('create_or_reschedule_booking_22', 'action.create_or_reschedule_booking', { doctorId: 'existing-doctor', timeField: 'existing_time' }),
      n('send_message_10', 'action.send_message', { text: 'Secretaría' }),
      n('handoff', 'action.handoff_to_secretary'), n('done', 'action.end'),
    ],
    edges: [
      e('start', 'interactive_menu_18'), e('interactive_menu_18', 'ask_capture_29', 'option_1'),
      ...['2', '3', '4'].map((id) => e('interactive_menu_18', 'send_message_10', 'option_' + id)),
      e('ask_capture_29', 'ask_capture_27'), e('ask_capture_27', 'ask_capture_28'),
      e('ask_capture_28', 'create_or_reschedule_booking_22'), e('create_or_reschedule_booking_22', 'done'),
      e('send_message_10', 'handoff'), e('handoff', 'done'),
    ],
  }
}

describe('guarded Daniel booking repair', () => {
  it.each(['move', 'cancel', 'keep'])('simulates appointment selection and confirmed %s through the real engine', async (action) => {
    const workflow = appointmentManagementTemplate()
    let result = await simulateWorkflow(workflow, {})
    expect(result.waitingFor?.nodeId).toBe('manage_choose')
    result = await simulateWorkflow(workflow, { replay: result.replay, reply: { optionId: 'mock-appointment-1' } })
    expect(result.waitingFor?.nodeId).toBe('manage_action')
    result = await simulateWorkflow(workflow, { replay: result.replay, reply: { optionId: action === 'move' ? 'move' : 'cancel' } })
    if (action === 'move') {
      expect(result.waitingFor?.nodeId).toBe('manage_date')
      result = await simulateWorkflow(workflow, { replay: result.replay, reply: { optionId: '2030-01-01' } })
      expect(result.waitingFor?.nodeId).toBe('manage_time')
      result = await simulateWorkflow(workflow, { replay: result.replay, reply: { optionId: '10:00' } })
    }
    expect(result.waitingFor?.nodeId).toBe(action === 'move' ? 'manage_confirm_move' : 'manage_confirm_cancel')
    expect(result.effects.some((effect) => ['manage_move', 'manage_cancel'].includes(effect.nodeId))).toBe(false)
    result = await simulateWorkflow(workflow, { replay: result.replay, reply: { optionId: action === 'keep' ? 'keep' : 'confirm' } })
    expect(result.status).toBe('completed')
    expect(result.context.booking_status).toBe(action === 'keep' ? undefined : action === 'move' ? 'rescheduled' : 'cancelled')
    expect(result.safety).toMatchObject({ externalCalls: 0, persistentWrites: 0 })
  })

  it('repairs contact capture and lifecycle routing without changing the original or secretary branch', () => {
    const original = fixture()
    const snapshot = structuredClone(original)
    const repaired = repairDanielBookingWorkflow(original)
    expect(original).toEqual(snapshot)
    expect(validateWorkflowDefinition(repaired.nodes, repaired.edges, { requireTrigger: true })).toEqual([])
    expect(repaired.edges.find((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_2')).toEqual(original.edges.find((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_2'))
    expect(repaired.nodes.find((node) => node.id === 'create_or_reschedule_booking_22')).toMatchObject({ type: 'action.create_booking', config: { doctorId: 'existing-doctor', timeField: 'existing_time', reasonField: 'reason', resultRouting: 'branches' } })
    expect(repaired.nodes.find((node) => node.id === 'ask_capture_29')?.config).toMatchObject({ field: 'patient_name', validation: 'text' })
    expect(repaired.edges.find((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_3')?.target).toBe('manage_choose_move')
    expect(repaired.edges.find((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_4')?.target).toBe('manage_choose_cancel')
    expect(repaired.edges).toContainEqual(expect.objectContaining({ source: 'booking_repair_email_choice', sourceHandle: 'skip', target: 'ask_capture_28' }))
  })

  it('refuses an unrelated, changed, or already repaired workflow', () => {
    expect(() => repairDanielBookingWorkflow({ ...fixture(), name: 'Another clinic' })).toThrow(/only applies/)
    const changed = fixture()
    changed.edges = changed.edges.filter((edge) => edge.sourceHandle !== 'option_4')
    expect(() => repairDanielBookingWorkflow(changed)).toThrow(/graph has changed/)
    expect(() => repairDanielBookingWorkflow(repairDanielBookingWorkflow(fixture()))).toThrow(/changed or missing|already exist/)
  })
})
