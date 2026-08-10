import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
import { WORKFLOW_NODE_TYPES, collectWorkflowFields, collectWorkflowTags, collectFieldValueOptions, slugifyOptionId, uniqueOptionId, ENUM_FIELD_OPTIONS, branchRows } from './workflowNodes'
import { TAG_TYPES } from './tagTypes'
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

describe('collectWorkflowTags (no-code Tag selector)', () => {
  it('returns nothing for a workflow with no add_tag nodes', () => {
    expect(collectWorkflowTags([node('t', 'trigger', 'trigger.message_keyword')])).toEqual([])
  })

  it('collects tag values from every add_tag node, deduped and sorted', () => {
    const tags = collectWorkflowTags([
      node('a', 'action', 'action.add_tag', { tag: 'urgent' }),
      node('b', 'action', 'action.add_tag', { tag: 'needs_human' }),
      node('c', 'action', 'action.add_tag', { tag: 'urgent' }),
    ])
    expect(tags).toEqual(['needs_human', 'urgent'])
  })

  it('the guided_whatsapp_booking template only uses tags in the canonical palette', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === 'guided_whatsapp_booking')
    expect(template).toBeDefined()
    if (!template) return
    const tags = collectWorkflowTags(template.nodes)
    const canonical = new Set(TAG_TYPES.map((tt) => tt.name))
    for (const tag of tags) expect(canonical.has(tag)).toBe(true)
  })
})

describe('ENUM_FIELD_OPTIONS (Variant / Operator no-code selectors)', () => {
  it('offers exactly the variants the worker actually understands', () => {
    expect(ENUM_FIELD_OPTIONS.variant?.map((o) => o.value)).toEqual(['list', 'button'])
  })

  it('offers exactly the operators evalCondition actually understands', () => {
    expect(ENUM_FIELD_OPTIONS.op?.map((o) => o.value)).toEqual(['equals', 'contains', 'not_equals'])
  })

  it('offers exactly the template categories findApprovedByCategory can serve', () => {
    // Must mirror MessageTemplateCategory in shared/types.ts — the worker
    // silently skips any other value at runtime.
    expect(ENUM_FIELD_OPTIONS.category?.map((o) => o.value)).toEqual([
      'appointment_confirmation',
      'appointment_reminder',
      'human_handoff_notification',
      'review_request',
    ])
    // …and every label must resolve through the shared template-category keys.
    for (const o of ENUM_FIELD_OPTIONS.category ?? []) {
      expect(o.labelKey).toMatch(/^studio\.templates\.category\./)
    }
  })
})

describe('collectFieldValueOptions (dependent Value selector)', () => {
  const menuOptions = JSON.stringify([
    { optionId: 'opt_pricing', title: '💰 Pricing' },
    { optionId: 'opt_book', title: 'Book a visit' },
  ])

  it('returns nothing without a selected field', () => {
    expect(collectFieldValueOptions([node('m', 'action', 'action.interactive_menu', { field: 'choice', options: menuOptions })], '')).toEqual([])
  })

  it('offers a menu field the option titles the engine actually writes, plus reserved handles', () => {
    // workflow-engine.ts: ctx[field] = selected?.title ?? handle
    const values = collectFieldValueOptions(
      [node('m', 'action', 'action.interactive_menu', { field: 'choice', options: menuOptions })],
      'choice',
    ).map((o) => o.value)
    expect(values).toEqual(['💰 Pricing', 'Book a visit', 'restart', 'livechat', 'default'])
  })

  it('ignores menu nodes whose field config names a different field', () => {
    expect(
      collectFieldValueOptions(
        [node('m', 'action', 'action.interactive_menu', { field: 'choice', options: menuOptions })],
        'other_field',
      ),
    ).toEqual([])
  })

  it('accepts options stored as a real array, not only a JSON string', () => {
    const values = collectFieldValueOptions(
      [node('m', 'action', 'action.interactive_menu', { field: 'choice', options: [{ optionId: 'a', title: 'A' }] })],
      'choice',
    ).map((o) => o.value)
    expect(values).toEqual(['A', 'restart', 'livechat', 'default'])
  })

  it('offers the fixed vocabularies the worker writes into status fields', () => {
    expect(collectFieldValueOptions([], 'capture_status').map((o) => o.value)).toEqual(['captured', 'pending', 'error'])
    expect(collectFieldValueOptions([], 'booking_status').map((o) => o.value)).toEqual(['created', 'rescheduled'])
    expect(collectFieldValueOptions([], 'voice_booking_confidence').map((o) => o.value)).toEqual(['high', 'medium', 'low'])
    expect(collectFieldValueOptions([], 'needs_review').map((o) => o.value)).toEqual(['true', 'false'])
  })

  it('returns nothing for free-text fields so the panel keeps a plain input', () => {
    expect(collectFieldValueOptions([node('a', 'action', 'action.ask_capture', { field: 'preferred_date' })], 'preferred_date')).toEqual([])
    expect(collectFieldValueOptions([], 'message')).toEqual([])
  })

  it('the guided_whatsapp_booking template menu fields expose their option titles', () => {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === 'guided_whatsapp_booking')
    expect(template).toBeDefined()
    if (!template) return
    const menuNode = template.nodes.find(
      (n) => n.type === 'action.interactive_menu' && String(n.config?.['field'] ?? '').trim(),
    )
    expect(menuNode).toBeDefined()
    if (!menuNode) return
    const field = String(menuNode.config?.['field'] ?? '')
    const values = collectFieldValueOptions(template.nodes, field).map((o) => o.value)
    expect(values.length).toBeGreaterThan(3) // at least one option title + reserved handles
    expect(values).toContain('default')
  })
})

describe('slugifyOptionId / uniqueOptionId (no-code doctor picker)', () => {
  it('turns a doctor name into a readable branch-handle slug', () => {
    expect(slugifyOptionId('Dr. García')).toBe('dr_garcia')
    expect(slugifyOptionId('Dr. López')).toBe('dr_lopez')
    expect(slugifyOptionId('Specialized service')).toBe('specialized_service')
  })

  it('strips accents so slugs stay plain ASCII', () => {
    expect(slugifyOptionId('Dra. Nuñez Peña')).toBe('dra_nunez_pena')
  })

  it('falls back to a placeholder for names with no usable characters', () => {
    expect(slugifyOptionId('…')).toBe('option')
    expect(slugifyOptionId('')).toBe('option')
  })

  it('uniqueOptionId keeps the base when free and suffixes on collision', () => {
    expect(uniqueOptionId('dr_garcia', ['dr_lopez'])).toBe('dr_garcia')
    expect(uniqueOptionId('dr_garcia', ['dr_garcia'])).toBe('dr_garcia_2')
    expect(uniqueOptionId('dr_garcia', ['dr_garcia', 'dr_garcia_2'])).toBe('dr_garcia_3')
  })

  it('the template doctor-menu ids are exactly the slugs of their titles', () => {
    // This invariant is what lets the canvas match an existing option back to
    // the doctor it was filled from (slugifyOptionId(doctor.name) === optionId).
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === 'guided_whatsapp_booking')
    expect(template).toBeDefined()
    if (!template) return
    const doctorMenu = template.nodes.find((n) => n.id === 'doctor_menu')
    expect(doctorMenu).toBeDefined()
    if (!doctorMenu) return
    const options = JSON.parse(String(doctorMenu.config?.['options'])) as { optionId: string; title: string }[]
    for (const opt of options) expect(opt.optionId).toBe(slugifyOptionId(opt.title))
  })
})

describe('branchRows (interactive_menu reserved handles)', () => {
  it('synthesizes fallback rows for restart/livechat/default when none is a real option', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', { options: JSON.stringify([{ optionId: 'yes', title: 'Yes' }]) })
    const rows = branchRows(menu)
    expect(rows.map((r) => r.key)).toEqual(['yes', 'restart', 'livechat', 'default'])
    // Synthesized fallback rows carry no label -- callers fall back to the fixed i18n branch label.
    expect(rows.find((r) => r.key === 'restart')?.label).toBeUndefined()
  })

  it('uses the configured title once a reserved handle is added as a real option', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', {
      options: JSON.stringify([
        { optionId: 'yes', title: 'Yes' },
        { optionId: 'restart', title: 'Start over' },
      ]),
    })
    const rows = branchRows(menu)
    // 'restart' now comes from the options list itself -- not duplicated, and
    // its label is the admin's own text instead of the fixed i18n default.
    expect(rows.filter((r) => r.key === 'restart')).toHaveLength(1)
    expect(rows.find((r) => r.key === 'restart')?.label).toBe('Start over')
    expect(rows.map((r) => r.key)).toEqual(['yes', 'restart', 'livechat', 'default'])
  })

  it('a reserved handle configured as a real option is still exactly one row when ALL three are configured', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', {
      options: JSON.stringify([
        { optionId: 'restart', title: 'Start over' },
        { optionId: 'livechat', title: 'Talk to a person' },
        { optionId: 'default', title: 'Something else' },
      ]),
    })
    const rows = branchRows(menu)
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.label)).toEqual(['Start over', 'Talk to a person', 'Something else'])
  })
})

describe('validateWorkflowDefinition + reserved options as real buttons', () => {
  // Interactive-menu structural checks (option count vs. variant, duplicate/
  // unwired handles) only run under requireTrigger: true -- draft canvases are
  // allowed to be incomplete (see the function's own doc comment); these tests
  // exercise the "ready to activate" path, matching the pre-existing
  // guided_whatsapp_booking template test above.
  const trigger = node('t', 'trigger', 'trigger.message_keyword', { keywords: 'menu' })

  it('accepts a button-variant menu with the reserved option filling the third slot', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', {
      variant: 'button',
      options: JSON.stringify([
        { optionId: 'a', title: 'A' },
        { optionId: 'b', title: 'B' },
        { optionId: 'default', title: 'Other' },
      ]),
    })
    const edges = [
      { id: 'e0', source: 't', target: 'menu' },
      { id: 'e1', source: 'menu', target: 't', sourceHandle: 'a' },
      { id: 'e2', source: 'menu', target: 't', sourceHandle: 'b' },
      { id: 'e3', source: 'menu', target: 't', sourceHandle: 'default' },
    ]
    expect(validateWorkflowDefinition([trigger, menu], edges, { requireTrigger: true })).toEqual([])
  })

  it('rejects a button-variant menu once real options + a visible reserved one exceed the 3-button cap', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', {
      variant: 'button',
      options: JSON.stringify([
        { optionId: 'a', title: 'A' },
        { optionId: 'b', title: 'B' },
        { optionId: 'c', title: 'C' },
        { optionId: 'default', title: 'Other' },
      ]),
    })
    const edges = [
      { id: 'e0', source: 't', target: 'menu' },
      { id: 'e1', source: 'menu', target: 't', sourceHandle: 'a' },
      { id: 'e2', source: 'menu', target: 't', sourceHandle: 'b' },
      { id: 'e3', source: 'menu', target: 't', sourceHandle: 'c' },
      { id: 'e4', source: 'menu', target: 't', sourceHandle: 'default' },
    ]
    const errors = validateWorkflowDefinition([trigger, menu], edges, { requireTrigger: true })
    expect(errors.some((e) => e.includes('too many options'))).toBe(true)
  })

  it('still requires a successor edge for a reserved option once it is a real, visible button', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', {
      variant: 'button',
      options: JSON.stringify([
        { optionId: 'a', title: 'A' },
        { optionId: 'restart', title: 'Start over' },
      ]),
    })
    const errors = validateWorkflowDefinition(
      [trigger, menu],
      [
        { id: 'e0', source: 't', target: 'menu' },
        { id: 'e1', source: 'menu', target: 't', sourceHandle: 'a' },
      ],
      { requireTrigger: true },
    )
    expect(errors.some((e) => e.includes('option "restart" has no successor'))).toBe(true)
  })
})
