// Rev 3 - the catalog of node types the workflow canvas + (later) the engine share.
// Each node has a kind (trigger/logic/action), an i18n label, a short i18n
// description for the palette, and the config keys the side panel renders as
// editable fields.
import type { WorkflowNodeKind } from './types'

export interface NodeTypeDef {
  type: string
  kind: WorkflowNodeKind
  labelKey: string
  /** one-line "what it does" shown under the label in the palette. */
  descKey: string
  /** config keys the editor exposes (rendered as text inputs, key = label). */
  fields: string[]
}

export const WORKFLOW_NODE_TYPES: NodeTypeDef[] = [
  // Triggers - what starts the workflow (exactly one per workflow).
  // Only list events which the worker currently produces. Do not let a clinic
  // activate a workflow that would remain inert.
  { type: 'trigger.message_keyword', kind: 'trigger', labelKey: 'wf.node.messageKeyword', descKey: 'wf.desc.messageKeyword', fields: ['keywords'] },
  { type: 'trigger.patient_upset', kind: 'trigger', labelKey: 'wf.node.patientUpset', descKey: 'wf.desc.patientUpset', fields: [] },
  // Logic - routing + timing.
  { type: 'logic.condition', kind: 'logic', labelKey: 'wf.node.condition', descKey: 'wf.desc.condition', fields: ['field', 'op', 'value'] },
  { type: 'logic.delay', kind: 'logic', labelKey: 'wf.node.delay', descKey: 'wf.desc.delay', fields: ['amount', 'unit'] },
  { type: 'logic.wait_for_reply', kind: 'logic', labelKey: 'wf.node.waitForReply', descKey: 'wf.desc.waitForReply', fields: ['timeoutMinutes'] },
  {
    type: 'logic.ai_classify_intent',
    kind: 'logic',
    labelKey: 'wf.node.aiClassifyIntent',
    descKey: 'wf.desc.aiClassifyIntent',
    fields: ['confidenceField', 'highThreshold', 'lowThreshold', 'prompt'],
  },
  // Actions - what the workflow does.
  { type: 'action.send_message', kind: 'action', labelKey: 'wf.node.sendMessage', descKey: 'wf.desc.sendMessage', fields: ['text'] },
  { type: 'action.send_template', kind: 'action', labelKey: 'wf.node.sendTemplate', descKey: 'wf.desc.sendTemplate', fields: ['category'] },
  { type: 'action.notify_secretary', kind: 'action', labelKey: 'wf.node.notify', descKey: 'wf.desc.notify', fields: [] },
  { type: 'action.add_tag', kind: 'action', labelKey: 'wf.node.addTag', descKey: 'wf.desc.addTag', fields: ['tag'] },
  { type: 'action.ai_draft', kind: 'action', labelKey: 'wf.node.aiDraft', descKey: 'wf.desc.aiDraft', fields: ['prompt', 'queryLimit', 'responseBuffer'] },
  {
    type: 'action.interactive_menu',
    kind: 'action',
    labelKey: 'wf.node.interactiveMenu',
    descKey: 'wf.desc.interactiveMenu',
    fields: ['variant', 'header', 'message', 'footer', 'options', 'field'],
  },
  { type: 'action.approval', kind: 'action', labelKey: 'wf.node.approval', descKey: 'wf.desc.approval', fields: [] },
  {
    type: 'action.ask_capture',
    kind: 'action',
    labelKey: 'wf.node.askCapture',
    descKey: 'wf.desc.askCapture',
    fields: ['field', 'question', 'validation', 'retryQuestion', 'maxAttempts'],
  },
  {
    type: 'action.extract_booking_details',
    kind: 'action',
    labelKey: 'wf.node.extractBookingDetails',
    descKey: 'wf.desc.extractBookingDetails',
    fields: ['provider', 'allowedFields', 'reviewTag'],
  },
  {
    type: 'action.check_availability',
    kind: 'action',
    labelKey: 'wf.node.checkAvailability',
    descKey: 'wf.desc.checkAvailability',
    fields: ['doctorIdField', 'dateField', 'days', 'slotsField'],
  },
  {
    type: 'action.offer_slots',
    kind: 'action',
    labelKey: 'wf.node.offerSlots',
    descKey: 'wf.desc.offerSlots',
    fields: ['slotsField', 'count', 'message'],
  },
  {
    type: 'action.create_or_reschedule_booking',
    kind: 'action',
    labelKey: 'wf.node.createOrRescheduleBooking',
    descKey: 'wf.desc.createOrRescheduleBooking',
    fields: [
      'mode',
      'appointmentIdField',
      'doctorIdField',
      'serviceIdField',
      'dateField',
      'timeField',
      'durationMinutes',
      'title',
    ],
  },
  {
    type: 'action.transcribe_booking_voice',
    kind: 'action',
    labelKey: 'wf.node.transcribeBookingVoice',
    descKey: 'wf.desc.transcribeBookingVoice',
    fields: ['provider', 'allowedFields', 'reviewTag'],
  },
  { type: 'action.end', kind: 'action', labelKey: 'wf.node.end', descKey: 'wf.desc.end', fields: [] },
]

export const nodeDef = (type: string): NodeTypeDef | undefined =>
  WORKFLOW_NODE_TYPES.find((n) => n.type === type)

/** Canvas tone per node kind. */
export const NODE_KIND_TONE: Record<WorkflowNodeKind, string> = {
  trigger: 'border-emerald-400 dark:border-emerald-600',
  logic: 'border-amber-400 dark:border-amber-600',
  action: 'border-teal-400 dark:border-teal-600',
}

/** Badge (icon chip) colors per node kind — used by the canvas node header. */
export const NODE_KIND_BADGE: Record<WorkflowNodeKind, string> = {
  trigger: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  logic: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  action: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200',
}
