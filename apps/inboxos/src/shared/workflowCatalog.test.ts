import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
import { WORKFLOW_NODE_TYPES, collectWorkflowFields } from './workflowNodes'
import { WORKFLOW_TEMPLATES } from './workflowTemplates'
import type { WorkflowNode } from './types'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id,
  kind,
  type,
  config,
  x: 0,
  y: 0,
})

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
})

describe('workflow template validation', () => {
  it('validates the guided_whatsapp_booking template without errors', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === 'guided_whatsapp_booking')
    expect(template).toBeDefined()
    if (!template) return

    const errors = validateWorkflowDefinition(template.nodes, template.edges, { requireTrigger: true })
    expect(errors).toEqual([])
  })
})

describe('collectWorkflowFields (no-code Field selector)', () => {
  it('always offers the base context fields even for an empty workflow', () => {
    expect(collectWorkflowFields([])).toEqual(['appointmentId', 'conversationId', 'message', 'patientId', 'transcript'])
  })

  it('offers a field a node writes under its own config-named key', () => {
    const fields = collectWorkflowFields([
      node('ask1', 'action', 'action.ask_capture', { field: 'preferred_date' }),
    ])
    expect(fields).toContain('preferred_date')
    expect(fields).toContain('capture_status') // fixed field ask_capture also writes
  })

  it('falls back to the worker default when a config-named field is left unset', () => {
    const fields = collectWorkflowFields([node('chk1', 'action', 'action.check_availability', {})])
    expect(fields).toContain('available_slots') // configField(node, 'slotsField', 'available_slots')
    expect(fields).toContain('availability_count')
  })

  it('splits a csv allowedFields config into individual field names', () => {
    const fields = collectWorkflowFields([
      node('ext1', 'action', 'action.extract_booking_details', { allowedFields: 'patient_name, phone_number ,doctor_preference' }),
    ])
    expect(fields).toEqual(expect.arrayContaining(['patient_name', 'phone_number', 'doctor_preference', 'booking_confidence']))
  })

  it('reflects the real guided_whatsapp_booking template fields', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === 'guided_whatsapp_booking')
    expect(template).toBeDefined()
    if (!template) return
    const fields = collectWorkflowFields(template.nodes)
    // interactive_menu nodes with a `field` config, ask_capture nodes, and check_availability's slotsField
    expect(fields).toContain('doctor_preference')
    expect(fields).toContain('preferred_date')
    expect(fields).toContain('available_slots')
  })
})
