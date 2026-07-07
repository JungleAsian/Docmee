// Rev 3 - the catalog of node types the workflow canvas + (later) the engine share.
// Each node has a kind (trigger/logic/action), an i18n label, and the config keys
// the side panel renders as editable fields.
import type { WorkflowNodeKind } from './types'

export interface NodeTypeDef {
  type: string
  kind: WorkflowNodeKind
  labelKey: string
  /** config keys the editor exposes (rendered as text inputs, key = label). */
  fields: string[]
}

export const WORKFLOW_NODE_TYPES: NodeTypeDef[] = [
  // Triggers - what starts the workflow (exactly one per workflow).
  { type: 'trigger.appointment_booked', kind: 'trigger', labelKey: 'wf.node.appointmentBooked', fields: [] },
  { type: 'trigger.reminder_due', kind: 'trigger', labelKey: 'wf.node.reminderDue', fields: ['hoursBefore'] },
  { type: 'trigger.no_show', kind: 'trigger', labelKey: 'wf.node.noShow', fields: [] },
  { type: 'trigger.message_keyword', kind: 'trigger', labelKey: 'wf.node.messageKeyword', fields: ['keywords'] },
  { type: 'trigger.patient_upset', kind: 'trigger', labelKey: 'wf.node.patientUpset', fields: [] },
  { type: 'trigger.voice_message', kind: 'trigger', labelKey: 'wf.node.voiceMessage', fields: ['channel'] },
  // Logic - routing + timing.
  { type: 'logic.condition', kind: 'logic', labelKey: 'wf.node.condition', fields: ['field', 'op', 'value'] },
  { type: 'logic.delay', kind: 'logic', labelKey: 'wf.node.delay', fields: ['amount', 'unit'] },
  // Actions - what the workflow does.
  { type: 'action.send_message', kind: 'action', labelKey: 'wf.node.sendMessage', fields: ['text'] },
  { type: 'action.send_template', kind: 'action', labelKey: 'wf.node.sendTemplate', fields: ['category'] },
  { type: 'action.notify_secretary', kind: 'action', labelKey: 'wf.node.notify', fields: [] },
  { type: 'action.add_tag', kind: 'action', labelKey: 'wf.node.addTag', fields: ['tag'] },
  { type: 'action.ai_draft', kind: 'action', labelKey: 'wf.node.aiDraft', fields: ['prompt'] },
  { type: 'action.approval', kind: 'action', labelKey: 'wf.node.approval', fields: [] },
  {
    type: 'action.transcribe_booking_voice',
    kind: 'action',
    labelKey: 'wf.node.transcribeBookingVoice',
    fields: ['provider', 'allowedFields', 'reviewTag'],
  },
  { type: 'action.end', kind: 'action', labelKey: 'wf.node.end', fields: [] },
]

export const nodeDef = (type: string): NodeTypeDef | undefined =>
  WORKFLOW_NODE_TYPES.find((n) => n.type === type)

/** Canvas tone per node kind. */
export const NODE_KIND_TONE: Record<WorkflowNodeKind, string> = {
  trigger: 'border-emerald-400 dark:border-emerald-600',
  logic: 'border-amber-400 dark:border-amber-600',
  action: 'border-teal-400 dark:border-teal-600',
}
