import { describe, expect, it } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { checkWorkflow, lintWorkflow } from '../workflows/workflow-lint.js'

const KIND: Record<string, WorkflowNode['kind']> = { trigger: 'trigger', logic: 'logic', action: 'action' }
const node = (id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  type,
  kind: KIND[type.split('.')[0]!]!,
  config,
  x: 0,
  y: 0,
})
const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({
  id: `${source}-${target}-${sourceHandle ?? ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
})

/** A correctly built booking flow: question → availability → date menu → time menu → booking. */
function goodBookingFlow(overrides: Partial<Record<string, Record<string, unknown>>> = {}) {
  const nodes = [
    node('start', 'trigger.message_keyword', { keywords: 'cita, appointment', ...overrides['start'] }),
    node('ask_name', 'action.ask_capture', { field: 'patient_name', question: '¿Cuál es tu nombre?', validation: 'text', ...overrides['ask_name'] }),
    node('check', 'action.check_availability', { days: 7, ...overrides['check'] }),
    node('pick_date', 'action.offer_slot_menu', { pickerMode: 'date', ...overrides['pick_date'] }),
    node('pick_time', 'action.offer_slot_menu', { pickerMode: 'time', ...overrides['pick_time'] }),
    node('book', 'action.create_booking', { resultRouting: 'branches', ...overrides['book'] }),
    node('ok', 'action.send_message', { text: 'Listo, tu cita quedó agendada.' }),
    node('handoff', 'action.handoff_to_secretary'),
    node('end', 'action.end'),
  ]
  const edges = [
    edge('start', 'ask_name'),
    edge('ask_name', 'check'),
    edge('check', 'pick_date'),
    edge('pick_date', 'pick_time', 'selected'),
    edge('pick_date', 'handoff', 'empty'),
    edge('pick_time', 'book', 'selected'),
    edge('pick_time', 'handoff', 'empty'),
    edge('book', 'ok', 'success'),
    edge('book', 'ok', 'pending'),
    edge('book', 'handoff', 'error'),
    edge('ok', 'end'),
    edge('handoff', 'end'),
  ]
  return { nodes, edges }
}

const codes = (issues: Array<{ code: string; nodeId?: string }>) => issues.map((issue) => `${issue.code}@${issue.nodeId}`)

describe('lintWorkflow', () => {
  it('finds nothing to warn about in a correctly built booking flow', () => {
    const { nodes, edges } = goodBookingFlow()
    expect(lintWorkflow(nodes, edges, { calendarConnected: true, doctorCount: 2 })).toEqual([])
    expect(checkWorkflow(nodes, edges).errors).toEqual([])
  })

  it('warns when the trigger has no keywords', () => {
    const { nodes, edges } = goodBookingFlow({ start: { keywords: '' } })
    expect(codes(lintWorkflow(nodes, edges))).toEqual(['trigger_matches_everything@start'])
  })

  it('warns when a booking reads a date and time no earlier step sets', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'cita' }),
      node('check', 'action.check_availability'),
      node('book', 'action.create_booking', { resultRouting: 'branches', dateField: 'fecha', timeField: 'hora' }),
      node('end', 'action.end'),
    ]
    const edges = [edge('start', 'check'), edge('check', 'book'), edge('book', 'end', 'success'), edge('book', 'end', 'pending'), edge('book', 'end', 'error')]
    const issues = lintWorkflow(nodes, edges)
    expect(codes(issues)).toEqual(['missing_input_field@book', 'missing_input_field@book'])
    expect(issues[0]!.title).toContain('“fecha”')
    expect(issues[0]!.whatHappened).toContain('the booking will fail')
    expect(issues[0]!.translations?.es?.title).toContain('nunca se completa')
  })

  it('accepts a field set by a question earlier on the path', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'cancelar' }),
      node('which', 'action.ask_capture', { field: 'appointment_id', question: '¿Qué cita?' }),
      node('cancel', 'action.cancel_booking', { resultRouting: 'branches' }),
      node('end', 'action.end'),
    ]
    const edges = [edge('start', 'which'), edge('which', 'cancel'), edge('cancel', 'end', 'success'), edge('cancel', 'end', 'pending'), edge('cancel', 'end', 'error')]
    expect(lintWorkflow(nodes, edges)).toEqual([])
  })

  it('treats an extractor without a field list as able to fill any field', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'cita' }),
      node('extract', 'action.extract_booking_details'),
      node('book', 'action.create_booking', { resultRouting: 'branches' }),
      node('end', 'action.end'),
    ]
    const edges = [edge('start', 'extract'), edge('extract', 'book'), edge('book', 'end', 'success'), edge('book', 'end', 'pending'), edge('book', 'end', 'error')]
    expect(lintWorkflow(nodes, edges)).toEqual([])
  })

  it('warns when a booking failure would end the run without a reply', () => {
    const { nodes, edges } = goodBookingFlow({ book: { resultRouting: 'single' } })
    expect(codes(lintWorkflow(nodes, edges))).toContain('booking_failure_unhandled@book')
  })

  it('warns when a booking never checks availability', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'cita' }),
      node('date', 'action.ask_capture', { field: 'preferred_date', question: '¿Qué día?', validation: 'date' }),
      node('time', 'action.ask_capture', { field: 'preferred_time', question: '¿A qué hora?', validation: 'time' }),
      node('book', 'action.create_booking', { resultRouting: 'branches' }),
      node('end', 'action.end'),
    ]
    const edges = [edge('start', 'date'), edge('date', 'time'), edge('time', 'book'), edge('book', 'end', 'success'), edge('book', 'end', 'pending'), edge('book', 'end', 'error')]
    expect(codes(lintWorkflow(nodes, edges))).toEqual(['booking_without_availability@book'])
  })

  it('warns about calendar, doctors and templates using clinic facts', () => {
    const { nodes, edges } = goodBookingFlow()
    nodes.push(node('docs', 'action.interactive_menu', { optionSource: 'clinic_doctors', field: 'doctor_id' }))
    nodes.push(node('tpl', 'action.send_template', { category: 'appointment_reminder' }))
    const issues = codes(lintWorkflow(nodes, edges, { calendarConnected: false, doctorCount: 0, approvedTemplateCategories: [] }))
    expect(issues).toEqual(expect.arrayContaining(['calendar_not_connected@check', 'calendar_not_connected@book', 'no_doctors@docs', 'template_not_approved@tpl']))
  })

  it('does not guess about clinic facts it was not given', () => {
    const { nodes, edges } = goodBookingFlow()
    nodes.push(node('tpl', 'action.send_template', { category: 'appointment_reminder' }))
    expect(codes(lintWorkflow(nodes, edges))).not.toContain('template_not_approved@tpl')
    expect(codes(lintWorkflow(nodes, edges))).not.toContain('calendar_not_connected@book')
  })

  it('warns about menu options WhatsApp would reject', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'menu' }),
      node('menu', 'action.interactive_menu', {
        variant: 'buttons',
        options: [{ optionId: 'a', title: 'Agendar una cita nueva hoy' }, { optionId: 'b', title: 'Cancelar' }],
      }),
    ]
    const issues = lintWorkflow(nodes, [edge('start', 'menu')])
    expect(codes(issues)).toEqual(['whatsapp_limit_exceeded@menu'])
    expect(issues[0]!.whatHappened).toContain('Agendar una cita nueva hoy')
  })

  it('warns about empty settings that make a step do nothing', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'hola' }),
      node('tag', 'action.add_tag', {}),
      node('ask', 'action.ask_capture', { field: 'email', validation: 'email' }),
      node('tpl', 'action.send_template', {}),
    ]
    const edges = [edge('start', 'tag'), edge('tag', 'ask'), edge('ask', 'tpl')]
    expect(codes(lintWorkflow(nodes, edges))).toEqual(['empty_setting@tag', 'empty_setting@ask', 'empty_setting@tpl'])
  })

  it('needs a doctor before a doctor-services menu', () => {
    const nodes = [
      node('start', 'trigger.message_keyword', { keywords: 'servicios' }),
      node('services', 'action.interactive_menu', { optionSource: 'doctor_services', field: 'service_id' }),
    ]
    expect(codes(lintWorkflow(nodes, [edge('start', 'services')]))).toEqual(['missing_input_field@services'])
    nodes[1]!.config['sourceField'] = ''
    expect(lintWorkflow(nodes, [edge('start', 'services')])).toEqual([])
  })
})

describe('plain-language publish errors', () => {
  it('explains a question with no “Save answer as” field and points at the step', () => {
    const { nodes, edges } = goodBookingFlow({ ask_name: { field: '' } })
    const issue = checkWorkflow(nodes, edges).errors.find((e) => e.nodeId === 'ask_name')
    expect(issue).toMatchObject({ code: 'incomplete_node', title: 'A question does not say where to save the answer' })
    expect(issue?.translations?.es?.howToFix).toContain('Guardar respuesta como')
  })

  it('names the booking branch that has nowhere to go', () => {
    const { nodes, edges } = goodBookingFlow()
    const issues = checkWorkflow(nodes, edges.filter((e) => !(e.source === 'book' && e.sourceHandle === 'pending'))).errors
    expect(issues.find((e) => e.code === 'missing_branch' && e.nodeId === 'book')?.branch).toBe('pending')
  })

  it('explains a missing trigger', () => {
    const { nodes, edges } = goodBookingFlow()
    const issues = checkWorkflow(nodes.filter((n) => n.id !== 'start'), edges.filter((e) => e.source !== 'start')).errors
    expect(issues.some((e) => e.title === 'The workflow needs exactly one starting trigger')).toBe(true)
  })
})

describe('checkWorkflow', () => {
  it('reports publish-blocking errors even while the workflow is a draft', () => {
    const { nodes, edges } = goodBookingFlow()
    const withoutErrorBranch = edges.filter((e) => !(e.source === 'book' && e.sourceHandle === 'error'))
    const result = checkWorkflow(nodes, withoutErrorBranch, { calendarConnected: true })
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.every((issue) => issue.severity === 'error')).toBe(true)
    expect(result.warnings).toEqual([])
  })
})
