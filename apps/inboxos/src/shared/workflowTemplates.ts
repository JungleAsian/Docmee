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
  {
    key: 'guided_whatsapp_booking',
    nameKey: 'wf.tpl.guidedWhatsAppBookingName',
    descKey: 'wf.tpl.guidedWhatsAppBookingDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.message_keyword', { keywords: 'book,appointment,cita,reserva,agendar,human,agent,help,question' }, 40, 260),
      n('classify_route', 'logic', 'logic.condition', { field: 'message', op: 'contains', value: 'human' }, 280, 260),
      n('agent_route', 'logic', 'logic.condition', { field: 'message', op: 'contains', value: 'agent' }, 400, 260),
      n('inquiry_route', 'logic', 'logic.condition', { field: 'message', op: 'contains', value: 'question' }, 520, 260),
      n('help_route', 'logic', 'logic.condition', { field: 'message', op: 'contains', value: 'help' }, 640, 260),
      n('doctor_menu', 'action', 'action.interactive_menu', {
        menuType: 'doctor', title: 'Choose doctor', body: 'Please choose a doctor.', buttonLabel: 'Doctors',
        clinicIdField: 'clinic_id', selectionField: 'doctor_id', optionsField: 'doctor_options',
        emptyMessage: 'No doctors are available for online booking right now. I can connect you with the clinic team.',
      }, 760, 160),
      n('wait_doctor', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1000, 160),
      n('service_menu', 'action', 'action.interactive_menu', {
        menuType: 'service', title: 'Choose service', body: 'Please choose a service.', buttonLabel: 'Services',
        clinicIdField: 'clinic_id', doctorIdField: 'doctor_id', selectionField: 'service_id', optionsField: 'service_options',
        emptyMessage: 'No services are available for that doctor right now. I can connect you with the clinic team.',
      }, 1240, 160),
      n('wait_service', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1480, 160),
      n('slots_1', 'action', 'action.available_slots', {
        clinicIdField: 'clinic_id', doctorIdField: 'doctor_id', serviceIdField: 'service_id', timezoneField: 'clinic_timezone',
        days: '5', slotsField: 'available_slots', schedulingSourceField: 'scheduling_source',
      }, 1720, 160),
      n('date_menu', 'action', 'action.interactive_menu', {
        menuType: 'date', title: 'Choose day', body: 'Please choose an available day.', buttonLabel: 'Days',
        clinicIdField: 'clinic_id', slotsField: 'available_slots', selectionField: 'selected_date', optionsField: 'date_options',
        emptyMessage: 'No days are available in the next five clinic days. I can refresh the range or connect you with the clinic team.',
      }, 1960, 160),
      n('wait_date', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 2200, 160),
      n('time_menu', 'action', 'action.interactive_menu', {
        menuType: 'time_slot', title: 'Choose time', body: 'Please choose an available time.', buttonLabel: 'Times',
        clinicIdField: 'clinic_id', slotsField: 'available_slots', dateField: 'selected_date', selectionField: 'selected_booking_key', optionsField: 'time_slot_options',
        emptyMessage: 'No times are available for that day anymore. I can refresh the range or connect you with the clinic team.',
      }, 2440, 160),
      n('wait_time', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 2680, 160),
      n('revalidate_1', 'action', 'action.revalidate_slot', {
        clinicIdField: 'clinic_id', doctorIdField: 'doctor_id', serviceIdField: 'service_id', timezoneField: 'clinic_timezone',
        bookingKeyField: 'selected_booking_key', days: '5', slotsField: 'available_slots',
      }, 2920, 160),
      n('confirm_menu', 'action', 'action.interactive_menu', {
        menuType: 'confirm', title: 'Confirm booking', body: 'Please confirm this appointment.', buttonLabel: 'Confirm',
        clinicIdField: 'clinic_id', selectionField: 'booking_confirmation', optionsField: 'confirmation_options',
      }, 3160, 160),
      n('wait_confirm', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 3400, 160),
      n('confirmed', 'logic', 'logic.condition', { field: 'booking_confirmation', op: 'equals', value: 'yes' }, 3640, 160),
      n('book_1', 'action', 'action.create_or_reschedule_booking', {
        mode: 'create', doctorIdField: 'doctor_id', serviceIdField: 'service_id', dateField: 'preferred_date', timeField: 'preferred_time', startField: 'selected_slot_start', endField: 'selected_slot_end', bookingKeyField: 'selected_booking_key',
      }, 3880, 100),
      n('success_1', 'action', 'action.send_message', { text: 'Your appointment is confirmed.' }, 4120, 100),
      n('handoff_1', 'action', 'action.notify_secretary', {}, 760, 360),
      n('handoff_msg', 'action', 'action.send_message', { text: 'A clinic team member will continue this conversation.' }, 1000, 360),
      n('inquiry_1', 'action', 'action.ai_draft', { prompt: 'Draft a staff-reviewable answer grounded only in approved clinic data.' }, 760, 520),
      n('end_1', 'action', 'action.end', {}, 4360, 260),
    ],
    edges: [
      e('trigger_1', 'classify_route'),
      e('classify_route', 'handoff_1', 'true'), e('classify_route', 'agent_route', 'false'),
      e('agent_route', 'handoff_1', 'true'), e('agent_route', 'inquiry_route', 'false'),
      e('inquiry_route', 'inquiry_1', 'true'), e('inquiry_route', 'help_route', 'false'),
      e('help_route', 'inquiry_1', 'true'), e('help_route', 'doctor_menu', 'false'),
      e('doctor_menu', 'wait_doctor'), e('wait_doctor', 'service_menu'),
      e('service_menu', 'wait_service'), e('wait_service', 'slots_1'),
      e('slots_1', 'date_menu'), e('date_menu', 'wait_date'), e('wait_date', 'time_menu'),
      e('time_menu', 'wait_time'), e('wait_time', 'revalidate_1'), e('revalidate_1', 'confirm_menu'),
      e('confirm_menu', 'wait_confirm'), e('wait_confirm', 'confirmed'),
      e('confirmed', 'book_1', 'true'), e('confirmed', 'handoff_1', 'false'),
      e('book_1', 'success_1'), e('success_1', 'end_1'),
      e('handoff_1', 'handoff_msg'), e('handoff_msg', 'end_1'),
      e('inquiry_1', 'end_1'),
    ],
  },
]
