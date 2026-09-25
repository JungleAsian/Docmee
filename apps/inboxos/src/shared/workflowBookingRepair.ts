import type { WorkflowExportFile } from './workflowImport'
import type { WorkflowEdge, WorkflowNode } from './types'
import { appointmentManagementTemplate } from './workflowTemplates'

const TARGET_NAME = 'Flujo_Daniel_Secretaria (TRASTEAR guiado con Chatgpt)'

/** Offline, guarded repair of the reviewed graph. Never publishes or calls an API. */
export function repairDanielBookingWorkflow(input: WorkflowExportFile): WorkflowExportFile {
  if (input.name !== TARGET_NAME) throw new Error('This repair only applies to the reviewed Daniel workflow')
  const result = structuredClone(input)
  const byId = new Map(result.nodes.map((node) => [node.id, node]))
  for (const [id, type] of [
    ['ask_capture_29', 'action.ask_capture'], ['ask_capture_27', 'action.ask_capture'],
    ['ask_capture_28', 'action.ask_capture'], ['interactive_menu_18', 'action.interactive_menu'],
    ['create_or_reschedule_booking_22', 'action.create_or_reschedule_booking'],
  ]) {
    if (byId.get(id!)?.type !== type) throw new Error(`Reviewed node changed or missing: ${id}. Review the latest export before repairing.`)
  }
  if (result.nodes.some((node) => node.id.startsWith('manage_') || node.id.startsWith('booking_repair_'))) {
    throw new Error('Repair nodes already exist; refusing to duplicate or overwrite them')
  }
  const bookingId = 'create_or_reschedule_booking_22'
  const exactlyOne = (edges: WorkflowEdge[], description: string) => {
    if (edges.length !== 1) throw new Error(`Expected the reviewed ${description}; the graph has changed`)
    return edges[0]!
  }
  const success = exactlyOne(result.edges.filter((edge) => edge.source === bookingId), 'booking successor')
  const intake = exactlyOne(result.edges.filter((edge) => edge.source === 'ask_capture_27' && edge.target === 'ask_capture_28'), 'phone-to-reason connection')
  const move = exactlyOne(result.edges.filter((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_3'), 'change-appointment branch')
  const cancel = exactlyOne(result.edges.filter((edge) => edge.source === 'interactive_menu_18' && edge.sourceHandle === 'option_4'), 'cancel-appointment branch')

  Object.assign(byId.get('ask_capture_29')!.config, { field: 'patient_name', validation: 'text' })
  Object.assign(byId.get('ask_capture_27')!.config, { field: 'patient_phone', validation: 'phone' })
  Object.assign(byId.get('ask_capture_28')!.config, { field: 'reason', validation: 'text' })
  const booking = byId.get(bookingId)!
  booking.type = 'action.create_booking'
  booking.config = { ...booking.config, reasonField: 'reason', resultRouting: 'branches' }
  delete booking.config.mode
  delete booking.config.appointmentIdField
  success.sourceHandle = 'success'

  const lifecycle = appointmentManagementTemplate()
  const excluded = new Set(['manage_trigger', 'manage_choose', 'manage_action'])
  const choose = lifecycle.nodes.find((node) => node.id === 'manage_choose')!
  const added: WorkflowNode[] = lifecycle.nodes.filter((node) => !excluded.has(node.id))
  for (const action of ['move', 'cancel']) {
    added.push({ ...structuredClone(choose), id: `manage_choose_${action}`, y: action === 'move' ? 1200 : 1500 })
  }
  const newEdge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({
    id: `booking_repair_${source}_${sourceHandle ?? 'next'}`, source, target, ...(sourceHandle ? { sourceHandle } : {}),
  })
  const addedEdges = lifecycle.edges.filter((edge) => !excluded.has(edge.source)).map((edge) => ({
    ...edge, target: edge.target === 'manage_choose' ? 'interactive_menu_18' : edge.target,
  }))
  for (const action of ['move', 'cancel']) {
    const id = `manage_choose_${action}`
    addedEdges.push(newEdge(id, action === 'move' ? 'manage_availability' : 'manage_confirm_cancel', 'selected'),
      newEdge(id, 'manage_empty', 'empty'), newEdge(id, 'interactive_menu_18', 'restart'), newEdge(id, 'manage_help_message', 'livechat'))
  }
  move.target = 'manage_choose_move'
  cancel.target = 'manage_choose_cancel'
  added.push(
    { id: 'booking_repair_email_choice', kind: 'action', type: 'action.interactive_menu', x: booking.x - 600, y: booking.y + 300,
      config: { field: 'booking_email_choice', variant: 'button', message: '¿Deseas añadir un correo electrónico a tu cita?', options: [{ optionId: 'email', title: 'Añadir correo' }, { optionId: 'skip', title: 'Continuar sin correo' }] } },
    { id: 'booking_repair_email', kind: 'action', type: 'action.ask_capture', x: booking.x - 300, y: booking.y + 300,
      config: { field: 'patient_email', validation: 'email', question: 'Indica tu correo electrónico.', retryQuestion: 'Indica un correo válido, por ejemplo nombre@ejemplo.com.', maxAttempts: 3 } },
  )
  intake.target = 'booking_repair_email_choice'
  addedEdges.push(
    newEdge('booking_repair_email_choice', 'booking_repair_email', 'email'),
    newEdge('booking_repair_email_choice', 'ask_capture_28', 'skip'),
    newEdge('booking_repair_email_choice', 'booking_repair_email_choice', 'default'),
    newEdge('booking_repair_email_choice', 'interactive_menu_18', 'restart'),
    newEdge('booking_repair_email_choice', 'manage_help_message', 'livechat'),
    newEdge('booking_repair_email', 'ask_capture_28'),
    newEdge(bookingId, 'manage_pending', 'pending'), newEdge(bookingId, 'manage_help_message', 'error'),
  )
  result.nodes.push(...added)
  result.edges.push(...addedEdges)
  return result
}
