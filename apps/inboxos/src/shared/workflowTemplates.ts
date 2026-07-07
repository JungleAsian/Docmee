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

const e = (source: string, target: string): WorkflowEdge => ({ id: `${source}_${target}`, source, target })

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
]
