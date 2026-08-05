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
    nameKey: 'wf.tpl.guidedWhatsappBookingName',
    descKey: 'wf.tpl.guidedWhatsappBookingDesc',
    nodes: [
      n('trigger_1', 'trigger', 'trigger.message_keyword', { keywords: 'book, cita, appointment, agendar, menu' }, 40, 400),
      n('main_menu', 'action', 'action.interactive_menu', {
        variant: 'list',
        header: 'Welcome',
        message: 'Welcome to Clínica Demo A, please choose from the following options',
        footer: "Press '0' to restart and '1' for live chat",
        options: JSON.stringify([
          { optionId: 'book_appt', title: 'Book an appointment' },
          { optionId: 'location_hours', title: 'Location & Hours' },
          { optionId: 'general_inquiry', title: 'General Inquiry' },
          { optionId: 'talk_secretary', title: 'Talk to Secretary' },
        ]),
      }, 280, 400),
      n('handoff_notify', 'action', 'action.notify_secretary', {}, 520, 80),
      n('handoff_tag', 'action', 'action.add_tag', { tag: 'needs_human' }, 760, 80),
      n('handoff_msg', 'action', 'action.send_message', { text: 'Connecting you with our secretary now. Someone will be with you shortly.' }, 1000, 80),
      n('end_handoff', 'action', 'action.end', {}, 1240, 80),
      n('inquiry_draft', 'action', 'action.ai_draft', {
        prompt: "Draft a reply about Clínica Demo A's services and doctor specializations. Only answer what you know from the clinic context. If the question is outside clinic services or you are unsure, flag it for human review.",
      }, 520, 240),
      n('inquiry_classify', 'logic', 'logic.ai_classify_intent', {
        confidenceField: 'inquiry_confidence', highThreshold: '0.8', lowThreshold: '0.5',
      }, 760, 240),
      n('end_inquiry', 'action', 'action.end', {}, 1000, 240),
      n('location_msg', 'action', 'action.send_message', { text: 'Our location is [Clinic address] and our hours of operation are [Mon–Fri 9am–5pm].' }, 520, 560),
      n('doctor_menu', 'action', 'action.interactive_menu', {
        variant: 'list',
        header: 'Choose a doctor',
        message: 'Please select your preferred doctor',
        footer: "Press '0' to restart and '1' for live chat",
        field: 'doctor_preference',
        options: JSON.stringify([
          { optionId: 'dr_garcia', title: 'Dr. García' },
          { optionId: 'dr_lopez', title: 'Dr. López' },
          { optionId: 'specialized', title: 'Specialized service' },
        ]),
      }, 520, 400),
      n('specialized_msg', 'action', 'action.send_message', { text: "For specialized bookings please contact Clínica Demo A's office at [phone number]." }, 760, 720),
      n('end_specialized', 'action', 'action.end', {}, 1000, 720),
      n('ask_date', 'action', 'action.ask_capture', {
        field: 'preferred_date', validation: 'date', maxAttempts: '3',
        question: 'What date would you prefer? Please use YYYY-MM-DD.',
        retryQuestion: 'Please send the appointment date as YYYY-MM-DD.',
      }, 760, 400),
      n('wait_date', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1000, 400),
      n('check_avail', 'action', 'action.check_availability', {
        doctorIdField: 'doctor_preference', dateField: 'preferred_date', days: '1', slotsField: 'available_slots',
      }, 1240, 400),
      n('offer_slots', 'action', 'action.offer_slots', {
        slotsField: 'available_slots', count: '3', message: 'Available appointment times:',
      }, 1480, 400),
      n('ask_time', 'action', 'action.ask_capture', {
        field: 'preferred_time', validation: 'time', maxAttempts: '3',
        question: 'What time would you prefer? Please use HH:MM.',
        retryQuestion: 'Please send a valid time as HH:MM.',
      }, 1720, 400),
      n('wait_time', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1960, 400),
      n('confirm_menu', 'action', 'action.interactive_menu', {
        variant: 'button',
        header: 'Confirm',
        message: 'Please confirm your appointment details',
        footer: "Press '0' to restart and '1' for live chat",
        options: JSON.stringify([
          { optionId: 'confirm', title: 'Confirm' },
          { optionId: 'cancel', title: 'Cancel' },
        ]),
      }, 2200, 400),
      n('create_booking', 'action', 'action.create_or_reschedule_booking', {
        mode: 'create', doctorIdField: 'doctor_preference', dateField: 'preferred_date', timeField: 'preferred_time',
      }, 2440, 400),
      n('success_msg', 'action', 'action.send_message', { text: 'Your appointment at Clínica Demo A has been confirmed. See you soon!' }, 2680, 400),
      n('end_success', 'action', 'action.end', {}, 2920, 400),
      n('end_cancel', 'action', 'action.end', {}, 2440, 560),
    ],
    edges: [
      e('trigger_1', 'main_menu'),
      e('main_menu', 'doctor_menu', 'book_appt'),
      e('main_menu', 'location_msg', 'location_hours'),
      e('main_menu', 'inquiry_draft', 'general_inquiry'),
      e('main_menu', 'handoff_notify', 'talk_secretary'),
      e('main_menu', 'main_menu', 'restart'),
      e('main_menu', 'handoff_notify', 'livechat'),
      e('main_menu', 'main_menu', 'default'),
      e('location_msg', 'main_menu'),
      e('handoff_notify', 'handoff_tag'),
      e('handoff_tag', 'handoff_msg'),
      e('handoff_msg', 'end_handoff'),
      e('inquiry_draft', 'inquiry_classify'),
      e('inquiry_classify', 'end_inquiry', 'high'),
      e('inquiry_classify', 'handoff_notify', 'low'),
      e('inquiry_classify', 'main_menu', 'error'),
      e('doctor_menu', 'ask_date', 'dr_garcia'),
      e('doctor_menu', 'ask_date', 'dr_lopez'),
      e('doctor_menu', 'specialized_msg', 'specialized'),
      e('doctor_menu', 'main_menu', 'restart'),
      e('doctor_menu', 'handoff_notify', 'livechat'),
      e('doctor_menu', 'doctor_menu', 'default'),
      e('specialized_msg', 'end_specialized'),
      e('ask_date', 'wait_date'),
      e('wait_date', 'check_avail'),
      e('check_avail', 'offer_slots'),
      e('offer_slots', 'ask_time'),
      e('ask_time', 'wait_time'),
      e('wait_time', 'confirm_menu'),
      e('confirm_menu', 'create_booking', 'confirm'),
      e('confirm_menu', 'end_cancel', 'cancel'),
      e('confirm_menu', 'main_menu', 'restart'),
      e('confirm_menu', 'handoff_notify', 'livechat'),
      e('confirm_menu', 'confirm_menu', 'default'),
      e('create_booking', 'success_msg'),
      e('success_msg', 'end_success'),
    ],
  },
]
