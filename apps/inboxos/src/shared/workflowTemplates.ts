// Rev 3 (phase 3) - prebuilt automation workflows a clinic can start from. Each is a
// ready-made node graph (positioned for the canvas); instantiating one POSTs a draft
// copy the clinic then tweaks + activates. Frontend-static (no API needed) - the same
// node types the canvas + engine use.
import type { WorkflowNode, WorkflowEdge } from './types'

export interface WorkflowTemplate {
  key: string
  nameKey: string
  descKey: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

const n = (
  id: string,
  kind: WorkflowNode['kind'],
  type: string,
  config: Record<string, unknown>,
  x: number,
  y: number,
): WorkflowNode => ({ id, kind, type, config, x, y })

const e = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({
  id: `${source}_${target}${sourceHandle ? `_${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    key: 'urgent_keyword',
    nameKey: 'wf.tpl.urgentName',
    descKey: 'wf.tpl.urgentDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.message_keyword', { keywords: 'urgent, emergency, pain, dolor, urgente' }, 40, 80),
      n('tag_1', 'action', 'action.add_tag', { tag: 'urgent' }, 280, 80),
      n('notify_1', 'action', 'action.notify_secretary', {}, 520, 80),
      n('end_1', 'action', 'action.end', {}, 760, 80),
    ],
    edges: [e('trigger_1', 'tag_1'), e('tag_1', 'notify_1'), e('notify_1', 'end_1')],
  },
  {
    key: 'no_show_followup',
    nameKey: 'wf.tpl.noShowName',
    descKey: 'wf.tpl.noShowDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.no_show', {}, 40, 80),
      n('template_1', 'action', 'action.send_template', { category: 'appointment_reminder' }, 280, 80),
      n('end_1', 'action', 'action.end', {}, 520, 80),
    ],
    edges: [e('trigger_1', 'template_1'), e('template_1', 'end_1')],
  },
  {
    key: 'booking_confirmation',
    nameKey: 'wf.tpl.bookedName',
    descKey: 'wf.tpl.bookedDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.appointment_booked', {}, 40, 80),
      n('send_1', 'action', 'action.send_message', { text: 'Su cita esta confirmada. Le esperamos.' }, 280, 80),
      n('end_1', 'action', 'action.end', {}, 520, 80),
    ],
    edges: [e('trigger_1', 'send_1'), e('send_1', 'end_1')],
  },
  {
    key: 'voice_booking_intake',
    nameKey: 'wf.tpl.voiceBookingName',
    descKey: 'wf.tpl.voiceBookingDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.voice_message', { channel: 'whatsapp' }, 40, 80),
      n(
        'extract_1',
        'action',
        'action.transcribe_booking_voice',
        {
          provider: 'claude',
          allowedFields:
            'patient_name,phone_number,preferred_date,preferred_time,clinic_location,doctor_preference',
          reviewTag: 'voice_booking_review',
        },
        280,
        80,
      ),
      n('condition_1', 'logic', 'logic.condition', { field: 'needs_review', op: 'equals', value: 'true' }, 560, 80),
      n('notify_1', 'action', 'action.notify_secretary', {}, 820, 40),
      n('tag_1', 'action', 'action.add_tag', { tag: 'voice_booking_review' }, 820, 140),
      n('end_1', 'action', 'action.end', {}, 1080, 80),
    ],
    edges: [
      e('trigger_1', 'extract_1'),
      e('extract_1', 'condition_1'),
      { id: 'condition_1_notify_1_true', source: 'condition_1', target: 'notify_1', sourceHandle: 'true' },
      { id: 'condition_1_end_1_false', source: 'condition_1', target: 'end_1', sourceHandle: 'false' },
      e('notify_1', 'tag_1'),
      e('tag_1', 'end_1'),
    ],
  },
  {
    key: 'single_turn_booking',
    nameKey: 'wf.tpl.singleTurnBookingName',
    descKey: 'wf.tpl.singleTurnBookingDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.message_keyword', { keywords: 'book,appointment,cita,reserva,agendar' }, 40, 240),
      n('extract_1', 'action', 'action.extract_booking_details', {
        provider: 'claude',
        allowedFields: 'patient_name,phone_number,preferred_date,preferred_time,doctor_preference',
        reviewTag: 'booking_clarification',
      }, 280, 240),
      n('confidence_1', 'logic', 'logic.ai_classify_intent', {
        confidenceField: 'booking_confidence', highThreshold: '0.8', lowThreshold: '0.5',
      }, 540, 240),
      n('ask_date', 'action', 'action.ask_capture', {
        field: 'preferred_date', validation: 'date', maxAttempts: '3',
        question: 'What date would you prefer? Please use YYYY-MM-DD.',
        retryQuestion: 'Please send the appointment date as YYYY-MM-DD.',
      }, 780, 360),
      n('wait_date', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1020, 360),
      n('ask_time', 'action', 'action.ask_capture', {
        field: 'preferred_time', validation: 'time', maxAttempts: '3',
        question: 'What time would you prefer? Please use HH:MM.',
        retryQuestion: 'Please send a valid time as HH:MM.',
      }, 1260, 360),
      n('wait_time', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1500, 360),
      n('ask_doctor', 'action', 'action.ask_capture', {
        field: 'doctor_preference', validation: 'required', maxAttempts: '3',
        question: 'Which doctor would you like to see?',
        retryQuestion: 'Please send the doctor name so I can check the schedule.',
      }, 1740, 360),
      n('wait_doctor', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1980, 360),
      n('ask_confirm', 'action', 'action.ask_capture', {
        field: 'booking_confirmation', validation: 'yes_no', maxAttempts: '3',
        question: 'Please confirm these booking details by replying yes or no.',
        retryQuestion: 'Please reply yes to book or no to stop.',
      }, 2220, 240),
      n('wait_confirm', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 2460, 240),
      n('confirmed', 'logic', 'logic.condition', { field: 'booking_confirmation', op: 'contains', value: 'yes' }, 2700, 240),
      n('check_1', 'action', 'action.check_availability', {
        doctorIdField: 'doctor_preference', dateField: 'preferred_date', days: '1', slotsField: 'available_slots',
      }, 2940, 160),
      n('book_1', 'action', 'action.create_or_reschedule_booking', {
        mode: 'create', doctorIdField: 'doctor_preference', dateField: 'preferred_date', timeField: 'preferred_time',
      }, 3180, 160),
      n('success_1', 'action', 'action.send_message', { text: 'Your appointment is confirmed.' }, 3420, 160),
      n('handoff_1', 'action', 'action.notify_secretary', {}, 1020, 80),
      n('end_1', 'action', 'action.end', {}, 3660, 240),
    ],
    edges: [
      e('trigger_1', 'extract_1'), e('extract_1', 'confidence_1'),
      e('confidence_1', 'ask_date', 'high'), e('confidence_1', 'ask_date', 'low'), e('confidence_1', 'handoff_1', 'error'),
      e('ask_date', 'wait_date'), e('wait_date', 'ask_time'), e('ask_time', 'wait_time'),
      e('wait_time', 'ask_doctor'), e('ask_doctor', 'wait_doctor'), e('wait_doctor', 'ask_confirm'),
      e('ask_confirm', 'wait_confirm'), e('wait_confirm', 'confirmed'),
      e('confirmed', 'check_1', 'true'), e('confirmed', 'end_1', 'false'),
      e('check_1', 'book_1'), e('book_1', 'success_1'), e('success_1', 'end_1'),
      e('handoff_1', 'end_1'),
    ],
  },
]
