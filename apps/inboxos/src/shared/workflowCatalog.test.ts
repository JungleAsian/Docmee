import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
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
