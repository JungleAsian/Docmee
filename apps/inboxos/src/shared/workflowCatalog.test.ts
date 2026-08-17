import { describe, expect, it } from 'vitest'
import { WORKFLOW_NODE_TYPES } from './workflowNodes'
import { WORKFLOW_TEMPLATES } from './workflowTemplates'

describe('workflow trigger catalog', () => {
  it('only advertises triggers that the worker can produce', () => {
    expect(
      WORKFLOW_NODE_TYPES.filter((node) => node.kind === 'trigger').map((node) => node.type),
    ).toEqual(['trigger.message_keyword', 'trigger.patient_upset'])
  })

  it('keeps every built-in template within the advertised trigger catalog', () => {
    const triggerTypes = new Set(
      WORKFLOW_NODE_TYPES.filter((node) => node.kind === 'trigger').map((node) => node.type),
    )

    for (const template of WORKFLOW_TEMPLATES) {
      for (const node of template.nodes.filter((node) => node.kind === 'trigger')) {
        expect(triggerTypes).toContain(node.type)
      }
    }
  })

  it('keeps every built-in template within the advertised node catalog', () => {
    const nodeTypes = new Set(WORKFLOW_NODE_TYPES.map((node) => node.type))

    for (const template of WORKFLOW_TEMPLATES) {
      for (const node of template.nodes) {
        expect(nodeTypes).toContain(node.type)
      }
    }
  })
  it('configures the guided WhatsApp booking template with structured menu inputs', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.nameKey === 'wf.tpl.guidedWhatsAppBookingName')
    expect(template).toBeDefined()

    const node = (id: string) => template?.nodes.find((item) => item.id === id)
    expect(node('doctor_menu')?.config).toMatchObject({
      menuType: 'doctor',
      clinicIdField: 'clinic_id',
      selectionField: 'doctor_id',
      optionsField: 'doctor_options',
    })
    expect(node('service_menu')?.config).toMatchObject({
      menuType: 'service',
      clinicIdField: 'clinic_id',
      doctorIdField: 'doctor_id',
      selectionField: 'service_id',
      optionsField: 'service_options',
    })
    expect(node('slots_1')?.config).toMatchObject({
      clinicIdField: 'clinic_id',
      doctorIdField: 'doctor_id',
      serviceIdField: 'service_id',
      timezoneField: 'clinic_timezone',
      slotsField: 'available_slots',
    })
    expect(node('date_menu')?.config).toMatchObject({
      menuType: 'date',
      slotsField: 'available_slots',
      selectionField: 'selected_date',
    })
    expect(node('time_menu')?.config).toMatchObject({
      menuType: 'time_slot',
      slotsField: 'available_slots',
      dateField: 'selected_date',
      selectionField: 'selected_booking_key',
    })
    expect(node('revalidate_1')?.config).toMatchObject({
      bookingKeyField: 'selected_booking_key',
      slotsField: 'available_slots',
    })
    expect(node('book_1')?.config).toMatchObject({
      doctorIdField: 'doctor_id',
      serviceIdField: 'service_id',
      dateField: 'preferred_date',
      timeField: 'preferred_time',
      bookingKeyField: 'selected_booking_key',
    })
  })
})