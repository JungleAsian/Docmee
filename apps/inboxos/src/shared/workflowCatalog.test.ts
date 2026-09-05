import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '@docmee/agents'
import { WORKFLOW_NODE_TYPES, collectWorkflowFields, collectWorkflowTags, collectFieldValueOptions, slugifyOptionId, uniqueOptionId, ENUM_FIELD_OPTIONS, ALLOWED_BOOKING_FIELDS, branchRows, parseBranchColors, resolveBranchColor, changeableNodeTypes, nodeHasStructuredData, changeNodeType, parseBulkMenuOptionLines, nodeHasIssue, type MenuOption } from './workflowNodes'
import { isBranchingNode, resequenceLinearEdges } from './workflowLinearEdges'
import { TAG_TYPES } from './tagTypes'
import { WORKFLOW_TEMPLATES, personalizeWorkflowTemplate } from './workflowTemplates'
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

  it.each([
    ['booking_single_doctor_ai', false],
    ['booking_multiple_doctors_ai', true],
  ] as const)('validates %s and uses the approved live booking capabilities', (key, expectsDoctorMenu) => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.key === key)
    expect(template).toBeDefined()
    if (!template) return

    expect(validateWorkflowDefinition(template.nodes, template.edges, { requireTrigger: true })).toEqual([])
    const doctorMenus = template.nodes.filter(
      (item) => item.type === 'action.interactive_menu' && item.config?.optionSource === 'clinic_doctors',
    )
    expect(doctorMenus.length > 0).toBe(expectsDoctorMenu)
    expect(template.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'action.interactive_menu', config: expect.objectContaining({ optionSource: 'doctor_services', field: 'service_id' }) }),
      expect.objectContaining({ type: 'action.check_availability', config: expect.objectContaining({ days: '5' }) }),
      expect.objectContaining({ type: 'action.offer_slot_menu', config: expect.objectContaining({ pickerMode: 'date' }) }),
      expect.objectContaining({ type: 'action.offer_slot_menu', config: expect.objectContaining({ pickerMode: 'time' }) }),
      expect.objectContaining({ type: 'action.ai_agent' }),
      expect.objectContaining({ type: 'action.handoff_to_secretary' }),
      expect.objectContaining({ type: 'action.create_or_reschedule_booking', config: expect.objectContaining({ doctorIdField: 'doctor_id', serviceIdField: 'service_id' }) }),
    ]))
    expect(template.nodes).toContainEqual(expect.objectContaining({ id: 'post_inquiry_menu', type: 'action.interactive_menu' }))
    expect(template.edges).toContainEqual(expect.objectContaining({ source: 'ai_inquiry', target: 'post_inquiry_menu', sourceHandle: 'replied' }))
  })

  it('validates the safe appointment assistant template as a no-code end-to-end workflow', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.key === 'safe_appointment_assistant')
    expect(template).toBeDefined()
    if (!template) return

    expect(validateWorkflowDefinition(template.nodes, template.edges, { requireTrigger: true })).toEqual([])

    const byId = new Map(template.nodes.map((item) => [item.id, item]))
    expect(byId.get('main_menu')).toMatchObject({
      type: 'action.interactive_menu',
      config: expect.objectContaining({ variant: 'list' }),
    })
    expect(JSON.parse(String(byId.get('main_menu')?.config.options))).toEqual([
      { optionId: 'clinic_hours', title: 'Clinic Hours' },
      { optionId: 'book_appointment', title: 'Book Appointment' },
      { optionId: 'secretary', title: 'Secretary' },
      { optionId: 'ai', title: 'AI' },
      { optionId: 'end_chat', title: 'End chat' },
    ])

    expect(byId.get('clinic_hours_menu')).toMatchObject({
      type: 'action.interactive_menu',
      config: expect.objectContaining({
        header: 'Clinic Hours',
        message: expect.stringContaining('{{clinic_address}}'),
      }),
    })
    expect(byId.get('secretary_menu')).toMatchObject({
      type: 'action.interactive_menu',
      config: expect.objectContaining({
        message: expect.stringContaining('secretary has been notified'),
      }),
    })
    expect(byId.get('language_menu')).toMatchObject({
      type: 'action.interactive_menu',
      config: expect.objectContaining({
        message: expect.stringContaining('English or Spanish'),
      }),
    })

    expect(template.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'main_menu', target: 'clinic_hours_menu', sourceHandle: 'clinic_hours' }),
      expect.objectContaining({ source: 'main_menu', target: 'service_menu', sourceHandle: 'book_appointment' }),
      expect.objectContaining({ source: 'main_menu', target: 'notify_secretary', sourceHandle: 'secretary' }),
      expect.objectContaining({ source: 'main_menu', target: 'language_menu', sourceHandle: 'ai' }),
      expect.objectContaining({ source: 'main_menu', target: 'end_message', sourceHandle: 'end_chat' }),
      expect.objectContaining({ source: 'service_menu', target: 'check_dates', sourceHandle: 'selected' }),
      expect.objectContaining({ source: 'check_dates', target: 'date_menu' }),
      expect.objectContaining({ source: 'date_menu', target: 'check_times', sourceHandle: 'selected' }),
      expect.objectContaining({ source: 'check_times', target: 'time_menu' }),
      expect.objectContaining({ source: 'time_menu', target: 'revalidate_slot', sourceHandle: 'selected' }),
      expect.objectContaining({ source: 'revalidate_slot', target: 'confirm_menu' }),
      expect.objectContaining({ source: 'confirm_menu', target: 'create_booking', sourceHandle: 'confirm' }),
      expect.objectContaining({ source: 'confirm_menu', target: 'date_menu', sourceHandle: 'change' }),
      expect.objectContaining({ source: 'confirm_menu', target: 'notify_secretary', sourceHandle: 'secretary' }),
      expect.objectContaining({ source: 'create_booking', target: 'booking_success' }),
      expect.objectContaining({ source: 'booking_success', target: 'end' }),
      expect.objectContaining({ source: 'language_menu', target: 'ask_ai_question', sourceHandle: 'english' }),
      expect.objectContaining({ source: 'language_menu', target: 'ask_ai_question', sourceHandle: 'spanish' }),
      expect.objectContaining({ source: 'ai_agent', target: 'ask_ai_question', sourceHandle: 'replied' }),
      expect.objectContaining({ source: 'ai_agent', target: 'notify_secretary', sourceHandle: 'handoff' }),
      expect.objectContaining({ source: 'ai_agent', target: 'main_menu', sourceHandle: 'no_match' }),
      expect.objectContaining({ source: 'ai_agent', target: 'notify_secretary', sourceHandle: 'error' }),
    ]))

    expect(byId.get('revalidate_slot')).toMatchObject({
      type: 'action.check_availability',
      config: expect.objectContaining({ days: '1', dateField: 'preferred_date' }),
    })
    expect(byId.get('create_booking')).toMatchObject({
      type: 'action.create_or_reschedule_booking',
      config: expect.objectContaining({
        mode: 'create',
        doctorIdField: 'doctor_id',
        serviceIdField: 'service_id',
        dateField: 'preferred_date',
        timeField: 'preferred_time',
      }),
    })
    expect(byId.get('booking_success')?.config.text).toContain('confirmed on our side')
  })

  it('personalizes the safe appointment assistant clinic-hours copy from clinic settings', () => {
    const template = WORKFLOW_TEMPLATES.find((item) => item.key === 'safe_appointment_assistant')
    expect(template).toBeDefined()
    if (!template) return

    const nodes = personalizeWorkflowTemplate(template, {
      name: 'Derma Paz',
      address: '20 Avenida 1-16 Zona 3',
      phone: '46082715',
      settings: {
        businessHours: {
          monday: { open: '09:00', close: '22:00' },
          saturday: { open: '09:00', close: '22:00' },
          sunday: { open: '11:00', close: '17:00' },
        },
      },
    })

    const hours = nodes.find((item) => item.id === 'clinic_hours_menu')
    expect(hours?.config.message).toContain('Derma Paz is located at 20 Avenida 1-16 Zona 3.')
    expect(hours?.config.message).toContain('Monday: 9:00 AM–10:00 PM')
    expect(hours?.config.message).toContain('Saturday: 9:00 AM–10:00 PM')
    expect(hours?.config.message).toContain('Sunday: 11:00 AM–5:00 PM')
    expect(hours?.config.message).toContain('Phone: 46082715.')
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

  it('offers the runtime-backed interactive menu option sources', () => {
    expect(ENUM_FIELD_OPTIONS.optionSource?.map((option) => option.value)).toEqual([
      'static',
      'clinic_doctors',
      'doctor_services',
    ])
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

  it('offers exactly the delay units workflow-engine.ts understands, worker default first', () => {
    expect(ENUM_FIELD_OPTIONS.unit?.map((o) => o.value)).toEqual(['hour', 'minute', 'day'])
  })

  it('offers exactly the booking modes workflow-runner.worker.ts understands, worker default first', () => {
    expect(ENUM_FIELD_OPTIONS.mode?.map((o) => o.value)).toEqual(['create', 'reschedule'])
  })

  it('offers exactly the AI providers voice-booking.ts understands, worker fallback first', () => {
    expect(ENUM_FIELD_OPTIONS.provider?.map((o) => o.value)).toEqual(['claude', 'openai', 'gemini', 'custom'])
  })
})

describe('ALLOWED_BOOKING_FIELDS (must stay in lockstep with voice-booking.ts)', () => {
  it('matches DEFAULT_ALLOWED_FIELDS exactly', () => {
    expect(ALLOWED_BOOKING_FIELDS).toEqual([
      'patient_name',
      'phone_number',
      'preferred_date',
      'preferred_time',
      'clinic_location',
      'doctor_preference',
    ])
  })
})

describe('in-place node type changing', () => {
  it('changeableNodeTypes offers only same-kind types, excluding the current one', () => {
    const menu = node('m', 'action', 'action.interactive_menu')
    const types = changeableNodeTypes(menu).map((d) => d.type)
    expect(types).not.toContain('action.interactive_menu')
    expect(types).toContain('action.send_message')
    expect(types.every((t) => WORKFLOW_NODE_TYPES.find((d) => d.type === t)?.kind === 'action')).toBe(true)
  })

  it('changeableNodeTypes never offers a different kind (trigger cannot become an action)', () => {
    const trigger = node('t', 'trigger', 'trigger.message_keyword')
    const types = changeableNodeTypes(trigger).map((d) => d.type)
    expect(types).toEqual(['trigger.patient_upset'])
  })

  it('changeableNodeTypes returns nothing for an unknown type', () => {
    expect(changeableNodeTypes(node('x', 'action', 'action.does_not_exist'))).toEqual([])
  })

  it('nodeHasStructuredData is true when options/scenarios/branchColors are populated, false otherwise', () => {
    const emptyMenu = node('m1', 'action', 'action.interactive_menu', { options: '[]' })
    const populatedMenu = node('m2', 'action', 'action.interactive_menu', { options: '[{"optionId":"a","title":"A"}]' })
    const agent = node('a', 'action', 'action.ai_agent', { scenarios: '[{"id":"s1"}]' })
    expect(nodeHasStructuredData(emptyMenu)).toBe(false)
    expect(nodeHasStructuredData(populatedMenu)).toBe(true)
    expect(nodeHasStructuredData(agent)).toBe(true)
    expect(nodeHasStructuredData(node('s', 'action', 'action.send_message', { text: 'hi' }))).toBe(false)
  })

  it('changeNodeType keeps the id, sets the new type, and always drops structured-data keys', () => {
    const menu = node('m', 'action', 'action.interactive_menu', {
      options: '[{"optionId":"a","title":"A"}]',
      message: 'Pick one',
    })
    const next = changeNodeType(menu, 'action.send_message')
    expect(next.id).toBe('m')
    expect(next.type).toBe('action.send_message')
    expect(next.config['options']).toBeUndefined()
    // 'message' is not in action.send_message's own field list (it uses 'text'),
    // so it is correctly dropped too — only keys present in BOTH field lists survive.
    expect(next.config['message']).toBeUndefined()
  })

  it('changeNodeType carries over a config key present in both the old and new type\'s fields', () => {
    // Both logic.ai_classify_intent and action.ai_draft declare a 'prompt' field.
    const classify = node('c', 'logic', 'logic.ai_classify_intent', { prompt: 'Is this urgent?' })
    const next = changeNodeType(classify, 'action.ai_draft')
    expect(next.config['prompt']).toBe('Is this urgent?')
  })
})

describe('node catalog icons (regression guard for WorkflowNodeIcon.tsx\'s lookup table)', () => {
  // Kept in sync manually with the ICONS map in components/WorkflowNodeIcon.tsx
  // (that file is JSX and can't be imported from this plain vitest file).
  const KNOWN_ICON_KEYS = new Set([
    'keyword', 'alert', 'branch', 'clock', 'hourglass', 'brain', 'message', 'file',
    'bell', 'tag', 'sparkle', 'list', 'check', 'question', 'extract', 'calendarCheck',
    'calendar', 'calendarMenu', 'calendarPlus', 'voice', 'robot', 'end',
  ])

  it('every node type declares a non-empty icon key', () => {
    for (const def of WORKFLOW_NODE_TYPES) {
      expect(def.icon, `${def.type} is missing an icon key`).toBeTruthy()
    }
  })

  it('every declared icon key resolves in WorkflowNodeIcon.tsx\'s lookup table', () => {
    for (const def of WORKFLOW_NODE_TYPES) {
      expect(KNOWN_ICON_KEYS.has(def.icon), `${def.type}'s icon "${def.icon}" has no entry in WorkflowNodeIcon.tsx`).toBe(true)
    }
  })
})

describe('nodeHasIssue (cheap node-local validation hint)', () => {
  it('flags an interactive_menu with no options', () => {
    expect(nodeHasIssue(node('m', 'action', 'action.interactive_menu', { options: '[]' }))).toBe('wf.issue.menuNoOptions')
  })

  it('does not flag an interactive_menu with at least one option', () => {
    expect(nodeHasIssue(node('m', 'action', 'action.interactive_menu', { options: '[{"optionId":"a","title":"A"}]' }))).toBeUndefined()
  })

  it('does not require authored options for a dynamic interactive menu', () => {
    expect(nodeHasIssue(node('m', 'action', 'action.interactive_menu', { optionSource: 'clinic_doctors' }))).toBeUndefined()
  })

  it('flags an offer_slot_menu with an invalid pickerMode', () => {
    expect(nodeHasIssue(node('s', 'action', 'action.offer_slot_menu', { pickerMode: 'weekday' }))).toBe('wf.issue.slotMenuBadMode')
  })

  it('does not flag an offer_slot_menu with no pickerMode set (defaults to date)', () => {
    expect(nodeHasIssue(node('s', 'action', 'action.offer_slot_menu', {}))).toBeUndefined()
  })

  it('flags an ai_agent with no scenarios', () => {
    expect(nodeHasIssue(node('a', 'action', 'action.ai_agent', {}))).toBe('wf.issue.aiAgentNoScenarios')
  })

  it('does not flag node types the helper does not cover', () => {
    expect(nodeHasIssue(node('s', 'action', 'action.send_message', {}))).toBeUndefined()
  })
})

describe('parseBulkMenuOptionLines', () => {
  it('parses "Title" and "Title | Description" lines', () => {
    const result = parseBulkMenuOptionLines('Horas\nAgendar cita | Reserva con un doctor', [])
    expect(result).toEqual([
      { optionId: 'horas', title: 'Horas' },
      { optionId: 'agendar_cita', title: 'Agendar cita', description: 'Reserva con un doctor' },
    ])
  })

  it('skips blank lines and lines with an empty title', () => {
    const result = parseBulkMenuOptionLines('Horas\n\n   \n| no title here\nAgendar', [])
    expect(result.map((o) => o.title)).toEqual(['Horas', 'Agendar'])
  })

  it('de-duplicates optionIds against existing options', () => {
    const existing: MenuOption[] = [{ optionId: 'horas', title: 'Horas (old)' }]
    const result = parseBulkMenuOptionLines('Horas', existing)
    expect(result).toEqual([{ optionId: 'horas_2', title: 'Horas' }])
  })

  it('de-duplicates optionIds against each other within the same paste', () => {
    const result = parseBulkMenuOptionLines('Horas\nHoras\nHoras', [])
    expect(result.map((o) => o.optionId)).toEqual(['horas', 'horas_2', 'horas_3'])
  })

  it('a title containing a literal "|" character after the first split keeps the rest as description text', () => {
    const result = parseBulkMenuOptionLines('Precios | $10 | $20', [])
    expect(result).toEqual([{ optionId: 'precios', title: 'Precios', description: '$10 | $20' }])
  })

  it('returns an empty array for empty/whitespace-only input', () => {
    expect(parseBulkMenuOptionLines('', [])).toEqual([])
    expect(parseBulkMenuOptionLines('   \n  \n', [])).toEqual([])
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

describe('branchRows (action.offer_slot_menu)', () => {
  // Regression: this node type requires 'selected'/'empty' successors per
  // workflow-validator.ts, but was missing from branchRows() entirely, so it
  // was silently indistinguishable from a plain linear node to any
  // branchRows()-driven consumer -- letting a linear-only editor auto-wipe
  // its real handle-labeled edges down to one generic unlabeled edge.
  it('exposes exactly the four handles workflow-validator.ts requires/allows', () => {
    const slotMenu = node('date_menu', 'action', 'action.offer_slot_menu', { pickerMode: 'date' })
    expect(branchRows(slotMenu).map((r) => r.key)).toEqual(['selected', 'empty', 'restart', 'livechat'])
  })

  it('is recognized as a branching node (not auto-chained as linear)', () => {
    const slotMenu = node('date_menu', 'action', 'action.offer_slot_menu', { pickerMode: 'date' })
    expect(isBranchingNode(slotMenu)).toBe(true)
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
      { id: 'e3', source: 'menu', target: 'end', sourceHandle: 'default' },
    ]
    const end = node('end', 'action', 'action.end')
    const validEdges = edges.map((edge) => edge.source === 'menu' ? { ...edge, target: 'end' } : edge)
    expect(validateWorkflowDefinition([trigger, menu, end], validEdges, { requireTrigger: true })).toEqual([])
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
    expect(errors.some((e) => e.includes('more than WhatsApp allows'))).toBe(true)
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
    expect(errors.some((e) => e.includes('option "restart" isn\'t connected to anything'))).toBe(true)
  })
})

describe('parseBranchColors / resolveBranchColor (routing-line colors)', () => {
  it('parses a well-formed JSON color map', () => {
    expect(parseBranchColors(JSON.stringify({ true: '#123456' }))).toEqual({ true: '#123456' })
  })

  it('treats missing, blank, or malformed input as no overrides', () => {
    expect(parseBranchColors(undefined)).toEqual({})
    expect(parseBranchColors('')).toEqual({})
    expect(parseBranchColors('not json')).toEqual({})
    expect(parseBranchColors('[1,2,3]')).toEqual({})
  })

  it('drops non-string values from an otherwise-valid map', () => {
    expect(parseBranchColors(JSON.stringify({ true: '#123456', false: 42 }))).toEqual({ true: '#123456' })
  })

  it('falls back to the tone-based default color when nothing is configured', () => {
    const cond = node('cond', 'logic', 'logic.condition')
    expect(resolveBranchColor(cond, 'true')).toBe('#10b981')
    expect(resolveBranchColor(cond, 'false')).toBe('#ef4444')
  })

  it("uses the admin's own override once one is set", () => {
    const cond = node('cond', 'logic', 'logic.condition', { branchColors: JSON.stringify({ true: '#ff00ff' }) })
    expect(resolveBranchColor(cond, 'true')).toBe('#ff00ff')
    // The untouched branch still falls back to its own tone default.
    expect(resolveBranchColor(cond, 'false')).toBe('#ef4444')
  })

  it('resolves a color for every interactive_menu row, real or synthesized fallback', () => {
    const menu = node('menu', 'action', 'action.interactive_menu', { options: JSON.stringify([{ optionId: 'a', title: 'A' }]) })
    expect(resolveBranchColor(menu, 'a')).toBe('#14b8a6')
    // 'restart' is an unconfigured synthesized fallback row (tone: slate).
    expect(resolveBranchColor(menu, 'restart')).toBe('#94a3b8')
  })

  it('falls back to a neutral gray for a stale handle matching no current row', () => {
    const cond = node('cond', 'logic', 'logic.condition')
    expect(resolveBranchColor(cond, 'not_a_real_handle')).toBe('#94a3b8')
  })
})

describe('validateWorkflowDefinition + action.offer_slot_menu (regression)', () => {
  // Reproduces the exact production error report: "Slot menu edge ... uses an
  // unknown handle """ + "Slot menu date_menu requires a 'selected' successor" --
  // caused by the Guided editor's resequenceLinearEdges treating an
  // unrecognized-by-branchRows() offer_slot_menu node as linear and collapsing
  // its real edges down to one auto-chained, unlabeled edge.
  const trigger = node('t', 'trigger', 'trigger.message_keyword', { keywords: 'book' })

  it('a properly wired slot menu (selected + empty) passes validation', () => {
    const dateMenu = node('date_menu', 'action', 'action.offer_slot_menu', { pickerMode: 'date' })
    const confirmMenu = node('confirm_menu', 'action', 'action.send_message', { text: 'Confirmed' })
    const end = node('end', 'action', 'action.end')
    const edges = [
      { id: 'e0', source: 't', target: 'date_menu' },
      { id: 'e1', source: 'date_menu', target: 'confirm_menu', sourceHandle: 'selected' },
      { id: 'e2', source: 'date_menu', target: 'end', sourceHandle: 'empty' },
      { id: 'e3', source: 'confirm_menu', target: 'end' },
    ]
    expect(validateWorkflowDefinition([trigger, dateMenu, confirmMenu, end], edges, { requireTrigger: true })).toEqual([])
  })

  it('reproduces the reported errors for an unlabeled auto-chained edge', () => {
    const dateMenu = node('date_menu', 'action', 'action.offer_slot_menu', { pickerMode: 'date' })
    const confirmMenu = node('confirm_menu', 'action', 'action.send_message', { text: 'Confirmed' })
    // No sourceHandle at all -- what resequenceLinearEdges used to produce
    // for this node type before the branchRows() fix.
    const edges = [
      { id: 'e0', source: 't', target: 'date_menu' },
      { id: 'e_date_menu_confirm_menu_default_42', source: 'date_menu', target: 'confirm_menu' },
    ]
    const errors = validateWorkflowDefinition([trigger, dateMenu, confirmMenu], edges, { requireTrigger: true })
    expect(errors.join('\n')).toMatch(
      /Slot menu edge e_date_menu_confirm_menu_default_42 is connected to a branch "" that node date_menu doesn't produce/,
    )
    expect(errors.join('\n')).toMatch(/Slot menu date_menu has no "selected" branch connected/)
  })

  it('resequenceLinearEdges no longer touches (or collapses) a slot menu\'s own edges', () => {
    const dateMenu = node('date_menu', 'action', 'action.offer_slot_menu', { pickerMode: 'date' })
    const confirmMenu = node('confirm_menu', 'action', 'action.send_message', { text: 'Confirmed' })
    const handWired = [
      { id: 'e0', source: 't', target: 'date_menu' },
      { id: 'e1', source: 'date_menu', target: 'confirm_menu', sourceHandle: 'selected' },
      { id: 'e2', source: 'date_menu', target: 't', sourceHandle: 'empty' },
    ]
    const steps = [trigger, dateMenu, confirmMenu]
    const resequenced = resequenceLinearEdges(steps, handWired)
    expect(resequenced).toContainEqual({ id: 'e1', source: 'date_menu', target: 'confirm_menu', sourceHandle: 'selected' })
    expect(resequenced).toContainEqual({ id: 'e2', source: 'date_menu', target: 't', sourceHandle: 'empty' })
  })
})

// --- Sustainable guard against the WHOLE CLASS of bug behind the offer_slot_menu
// regression -----------------------------------------------------------------
//
// The root cause wasn't a one-off typo: workflow-validator.ts (packages/agents,
// a different package) hardcodes which handles each branching node type
// requires/allows, entirely independently of branchRows() here (apps/inboxos).
// Nothing forced the two to agree, so adding a validator requirement (or a new
// branching node type) without also updating branchRows() fails silently in
// dev/typecheck/lint -- it only surfaces as a data-corrupting runtime bug once
// an admin actually edits that node type in Studio.
//
// Rather than hand-copy the validator's rules into a second list here (which
// could itself drift from the validator exactly like branchRows() already
// did), this test runs the REAL validator: for every node type in the
// catalog, wire up a minimal workflow using EXACTLY the handles branchRows()
// reports for it (or one generic unlabeled edge if it reports none, mirroring
// exactly what the Guided editor's resequenceLinearEdges does for a node it
// doesn't recognize as branching), then assert the validator raises no
// handle-shape complaint for that node. Deliberately does NOT import
// anything new from @docmee/agents beyond the existing test-only
// validateWorkflowDefinition import -- apps/inboxos stays runtime-dependency-
// free of that package, per this file's and workflowNodes.ts's existing
// convention (see the "dependency-free" comments there).
describe('branchRows() stays in lockstep with the real validator (regression guard)', () => {
  // Substrings covering every way workflow-validator.ts currently complains
  // about an edge/handle shape being wrong for a node, across all five
  // branching node types (condition, ai_classify_intent, interactive_menu,
  // offer_slot_menu, ai_agent). Deliberately broad: a handle-shaped problem on
  // any node type, present or future, matches without needing a per-type
  // regex. NOT matched: unrelated content warnings (e.g. an invalid
  // pickerMode, a missing AI Agent scenario) -- this guard is scoped to edge
  // wiring, the exact dimension that broke.
  const HANDLE_ERROR_PATTERNS = [
    /\(unknown handle/,
    /requires .* successor/,
    /\(ambiguous |unlabeled or ambiguous branch\)/,
    /must use the true or false handle/,
    /must have exactly one successor/,
    /cannot have outgoing edges/,
  ]

  for (const def of WORKFLOW_NODE_TYPES) {
    if (def.kind === 'trigger') continue // triggers have no outgoing branch handles to validate

    it(`${def.type}: wiring exactly what branchRows() reports satisfies the validator`, () => {
      const trigger = node('t', 'trigger', 'trigger.message_keyword', { keywords: 'x' })
      const subject = node('subject', def.kind, def.type, {})
      const target = node('target', 'action', 'action.send_message', { text: 'ok' })
      const end = node('end', 'action', 'action.end')
      const rows = branchRows(subject)

      const outgoing =
        def.type === 'action.end'
          ? [] // the only node type required to have ZERO outgoing edges
          : rows.length > 0
            ? rows.map((r, i) => ({ id: `e_out_${i}`, source: 'subject', target: 'target', sourceHandle: r.key }))
            : [{ id: 'e_out_0', source: 'subject', target: 'target' }]

      const nodes = [trigger, subject, target, end]
      const edges = [{ id: 'e_in', source: 't', target: 'subject' }, ...outgoing, { id: 'e_end', source: 'target', target: 'end' }]

      const errors = validateWorkflowDefinition(nodes, edges, { requireTrigger: true })
      // trigger/target/end are all minimal-but-valid, so any handle-shape
      // error here can only be about `subject` or its own outgoing edges.
      const handleErrors = errors.filter((e) => HANDLE_ERROR_PATTERNS.some((p) => p.test(e)))
      expect(handleErrors).toEqual([])
    })
  }
})
