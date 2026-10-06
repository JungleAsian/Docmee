import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { parseMenuOptions } from './workflow-engine.js'
import { validateWorkflowDefinitionDetailed, type WorkflowValidationIssue } from './workflow-validator.js'

/**
 * Workflow lint: problems that do NOT block saving or publishing but will make
 * the workflow misbehave for patients — a booking that can never find its date,
 * a menu WhatsApp will reject, a failure that leaves the patient without a reply.
 * The structural validator (workflow-validator.ts) stays the hard gate; these are
 * advisory warnings shown while the workflow is being built.
 *
 * Every rule here mirrors real runtime behaviour in workflow-engine.ts and
 * apps/workers/src/workflow-runner.worker.ts (field defaults, WhatsApp limits,
 * silent skips). Keep them in sync when the runner changes.
 */

export type WorkflowLintCode =
  | 'trigger_matches_everything'
  | 'missing_input_field'
  | 'booking_failure_unhandled'
  | 'booking_without_availability'
  | 'whatsapp_limit_exceeded'
  | 'empty_setting'
  | 'calendar_not_connected'
  | 'no_doctors'
  | 'template_not_approved'

export interface WorkflowLintIssue extends Omit<WorkflowValidationIssue, 'code' | 'severity'> {
  code: WorkflowLintCode
  severity: 'warning'
}

/** Clinic facts that only the server knows; every key is optional. */
export interface WorkflowLintContext {
  /** True when the clinic or at least one doctor has Google Calendar connected. */
  calendarConnected?: boolean
  doctorCount?: number
  /** Template categories with at least one Meta-approved template. */
  approvedTemplateCategories?: string[]
}

export interface WorkflowCheckResult {
  /** Must be fixed before the workflow can be published. */
  errors: WorkflowValidationIssue[]
  /** Will not block publishing, but will likely misbehave for patients. */
  warnings: WorkflowLintIssue[]
}

const BOOKING_TYPES = new Set(['action.create_booking', 'action.create_or_reschedule_booking', 'action.reschedule_booking', 'action.cancel_booking'])
const CALENDAR_TYPES = new Set([...BOOKING_TYPES, 'action.check_availability'])
const AVAILABILITY_TYPES = new Set(['action.check_availability', 'action.offer_slot_menu', 'action.offer_slots'])
const EXTRACTOR_TYPES = new Set(['action.extract_booking_details', 'action.transcribe_booking_voice'])

// WhatsApp Cloud API limits for interactive messages and text.
const WA = { listRowTitle: 24, buttonTitle: 20, header: 60, footer: 60, interactiveBody: 1024, text: 4096 }

function cfgString(node: WorkflowNode, key: string): string {
  return String(node.config?.[key] ?? '').trim()
}

function configField(node: WorkflowNode, key: string, fallback: string): string {
  return cfgString(node, key) || fallback
}

function label(node: WorkflowNode): string {
  const custom = node.config?.['customLabel']
  if (typeof custom === 'string' && custom.trim()) return custom.trim()
  const words = node.id.replace(/[_-]+/g, ' ').trim()
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Step'
}

/** Context fields a node writes when it runs (mirrors the worker). `'*'` = may write any field. */
function producedFields(node: WorkflowNode): string[] {
  switch (node.type) {
    case 'action.ask_capture':
      return [cfgString(node, 'field'), 'capture_status', 'capture_error'].filter(Boolean)
    case 'action.interactive_menu': {
      const out = [cfgString(node, 'field')]
      const source = cfgString(node, 'optionSource')
      if (source === 'doctor_services' && cfgString(node, 'sourceField') === '' && node.config?.['sourceField'] !== undefined) out.push('doctor_id')
      return out.filter(Boolean)
    }
    case 'action.check_availability':
      return [configField(node, 'slotsField', 'available_slots'), 'availability_count', ...(cfgString(node, 'appointmentIdField') ? ['doctor_id', 'service_id'] : [])]
    case 'action.offer_slots':
      return ['offered_slots']
    case 'action.offer_slot_menu': {
      const mode = cfgString(node, 'pickerMode') || 'date'
      return [configField(node, 'selectField', mode === 'time' ? 'preferred_time' : 'preferred_date'), 'selected_booking_key']
    }
    case 'action.create_booking':
    case 'action.create_or_reschedule_booking':
    case 'action.reschedule_booking':
    case 'action.cancel_booking':
      return ['appointment_id', 'booking_status', 'calendar_sync_pending']
    case 'action.extract_booking_details':
    case 'action.transcribe_booking_voice': {
      const allowed = cfgString(node, 'allowedFields') || cfgString(node, 'allowed_fields')
      if (!allowed) return ['*']
      return [...allowed.split(',').map((field) => field.trim()).filter(Boolean), 'needs_review', 'booking_confidence']
    }
    case 'logic.ai_classify_intent':
      return [configField(node, 'confidenceField', 'booking_confidence'), 'classification_confidence', 'confidence_route', 'needs_clarification']
    case 'action.ai_agent':
      return ['ai_agent_matched_scenario', 'ai_agent_action', 'ai_agent_kb_hit']
    default:
      return []
  }
}

/** Fields a node needs to have been set by an earlier step, with the setting that names each one. */
function requiredFields(node: WorkflowNode): Array<{ field: string; setting: string; alternatives?: string[] }> {
  switch (node.type) {
    case 'action.create_booking':
      return [
        { field: configField(node, 'dateField', 'preferred_date'), setting: 'dateField' },
        { field: configField(node, 'timeField', 'preferred_time'), setting: 'timeField', alternatives: ['selected_booking_key'] },
      ]
    case 'action.create_or_reschedule_booking': {
      const reschedule = cfgString(node, 'mode') === 'reschedule'
      return [
        ...(reschedule ? [{ field: configField(node, 'appointmentIdField', 'appointment_id'), setting: 'appointmentIdField' }] : []),
        { field: configField(node, 'dateField', 'preferred_date'), setting: 'dateField' },
        { field: configField(node, 'timeField', 'preferred_time'), setting: 'timeField', alternatives: ['selected_booking_key'] },
      ]
    }
    case 'action.reschedule_booking':
      return [
        { field: configField(node, 'appointmentIdField', 'appointment_id'), setting: 'appointmentIdField' },
        { field: configField(node, 'dateField', 'preferred_date'), setting: 'dateField' },
        { field: configField(node, 'timeField', 'preferred_time'), setting: 'timeField', alternatives: ['selected_booking_key'] },
      ]
    case 'action.cancel_booking':
      return [{ field: configField(node, 'appointmentIdField', 'appointment_id'), setting: 'appointmentIdField' }]
    case 'action.check_availability':
      return cfgString(node, 'appointmentIdField') ? [{ field: cfgString(node, 'appointmentIdField'), setting: 'appointmentIdField' }] : []
    case 'action.offer_slots':
    case 'action.offer_slot_menu':
      return [{ field: configField(node, 'slotsField', 'available_slots'), setting: 'slotsField' }]
    case 'logic.condition':
      return cfgString(node, 'field') ? [{ field: cfgString(node, 'field'), setting: 'field' }] : []
    case 'action.interactive_menu': {
      // A doctor's services menu needs to know which doctor; sourceField '' means
      // "use the clinic's only doctor" and needs nothing upstream.
      if (cfgString(node, 'optionSource') !== 'doctor_services') return []
      const raw = node.config?.['sourceField']
      const sourceField = raw === undefined ? 'doctor_id' : String(raw).trim()
      return sourceField ? [{ field: sourceField, setting: 'sourceField' }] : []
    }
    default:
      return []
  }
}

function warning(
  node: WorkflowNode,
  code: WorkflowLintCode,
  en: { title: string; whatHappened: string; howToFix: string },
  es: { title: string; whatHappened: string; howToFix: string },
  technicalDetails: string,
): WorkflowLintIssue {
  return { code, severity: 'warning', where: label(node), nodeId: node.id, ...en, translations: { es }, technicalDetails }
}

/** Every node that can run before `id` on some path from the trigger. */
function ancestorsOf(id: string, incoming: Map<string, string[]>): Set<string> {
  const seen = new Set<string>()
  const stack = [...(incoming.get(id) ?? [])]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(incoming.get(current) ?? []))
  }
  return seen
}

export function lintWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], context: WorkflowLintContext = {}): WorkflowLintIssue[] {
  const issues: WorkflowLintIssue[] = []
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, string[]>()
  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source])
  }

  for (const node of nodes) {
    const ancestors = ancestorsOf(node.id, incoming)
    const upstream = [...ancestors].map((id) => byId.get(id)!).filter(Boolean)

    // Trigger that fires on every message.
    if (node.type === 'trigger.message_keyword' && !cfgString(node, 'keywords')) {
      issues.push(warning(node, 'trigger_matches_everything',
        { title: 'This workflow starts on every message', whatHappened: 'The trigger has no keywords, so every patient message starts this workflow — including replies meant for staff or other workflows.', howToFix: 'Add the keywords that should start it (for example: cita, appointment, agendar), separated by commas.' },
        { title: 'Este flujo inicia con cada mensaje', whatHappened: 'El disparador no tiene palabras clave, así que cualquier mensaje del paciente inicia este flujo, incluso respuestas para el personal u otros flujos.', howToFix: 'Agrega las palabras clave que deben iniciarlo (por ejemplo: cita, appointment, agendar), separadas por comas.' },
        `Trigger ${node.id} has empty keywords; workflowKeywordMatches() returns true for every message.`))
    }

    // Values a step reads that no earlier step ever sets.
    const required = requiredFields(node)
    if (required.length > 0 && !upstream.some((up) => producedFields(up).includes('*'))) {
      const available = new Set(upstream.flatMap(producedFields))
      for (const need of required) {
        if (available.has(need.field) || need.alternatives?.some((alt) => available.has(alt))) continue
        issues.push(warning(node, 'missing_input_field',
          {
            title: `“${need.field}” is never filled in before this step`,
            whatHappened: `This step reads “${need.field}”, but no earlier step on any path saves an answer under that name, so it will be empty when this step runs${BOOKING_TYPES.has(node.type) ? ' and the booking will fail' : ''}.`,
            howToFix: `Add a step before this one that saves “${need.field}” (for example a question, menu or slot picker), or change this step's “${need.setting}” setting to the name an earlier step actually uses.`,
          },
          {
            title: `“${need.field}” nunca se completa antes de este paso`,
            whatHappened: `Este paso lee “${need.field}”, pero ningún paso anterior guarda una respuesta con ese nombre, así que estará vacío al ejecutarse${BOOKING_TYPES.has(node.type) ? ' y la cita fallará' : ''}.`,
            howToFix: `Agrega antes un paso que guarde “${need.field}” (por ejemplo una pregunta, menú o selector de horarios), o cambia la opción “${need.setting}” de este paso al nombre que usa un paso anterior.`,
          },
          `${node.type} ${node.id} reads ${need.setting}="${need.field}" but no upstream node produces it.`))
      }
    }

    if (BOOKING_TYPES.has(node.type)) {
      // A failure with single routing throws and ends the run with no reply.
      if (cfgString(node, 'resultRouting') !== 'branches') {
        issues.push(warning(node, 'booking_failure_unhandled',
          { title: 'A failed booking would leave the patient without a reply', whatHappened: 'With “single” result routing, if the calendar rejects the time or is unavailable, the whole workflow stops and the patient gets no answer.', howToFix: 'Set “Result routing” to “branches” and connect the error branch to a secretary handoff or an apology message.' },
          { title: 'Una cita fallida dejaría al paciente sin respuesta', whatHappened: 'Con el enrutamiento “single”, si el calendario rechaza el horario o no está disponible, el flujo se detiene y el paciente no recibe respuesta.', howToFix: 'Cambia “Result routing” a “branches” y conecta la rama de error a un traspaso a secretaria o a un mensaje de disculpa.' },
          `${node.type} ${node.id} uses resultRouting=single; engine rethrows booking errors.`))
      }
      // Free-typed times are frequently unavailable; the runner re-checks and fails.
      if (node.type !== 'action.cancel_booking' && !upstream.some((up) => AVAILABILITY_TYPES.has(up.type) || EXTRACTOR_TYPES.has(up.type))) {
        issues.push(warning(node, 'booking_without_availability',
          { title: 'The time is never checked against the calendar', whatHappened: 'No earlier step checks availability or offers free slots, so patients can pick a time that is already taken or outside working hours and the booking will be rejected.', howToFix: 'Add “Check availability” and “Offer slot menu” before this step so patients can only choose free times.' },
          { title: 'El horario nunca se verifica en el calendario', whatHappened: 'Ningún paso anterior verifica disponibilidad ni ofrece horarios libres, así que el paciente puede elegir un horario ocupado o fuera del horario de atención y la cita será rechazada.', howToFix: 'Agrega “Verificar disponibilidad” y “Ofrecer menú de horarios” antes de este paso para que el paciente solo elija horarios libres.' },
          `${node.type} ${node.id} has no upstream availability or slot node.`))
      }
    }

    if (CALENDAR_TYPES.has(node.type) && context.calendarConnected === false) {
      issues.push(warning(node, 'calendar_not_connected',
        { title: 'Google Calendar is not connected', whatHappened: 'Neither the clinic nor any doctor has Google Calendar connected, so this step will fail every time it runs.', howToFix: 'Connect Google Calendar in Studio → Integrations (or on a doctor) before publishing this workflow.' },
        { title: 'Google Calendar no está conectado', whatHappened: 'Ni la clínica ni ningún doctor tiene Google Calendar conectado, así que este paso fallará cada vez que se ejecute.', howToFix: 'Conecta Google Calendar en Studio → Integraciones (o en un doctor) antes de publicar este flujo.' },
        `${node.type} ${node.id}: no clinic or doctor calendar tokens.`))
    }

    if (node.type === 'action.interactive_menu') {
      const source = cfgString(node, 'optionSource') || 'static'
      const variant = cfgString(node, 'variant') || 'list'
      if (source === 'static') {
        const limit = variant === 'list' ? WA.listRowTitle : WA.buttonTitle
        const long = parseMenuOptions(node.config).filter((option) => option.title.length > limit)
        if (long.length > 0) {
          issues.push(warning(node, 'whatsapp_limit_exceeded',
            { title: `Some options are longer than WhatsApp allows (${limit} characters)`, whatHappened: `WhatsApp rejects ${variant === 'list' ? 'list' : 'button'} options over ${limit} characters, so patients get a plain text menu instead: ${long.map((o) => `“${o.title}”`).join(', ')}.`, howToFix: `Shorten these options to ${limit} characters or fewer.` },
            { title: `Algunas opciones superan el límite de WhatsApp (${limit} caracteres)`, whatHappened: `WhatsApp rechaza opciones de ${variant === 'list' ? 'lista' : 'botón'} de más de ${limit} caracteres, así que el paciente recibe un menú de texto simple: ${long.map((o) => `“${o.title}”`).join(', ')}.`, howToFix: `Acorta estas opciones a ${limit} caracteres o menos.` },
            `interactive_menu ${node.id} options over ${limit} chars: ${long.map((o) => o.optionId).join(',')}`))
        }
      }
      if (source === 'clinic_doctors' && context.doctorCount === 0) {
        issues.push(warning(node, 'no_doctors',
          { title: 'This doctor menu has no doctors to show', whatHappened: 'The clinic has no doctors yet, so this menu will always take its “empty” branch.', howToFix: 'Add doctors in Studio → Doctors, or use a static menu instead.' },
          { title: 'Este menú de doctores no tiene doctores', whatHappened: 'La clínica aún no tiene doctores, así que este menú siempre tomará la rama “empty”.', howToFix: 'Agrega doctores en Studio → Doctores, o usa un menú estático.' },
          `interactive_menu ${node.id} optionSource=clinic_doctors with 0 doctors.`))
      }
    }

    if (['action.interactive_menu', 'action.offer_slot_menu'].includes(node.type)) {
      const tooLong: string[] = []
      if (cfgString(node, 'header').length > WA.header) tooLong.push(`header > ${WA.header}`)
      if (cfgString(node, 'footer').length > WA.footer) tooLong.push(`footer > ${WA.footer}`)
      if (cfgString(node, 'message').length > WA.interactiveBody) tooLong.push(`message > ${WA.interactiveBody}`)
      if (tooLong.length > 0) {
        issues.push(warning(node, 'whatsapp_limit_exceeded',
          { title: 'Menu text is longer than WhatsApp allows', whatHappened: `WhatsApp limits: ${tooLong.join(', ')} characters. Longer text makes WhatsApp reject the menu.`, howToFix: 'Shorten the header, message or footer of this menu.' },
          { title: 'El texto del menú supera el límite de WhatsApp', whatHappened: `Límites de WhatsApp: ${tooLong.join(', ')} caracteres. Un texto más largo hace que WhatsApp rechace el menú.`, howToFix: 'Acorta el encabezado, mensaje o pie de este menú.' },
          `${node.type} ${node.id}: ${tooLong.join('; ')}`))
      }
    }

    if (node.type === 'action.send_message' && cfgString(node, 'text').length > WA.text) {
      issues.push(warning(node, 'whatsapp_limit_exceeded',
        { title: `Message is longer than WhatsApp allows (${WA.text} characters)`, whatHappened: 'WhatsApp rejects text messages this long, so the patient will not receive it.', howToFix: 'Shorten the message or split it into two message steps.' },
        { title: `El mensaje supera el límite de WhatsApp (${WA.text} caracteres)`, whatHappened: 'WhatsApp rechaza mensajes así de largos, así que el paciente no lo recibirá.', howToFix: 'Acorta el mensaje o divídelo en dos pasos de mensaje.' },
        `send_message ${node.id} text length ${cfgString(node, 'text').length}`))
    }

    if (node.type === 'action.add_tag' && !cfgString(node, 'tag')) {
      issues.push(warning(node, 'empty_setting',
        { title: 'No tag chosen', whatHappened: 'This step has no tag name, so it does nothing useful.', howToFix: 'Open the step and type the tag to add, or remove the step.' },
        { title: 'No se eligió etiqueta', whatHappened: 'Este paso no tiene nombre de etiqueta, así que no hace nada útil.', howToFix: 'Abre el paso y escribe la etiqueta a agregar, o elimina el paso.' },
        `add_tag ${node.id} has empty tag.`))
    }

    if (node.type === 'action.ask_capture' && !cfgString(node, 'question')) {
      issues.push(warning(node, 'empty_setting',
        { title: 'No question written', whatHappened: `The patient will get a generic “Please provide ${configField(node, 'field', 'answer').replaceAll('_', ' ')}.” instead of a clear question.`, howToFix: 'Open the step and write the question the patient should see.' },
        { title: 'No se escribió la pregunta', whatHappened: `El paciente recibirá un genérico “Please provide ${configField(node, 'field', 'answer').replaceAll('_', ' ')}.” en lugar de una pregunta clara.`, howToFix: 'Abre el paso y escribe la pregunta que verá el paciente.' },
        `ask_capture ${node.id} has empty question; runner falls back to a generic English prompt.`))
    }

    if (node.type === 'action.send_template') {
      const category = cfgString(node, 'category')
      if (!category) {
        issues.push(warning(node, 'empty_setting',
          { title: 'No template category chosen', whatHappened: 'This step is skipped silently because it has no template category.', howToFix: 'Open the step and choose which template category to send.' },
          { title: 'No se eligió categoría de plantilla', whatHappened: 'Este paso se omite sin aviso porque no tiene categoría de plantilla.', howToFix: 'Abre el paso y elige qué categoría de plantilla enviar.' },
          `send_template ${node.id} has empty category; runner returns without sending.`))
      } else if (context.approvedTemplateCategories && !context.approvedTemplateCategories.includes(category)) {
        issues.push(warning(node, 'template_not_approved',
          { title: 'No approved template for this category', whatHappened: `There is no Meta-approved template in the “${category}” category, so this step is skipped and nothing is sent.`, howToFix: 'Create the template in Studio → Templates and wait for Meta approval, or pick a category that has an approved template.' },
          { title: 'No hay plantilla aprobada para esta categoría', whatHappened: `No hay una plantilla aprobada por Meta en la categoría “${category}”, así que este paso se omite y no se envía nada.`, howToFix: 'Crea la plantilla en Studio → Plantillas y espera la aprobación de Meta, o elige una categoría con plantilla aprobada.' },
          `send_template ${node.id} category=${category} has no approved template.`))
      }
    }
  }
  return issues
}

/** Everything the editor shows: blocking errors (as at publish time) plus advisory warnings. */
export function checkWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[], context: WorkflowLintContext = {}): WorkflowCheckResult {
  return {
    errors: validateWorkflowDefinitionDetailed(nodes, edges, { requireTrigger: true }),
    warnings: lintWorkflow(nodes, edges, context),
  }
}
