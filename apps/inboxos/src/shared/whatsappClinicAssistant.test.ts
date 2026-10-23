import { describe, expect, it } from 'vitest'
import { checkWorkflow, parseMenuOptions, simulateWorkflow } from '@docmee/agents'
import { WORKFLOW_TEMPLATES, personalizeWorkflowTemplate } from './workflowTemplates'
import type { WorkflowNode } from './types'

const template = WORKFLOW_TEMPLATES.find((item) => item.key === 'whatsapp_clinic_assistant')!
const clinic = {
  name: 'Derma Paz',
  address: '9a. Calle 4-52, Zona 10, Guatemala',
  phone: '+502 5555 5555',
  settings: { businessHours: { monday: { open: '08:30', close: '13:00', closed: false }, sunday: { open: '', close: '', closed: true } } },
}
const nodes = personalizeWorkflowTemplate(template, clinic) as WorkflowNode[]
// The editor's node shape and the engine's are structurally the same; cast once here.
const workflow = { nodes, edges: template.edges } as unknown as { nodes: never[]; edges: never[] }
const byId = new Map(nodes.map((node) => [node.id, node]))
const menus = nodes.filter((node) => node.type === 'action.interactive_menu')
const staticMenus = menus.filter((node) => node.config['optionSource'] === 'static')

describe('WhatsApp clinic assistant template', () => {
  it('is the first template offered', () => {
    expect(WORKFLOW_TEMPLATES[0]!.key).toBe('whatsapp_clinic_assistant')
  })

  it('has no publish-blocking errors, and only asks the clinic to fill in its prices', () => {
    const result = checkWorkflow(workflow.nodes, workflow.edges, { calendarConnected: true, doctorCount: 3, approvedTemplateCategories: [] })
    expect(result.errors).toEqual([])
    // Only the two price pages are left for the clinic to fill in (prices vary per clinic).
    expect(result.warnings.map((warning) => `${warning.code}@${warning.nodeId}`)).toEqual(['unfilled_placeholder@insured_menu', 'unfilled_placeholder@uninsured_menu'])
  })

  it('uses WhatsApp selection (list) menus for every choice', () => {
    expect(menus).toHaveLength(17)
    for (const menu of menus) expect(menu.config['variant'], menu.id).toBe('list')
    expect(nodes.filter((node) => node.type === 'action.offer_slot_menu')).toHaveLength(4)
    expect(menus.filter((node) => node.config['optionSource'] !== 'static').map((node) => node.config['optionSource']).sort()).toEqual(['clinic_doctors', 'doctor_services', 'patient_appointments'])
  })

  it('stays within WhatsApp list limits so menus are never rejected', () => {
    for (const menu of staticMenus) {
      const options = parseMenuOptions(menu.config)
      expect(options.length, menu.id).toBeGreaterThan(0)
      expect(options.length, menu.id).toBeLessThanOrEqual(10)
      for (const option of options) {
        expect(option.title.length, `${menu.id}/${option.optionId}`).toBeLessThanOrEqual(24)
        expect((option as { description?: string }).description?.length ?? 0, `${menu.id}/${option.optionId}`).toBeLessThanOrEqual(72)
      }
    }
    for (const node of [...menus, ...nodes.filter((item) => item.type === 'action.offer_slot_menu')]) {
      expect(String(node.config['header'] ?? '').length, node.id).toBeLessThanOrEqual(60)
      expect(String(node.config['footer'] ?? '').length, node.id).toBeLessThanOrEqual(60)
      expect(String(node.config['buttonLabel'] ?? '').length, node.id).toBeLessThanOrEqual(20)
      expect(String(node.config['message'] ?? '').length, node.id).toBeLessThanOrEqual(1024)
    }
  })

  it('lets patients reply 0 for the main menu and 1 for a secretary from every menu', () => {
    for (const id of [...menus, ...nodes.filter((item) => item.type === 'action.offer_slot_menu')].map((node) => node.id)) {
      const out = template.edges.filter((edge) => edge.source === id)
      expect(out.find((edge) => edge.sourceHandle === 'restart')?.target, id).toBe('main_menu')
      expect(out.find((edge) => edge.sourceHandle === 'livechat')?.target, id).toBe('secretary_message')
    }
  })

  it('answers the patient on every booking result', () => {
    for (const id of ['create_booking', 'reschedule_booking', 'cancel_booking']) {
      expect(byId.get(id)!.config['resultRouting'], id).toBe('branches')
      const handles = template.edges.filter((edge) => edge.source === id).map((edge) => edge.sourceHandle).sort()
      expect(handles, id).toEqual(['error', 'pending', 'success'])
    }
  })

  it('is personalised with the clinic name, address, phone and hours', () => {
    expect(byId.get('main_menu')!.config['message']).toBe('Thank you for contacting Derma Paz. How can we help you today?')
    const location = String(byId.get('location_menu')!.config['message'])
    expect(location).toContain('9a. Calle 4-52')
    expect(location).toContain('+502 5555 5555')
    expect(location).toContain('Monday: 8:30 AM–1:00 PM')
    expect(JSON.stringify(nodes)).not.toContain('{{clinic_')
  })

  type Reply = { optionId?: string; text?: string }
  type Scenarios = NonNullable<Parameters<typeof simulateWorkflow>[1]>['scenarios']
  const SLOTS = ['2030-01-15T09:00:00Z', '2030-01-15T09:30:00Z']
  async function walk(replies: Reply[], scenarios: Scenarios = {}) {
    const run = { ...scenarios, slots: SLOTS }
    let result = await simulateWorkflow(workflow, { context: { message: 'hello' }, scenarios: run })
    expect(result.waitingFor?.nodeId).toBe('main_menu')
    for (const reply of replies) {
      result = await simulateWorkflow(workflow, { replay: result.replay, reply, scenarios: run })
      expect(result.errors, JSON.stringify(reply)).toEqual([])
    }
    return { result, path: result.trace.map((step) => step.nodeId) }
  }
  const BOOKING: Reply[] = [
    { optionId: 'book_appointment' },
    { optionId: 'mock-doctor-1' },
    { optionId: 'mock-service-1' },
    { optionId: '2030-01-15' },
    { optionId: '09:00' },
    { text: 'Ana Lopez' },
    { optionId: 'skip_email' },
    { text: 'Skin check' },
    { optionId: 'confirm' },
  ]

  it('books an appointment from "hello" using only menu taps and three typed answers', async () => {
    const { result, path } = await walk(BOOKING)
    expect(path).toEqual(expect.arrayContaining(['doctor_menu', 'service_menu', 'check_availability', 'date_menu', 'time_menu', 'ask_name', 'email_menu', 'ask_reason', 'confirm_menu', 'create_booking']))
    expect(result.waitingFor?.nodeId).toBe('booked_menu')
    expect(result.context['preferred_date']).toBe('2030-01-15')
    expect(result.context['preferred_time']).toBe('09:00')
    expect(result.context['patient_name']).toBe('Ana Lopez')
  })

  it('collects an email when the patient chooses to add one', async () => {
    const withEmail = [...BOOKING.slice(0, 6), { optionId: 'add_email' }, { text: 'ana@example.com' }, ...BOOKING.slice(7)]
    const { result, path } = await walk(withEmail)
    expect(path).toContain('ask_email')
    expect(result.context['patient_email']).toBe('ana@example.com')
    expect(result.waitingFor?.nodeId).toBe('booked_menu')
  })

  it('apologises and hands over to a secretary when the calendar rejects the booking', async () => {
    const { result, path } = await walk(BOOKING, { providerOutcomes: { create_booking: 'failure' } })
    expect(path.slice(-3)).toEqual(['booking_error', 'handoff', 'end'])
    expect(result.status).toBe('completed')
  })

  it('cancels an existing appointment after a confirmation', async () => {
    const { result, path } = await walk([{ optionId: 'my_appointments' }, { optionId: 'mock-appointment-1' }, { optionId: 'cancel' }, { optionId: 'confirm' }])
    expect(path).toEqual(expect.arrayContaining(['appointments_menu', 'manage_menu', 'confirm_cancel_menu', 'cancel_booking', 'cancelled_message']))
    expect(result.waitingFor?.nodeId).toBe('anything_else_menu')
  })

  it('moves an existing appointment to a newly picked date and time', async () => {
    const { result, path } = await walk([{ optionId: 'my_appointments' }, { optionId: 'mock-appointment-1' }, { optionId: 'change' }, { optionId: '2030-01-15' }, { optionId: '09:30' }, { optionId: 'confirm' }])
    expect(path).toEqual(expect.arrayContaining(['change_availability', 'change_date_menu', 'change_time_menu', 'confirm_change_menu', 'reschedule_booking', 'changed_message']))
    expect(result.waitingFor?.nodeId).toBe('anything_else_menu')
  })

  it('lets the patient chat with the AI assistant and keeps the conversation going', async () => {
    const { result, path } = await walk([{ optionId: 'ask_question' }, { text: 'Do you treat acne?' }], { aiAgentOutcome: 'replied' })
    expect(path).toEqual(expect.arrayContaining(['ai_intro', 'ai_wait', 'ai_agent']))
    expect(result.waitingFor?.nodeId).toBe('ai_wait')
  })

  it('shows prices and location and returns to the main menu', async () => {
    for (const [choice, menu] of [['prices', 'prices_menu'], ['location_hours', 'location_menu']] as const) {
      const { result } = await walk([{ optionId: choice }, { optionId: 'main_menu' }])
      expect(result.trace.map((step) => step.nodeId), choice).toContain(menu)
      expect(result.waitingFor?.nodeId, choice).toBe('main_menu')
    }
  })

  it('re-shows a menu when the patient types something it does not understand', async () => {
    const { result } = await walk([{ text: 'what?' }])
    expect(result.waitingFor?.nodeId).toBe('main_menu')
  })
})
