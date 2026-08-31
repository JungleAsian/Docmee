// Rev 3 (phase 3) - prebuilt automation workflows a clinic can start from. Each is a
// ready-made node graph (positioned for the canvas); instantiating one POSTs a draft
// copy the clinic then tweaks + activates. Frontend-static (no API needed) - the same
// node types the canvas + engine use.
import type { Clinic, WorkflowNode, WorkflowEdge } from './types'

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

const bookingAiScenarios = JSON.stringify([
  { id: 'clinic_question', description: 'The patient asks a question about the clinic, doctors, services, location, hours, policies, or booking process.', action: 'reply' },
  { id: 'human_request', description: 'The patient asks for a person, secretary, agent, or human help, or the answer is uncertain or safety-sensitive.', action: 'handoff' },
])

type ClinicTemplateContext = Pick<Clinic, 'name' | 'address' | 'phone' | 'settings'>

const weekdayLabels: Array<[string, string]> = [
  ['monday', 'Monday'],
  ['tuesday', 'Tuesday'],
  ['wednesday', 'Wednesday'],
  ['thursday', 'Thursday'],
  ['friday', 'Friday'],
  ['saturday', 'Saturday'],
  ['sunday', 'Sunday'],
]

function formatTime12h(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return value
  const hour24 = Number(match[1])
  const minutes = match[2]
  if (!Number.isFinite(hour24)) return value
  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 || 12
  return `${hour12}:${minutes} ${suffix}`
}

function businessHoursText(settings: Record<string, unknown>): string {
  const raw = settings['businessHours']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '{{clinic_hours}}'
  const hours = raw as Record<string, unknown>
  const lines = weekdayLabels.flatMap(([key, label]) => {
    const day = hours[key]
    if (!day || typeof day !== 'object' || Array.isArray(day)) return []
    const rec = day as Record<string, unknown>
    if (rec['closed'] === true) return [`${label}: Closed`]
    const open = typeof rec['open'] === 'string' ? rec['open'] : ''
    const close = typeof rec['close'] === 'string' ? rec['close'] : ''
    if (!open || !close) return []
    return [`${label}: ${formatTime12h(open)}–${formatTime12h(close)}`]
  })
  return lines.length > 0 ? lines.join('\n') : '{{clinic_hours}}'
}

function clinicHoursMessage(clinic?: ClinicTemplateContext): string {
  const name = clinic?.name?.trim() || '{{clinic_name}}'
  const address = clinic?.address?.trim() || '{{clinic_address}}'
  const phone = clinic?.phone?.trim() || '{{clinic_phone}}'
  const hours = businessHoursText(clinic?.settings ?? {})
  return `${name} is located at ${address}.\n\nBusiness hours:\n${hours}\n\nPhone: ${phone}.`
}

function safeAppointmentAssistantTemplate(): WorkflowTemplate {
  const nodes: WorkflowNode[] = [
    n('trigger', 'trigger', 'trigger.message_keyword', { keywords: 'appointment,book,cita,agendar,menu,consulta' }, 40, 360),
    n('main_menu', 'action', 'action.interactive_menu', {
      variant: 'list', optionSource: 'static', header: 'Clinic assistant',
      message: 'How can we help you today?', footer: 'Choose one option.',
      options: JSON.stringify([
        { optionId: 'clinic_hours', title: 'Clinic Hours' },
        { optionId: 'book_appointment', title: 'Book Appointment' },
        { optionId: 'secretary', title: 'Secretary' },
        { optionId: 'ai', title: 'AI' },
        { optionId: 'end_chat', title: 'End chat' },
      ]),
    }, 280, 360),
    n('clinic_hours_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'Clinic Hours',
      message: clinicHoursMessage(), footer: 'Choose what to do next.',
      options: JSON.stringify([
        { optionId: 'previous_menu', title: 'Previous menu' },
        { optionId: 'end_conversation', title: 'End chat' },
      ]),
    }, 520, 120),
    n('service_menu', 'action', 'action.interactive_menu', {
      variant: 'list', optionSource: 'doctor_services', sourceField: '',
      pageSize: '8', field: 'service_id', header: 'Choose service',
      message: 'Select the service you want to book.',
      footer: "Press '0' to restart and '1' for a secretary.",
    }, 520, 360),
    n('check_dates', 'action', 'action.check_availability', {
      doctorIdField: 'doctor_id', days: '7', slotsField: 'available_slots',
    }, 760, 360),
    n('date_menu', 'action', 'action.offer_slot_menu', {
      pickerMode: 'date', slotsField: 'available_slots', selectField: 'preferred_date', pageSize: '8',
      header: 'Available dates', message: 'Choose an available date.',
      footer: "Press '0' to restart and '1' for a secretary.",
    }, 1000, 360),
    n('check_times', 'action', 'action.check_availability', {
      doctorIdField: 'doctor_id', dateField: 'preferred_date', days: '1', slotsField: 'available_slots',
    }, 1240, 360),
    n('time_menu', 'action', 'action.offer_slot_menu', {
      pickerMode: 'time', slotsField: 'available_slots', dateField: 'preferred_date',
      selectField: 'preferred_time', pageSize: '8', header: 'Available times',
      message: 'Choose an available time.',
      footer: "Press '0' to restart and '1' for a secretary.",
    }, 1480, 360),
    n('revalidate_slot', 'action', 'action.check_availability', {
      doctorIdField: 'doctor_id', dateField: 'preferred_date', days: '1', slotsField: 'available_slots',
    }, 1720, 360),
    n('confirm_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'Confirm booking',
      message: 'Please confirm this appointment date and time.',
      options: JSON.stringify([
        { optionId: 'confirm', title: 'Confirm' },
        { optionId: 'change', title: 'Change' },
        { optionId: 'secretary', title: 'Secretary' },
      ]),
    }, 1960, 360),
    n('create_booking', 'action', 'action.create_or_reschedule_booking', {
      mode: 'create', doctorIdField: 'doctor_id', serviceIdField: 'service_id',
      dateField: 'preferred_date', timeField: 'preferred_time',
    }, 2200, 360),
    n('booking_success', 'action', 'action.send_message', {
      text: '✅ Appointment booked successfully. Your appointment has been saved in the clinic calendar and is confirmed on our side. If you need help or changes, please contact the clinic.',
    }, 2440, 360),
    n('no_slots_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'No slots',
      message: 'No available appointment times were found for that choice.',
      options: JSON.stringify([
        { optionId: 'try_again', title: 'Try again' },
        { optionId: 'secretary', title: 'Secretary' },
        { optionId: 'end_chat', title: 'End chat' },
      ]),
    }, 1240, 620),
    n('notify_secretary', 'action', 'action.notify_secretary', {}, 760, 80),
    n('secretary_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'Secretary notified',
      message: 'A clinic secretary has been notified and will continue this conversation. You can also call the clinic.',
      footer: 'Choose what to do next.',
      options: JSON.stringify([
        { optionId: 'previous_menu', title: 'Previous menu' },
        { optionId: 'end_conversation', title: 'End chat' },
      ]),
    }, 1000, 80),
    n('handoff_secretary', 'action', 'action.handoff_to_secretary', {}, 1240, 80),
    n('language_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'AI assistant',
      message: 'Would you like to communicate via English or Spanish?',
      options: JSON.stringify([
        { optionId: 'english', title: 'English' },
        { optionId: 'spanish', title: 'Spanish' },
      ]),
    }, 520, -160),
    n('ask_ai_question', 'action', 'action.ask_capture', {
      field: 'ai_question', validation: 'required', maxAttempts: '3',
      question: 'Please send your question and I will help.',
      retryQuestion: 'Please send your question so I can help.',
    }, 760, -160),
    n('wait_ai_reply', 'logic', 'logic.wait_for_reply', { timeoutMinutes: '1440' }, 1000, -160),
    n('ai_agent', 'action', 'action.ai_agent', {
      personality: 'Helpful clinic assistant', communicationStyle: 'friendly',
      customInstructions: 'Respond kindly to the patient with precise clinic information. Do not diagnose or provide medical advice. If unsure, route to the secretary.',
      scenarios: bookingAiScenarios,
    }, 1240, -160),
    n('end_message', 'action', 'action.send_message', { text: 'Thank you for contacting us. Have a great day.' }, 520, 640),
    n('end', 'action', 'action.end', {}, 760, 640),
  ]
  const edges: WorkflowEdge[] = [
    e('trigger', 'main_menu'),
    e('main_menu', 'clinic_hours_menu', 'clinic_hours'),
    e('main_menu', 'service_menu', 'book_appointment'),
    e('main_menu', 'notify_secretary', 'secretary'),
    e('main_menu', 'language_menu', 'ai'),
    e('main_menu', 'end_message', 'end_chat'),
    e('main_menu', 'main_menu', 'restart'),
    e('main_menu', 'notify_secretary', 'livechat'),
    e('main_menu', 'main_menu', 'default'),
    e('clinic_hours_menu', 'main_menu', 'previous_menu'),
    e('clinic_hours_menu', 'end_message', 'end_conversation'),
    e('service_menu', 'check_dates', 'selected'),
    e('service_menu', 'no_slots_menu', 'empty'),
    e('service_menu', 'main_menu', 'restart'),
    e('service_menu', 'notify_secretary', 'livechat'),
    e('check_dates', 'date_menu'),
    e('date_menu', 'check_times', 'selected'),
    e('date_menu', 'no_slots_menu', 'empty'),
    e('date_menu', 'main_menu', 'restart'),
    e('date_menu', 'notify_secretary', 'livechat'),
    e('check_times', 'time_menu'),
    e('time_menu', 'revalidate_slot', 'selected'),
    e('time_menu', 'no_slots_menu', 'empty'),
    e('time_menu', 'date_menu', 'restart'),
    e('time_menu', 'notify_secretary', 'livechat'),
    e('revalidate_slot', 'confirm_menu'),
    e('confirm_menu', 'create_booking', 'confirm'),
    e('confirm_menu', 'date_menu', 'change'),
    e('confirm_menu', 'notify_secretary', 'secretary'),
    e('confirm_menu', 'main_menu', 'restart'),
    e('confirm_menu', 'notify_secretary', 'livechat'),
    e('confirm_menu', 'confirm_menu', 'default'),
    e('create_booking', 'booking_success'),
    e('booking_success', 'end'),
    e('no_slots_menu', 'date_menu', 'try_again'),
    e('no_slots_menu', 'notify_secretary', 'secretary'),
    e('no_slots_menu', 'end_message', 'end_chat'),
    e('notify_secretary', 'secretary_menu'),
    e('secretary_menu', 'main_menu', 'previous_menu'),
    e('secretary_menu', 'handoff_secretary', 'end_conversation'),
    e('handoff_secretary', 'end'),
    e('language_menu', 'ask_ai_question', 'english'),
    e('language_menu', 'ask_ai_question', 'spanish'),
    e('ask_ai_question', 'wait_ai_reply'),
    e('wait_ai_reply', 'ai_agent'),
    e('ai_agent', 'ask_ai_question', 'replied'),
    e('ai_agent', 'notify_secretary', 'handoff'),
    e('ai_agent', 'main_menu', 'no_match'),
    e('ai_agent', 'notify_secretary', 'error'),
    e('end_message', 'end'),
  ]
  return {
    key: 'safe_appointment_assistant',
    nameKey: 'wf.tpl.safeAppointmentAssistantName',
    descKey: 'wf.tpl.safeAppointmentAssistantDesc',
    nodes,
    edges,
  }
}

export function personalizeWorkflowTemplate(template: WorkflowTemplate, clinic?: ClinicTemplateContext): WorkflowNode[] {
  if (template.key !== 'safe_appointment_assistant') return template.nodes
  return template.nodes.map((node) => {
    if (node.id === 'clinic_hours_menu') {
      return { ...node, config: { ...node.config, message: clinicHoursMessage(clinic) } }
    }
    if (node.id === 'secretary_menu') {
      const phone = clinic?.phone?.trim()
      const text = phone
        ? `A ${clinic?.name?.trim() || 'clinic'} secretary has been notified and will continue this conversation. You can also call the clinic at ${phone}.`
        : 'A clinic secretary has been notified and will continue this conversation. You can also call the clinic.'
      return { ...node, config: { ...node.config, message: text } }
    }
    return node
  })
}

function dynamicBookingTemplate(multipleDoctors: boolean): WorkflowTemplate {
  const key = multipleDoctors ? 'booking_multiple_doctors_ai' : 'booking_single_doctor_ai'
  const firstBookingNode = multipleDoctors ? 'doctor_menu' : 'service_menu'
  const nodes: WorkflowNode[] = [
    n('trigger', 'trigger', 'trigger.message_keyword', { keywords: 'book,appointment,cita,agendar,booking,menu' }, 40, 360),
    n('main_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'Clinic assistant',
      message: 'How can we help you today?', footer: 'Choose an option below.',
      options: JSON.stringify([
        { optionId: 'booking', title: 'Book appointment' },
        { optionId: 'inquiry', title: 'Ask a question' },
        { optionId: 'secretary', title: 'Talk to secretary' },
      ]),
    }, 280, 360),
    ...(multipleDoctors ? [n('doctor_menu', 'action', 'action.interactive_menu', {
      variant: 'list', optionSource: 'clinic_doctors', pageSize: '8', field: 'doctor_id',
      header: 'Choose a doctor', message: 'Select an available doctor.', footer: "Press '0' to restart and '1' for a secretary",
    }, 520, 360)] : []),
    n('service_menu', 'action', 'action.interactive_menu', {
      variant: 'list', optionSource: 'doctor_services', sourceField: multipleDoctors ? 'doctor_id' : '',
      pageSize: '8', field: 'service_id', header: 'Choose a service',
      message: 'Select one of the services currently available with this doctor.',
      footer: "Press '0' to restart and '1' for a secretary",
    }, multipleDoctors ? 760 : 520, 360),
    n('availability', 'action', 'action.check_availability', {
      doctorIdField: 'doctor_id', days: '5', slotsField: 'available_slots',
    }, multipleDoctors ? 1000 : 760, 360),
    n('date_menu', 'action', 'action.offer_slot_menu', {
      pickerMode: 'date', slotsField: 'available_slots', selectField: 'preferred_date', pageSize: '8',
      header: 'Available dates', message: 'Choose a date from the next five days.',
      footer: "Press '0' to restart and '1' for a secretary",
    }, multipleDoctors ? 1240 : 1000, 360),
    n('time_menu', 'action', 'action.offer_slot_menu', {
      pickerMode: 'time', slotsField: 'available_slots', dateField: 'preferred_date', selectField: 'preferred_time', pageSize: '8',
      header: 'Available times', message: 'Choose an available appointment time.',
      footer: "Press '0' to restart and '1' for a secretary",
    }, multipleDoctors ? 1480 : 1240, 360),
    n('confirm_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'Confirm booking',
      message: 'Confirm this doctor, service, date, and time.',
      options: JSON.stringify([{ optionId: 'confirm', title: 'Confirm' }, { optionId: 'cancel', title: 'Start over' }]),
    }, multipleDoctors ? 1720 : 1480, 360),
    n('create_booking', 'action', 'action.create_or_reschedule_booking', {
      mode: 'create', doctorIdField: 'doctor_id', serviceIdField: 'service_id',
      dateField: 'preferred_date', timeField: 'preferred_time',
    }, multipleDoctors ? 1960 : 1720, 360),
    n('success', 'action', 'action.send_message', { text: 'Your appointment is confirmed and has been added to the clinic calendar.' }, multipleDoctors ? 2200 : 1960, 360),
    n('end_success', 'action', 'action.end', {}, multipleDoctors ? 2440 : 2200, 360),
    n('ai_inquiry', 'action', 'action.ai_agent', {
      personality: 'Helpful clinic booking assistant', communicationStyle: 'friendly',
      customInstructions: 'Answer only from the clinic knowledge base and current clinic context. Never diagnose or provide medical advice. If the answer is unavailable, uncertain, safety-sensitive, or the patient requests a person, hand off to the secretary.',
      scenarios: bookingAiScenarios,
    }, 520, 80),
    n('post_inquiry_menu', 'action', 'action.interactive_menu', {
      variant: 'button', optionSource: 'static', header: 'What would you like to do next?',
      message: 'You can continue with a booking or speak with the clinic secretary.',
      options: JSON.stringify([
        { optionId: 'booking', title: 'Book appointment' },
        { optionId: 'secretary', title: 'Talk to secretary' },
      ]),
    }, 760, -100),
    n('handoff_message', 'action', 'action.send_message', { text: 'I am connecting you with the clinic secretary now.' }, 760, 80),
    n('handoff', 'action', 'action.handoff_to_secretary', {}, 1000, 80),
    n('end_handoff', 'action', 'action.end', {}, 1240, 80),
    n('no_options', 'action', 'action.send_message', { text: 'No eligible doctors, services, or future appointment times are available. I am connecting you with the secretary.' }, 1000, 640),
  ]
  const edges: WorkflowEdge[] = [
    e('trigger', 'main_menu'),
    e('main_menu', firstBookingNode, 'booking'),
    e('main_menu', 'ai_inquiry', 'inquiry'),
    e('main_menu', 'handoff_message', 'secretary'),
    e('main_menu', 'handoff_message', 'livechat'),
    e('main_menu', 'ai_inquiry', 'default'),
    ...(multipleDoctors ? [
      e('doctor_menu', 'service_menu', 'selected'),
      e('doctor_menu', 'no_options', 'empty'),
      e('doctor_menu', 'main_menu', 'restart'),
      e('doctor_menu', 'handoff_message', 'livechat'),
    ] : []),
    e('service_menu', 'availability', 'selected'),
    e('service_menu', 'no_options', 'empty'),
    e('service_menu', 'main_menu', 'restart'),
    e('service_menu', 'handoff_message', 'livechat'),
    e('availability', 'date_menu'),
    e('date_menu', 'time_menu', 'selected'),
    e('date_menu', 'no_options', 'empty'),
    e('date_menu', 'main_menu', 'restart'),
    e('date_menu', 'handoff_message', 'livechat'),
    e('time_menu', 'confirm_menu', 'selected'),
    e('time_menu', 'no_options', 'empty'),
    e('time_menu', 'main_menu', 'restart'),
    e('time_menu', 'handoff_message', 'livechat'),
    e('confirm_menu', 'create_booking', 'confirm'),
    e('confirm_menu', 'main_menu', 'cancel'),
    e('confirm_menu', 'main_menu', 'restart'),
    e('confirm_menu', 'handoff_message', 'livechat'),
    e('create_booking', 'success'),
    e('success', 'end_success'),
    e('ai_inquiry', 'post_inquiry_menu', 'replied'),
    e('ai_inquiry', 'end_handoff', 'handoff'),
    e('ai_inquiry', 'handoff_message', 'no_match'),
    e('ai_inquiry', 'handoff_message', 'error'),
    e('post_inquiry_menu', firstBookingNode, 'booking'),
    e('post_inquiry_menu', 'handoff_message', 'secretary'),
    e('post_inquiry_menu', 'handoff_message', 'livechat'),
    e('handoff_message', 'handoff'),
    e('handoff', 'end_handoff'),
    e('no_options', 'handoff'),
  ]
  return {
    key,
    nameKey: multipleDoctors ? 'wf.tpl.multiDoctorBookingName' : 'wf.tpl.singleDoctorBookingName',
    descKey: multipleDoctors ? 'wf.tpl.multiDoctorBookingDesc' : 'wf.tpl.singleDoctorBookingDesc',
    nodes,
    edges,
  }
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  safeAppointmentAssistantTemplate(),
  dynamicBookingTemplate(false),
  dynamicBookingTemplate(true),
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
          { optionId: 'specialized_service', title: 'Specialized service' },
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
      e('doctor_menu', 'specialized_msg', 'specialized_service'),
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
