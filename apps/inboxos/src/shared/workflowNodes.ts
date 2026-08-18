// Rev 3 - the catalog of node types the workflow canvas + (later) the engine share.
// Each node has a kind (trigger/logic/action), an i18n label, a short i18n
// description for the palette, and the config keys the side panel renders as
// editable fields.
import type { WorkflowNode, WorkflowNodeKind } from './types'

export interface NodeTypeDef {
  type: string
  kind: WorkflowNodeKind
  labelKey: string
  /** one-line "what it does" shown under the label in the palette. */
  descKey: string
  /** config keys the editor exposes (rendered as text inputs, key = label). */
  fields: string[]
  /** Semantic icon key, resolved to an actual Phosphor icon component by
   *  WorkflowNodeIcon.tsx (kept as a string here, not a component, so this
   *  file stays JSX-free and importable from pure vitest tests). */
  icon: string
}

export const WORKFLOW_NODE_TYPES: NodeTypeDef[] = [
  // Triggers - what starts the workflow (exactly one per workflow).
  // Only list events which the worker currently produces. Do not let a clinic
  // activate a workflow that would remain inert.
  { type: 'trigger.message_keyword', kind: 'trigger', labelKey: 'wf.node.messageKeyword', descKey: 'wf.desc.messageKeyword', fields: ['keywords'], icon: 'keyword' },
  { type: 'trigger.patient_upset', kind: 'trigger', labelKey: 'wf.node.patientUpset', descKey: 'wf.desc.patientUpset', fields: [], icon: 'alert' },
  // Logic - routing + timing.
  { type: 'logic.condition', kind: 'logic', labelKey: 'wf.node.condition', descKey: 'wf.desc.condition', fields: ['field', 'op', 'value'], icon: 'branch' },
  { type: 'logic.delay', kind: 'logic', labelKey: 'wf.node.delay', descKey: 'wf.desc.delay', fields: ['amount', 'unit'], icon: 'clock' },
  { type: 'logic.wait_for_reply', kind: 'logic', labelKey: 'wf.node.waitForReply', descKey: 'wf.desc.waitForReply', fields: ['timeoutMinutes'], icon: 'hourglass' },
  {
    type: 'logic.ai_classify_intent',
    kind: 'logic',
    labelKey: 'wf.node.aiClassifyIntent',
    descKey: 'wf.desc.aiClassifyIntent',
    fields: ['confidenceField', 'highThreshold', 'lowThreshold', 'prompt'],
    icon: 'brain',
  },
  // Actions - what the workflow does.
  { type: 'action.send_message', kind: 'action', labelKey: 'wf.node.sendMessage', descKey: 'wf.desc.sendMessage', fields: ['text'], icon: 'message' },
  { type: 'action.send_template', kind: 'action', labelKey: 'wf.node.sendTemplate', descKey: 'wf.desc.sendTemplate', fields: ['category'], icon: 'file' },
  { type: 'action.notify_secretary', kind: 'action', labelKey: 'wf.node.notify', descKey: 'wf.desc.notify', fields: [], icon: 'bell' },
  { type: 'action.add_tag', kind: 'action', labelKey: 'wf.node.addTag', descKey: 'wf.desc.addTag', fields: ['tag'], icon: 'tag' },
  { type: 'action.ai_draft', kind: 'action', labelKey: 'wf.node.aiDraft', descKey: 'wf.desc.aiDraft', fields: ['prompt', 'queryLimit', 'responseBuffer'], icon: 'sparkle' },
  {
    type: 'action.interactive_menu',
    kind: 'action',
    labelKey: 'wf.node.interactiveMenu',
    descKey: 'wf.desc.interactiveMenu',
    fields: ['variant', 'header', 'message', 'footer', 'options', 'field'],
    icon: 'list',
  },
  { type: 'action.approval', kind: 'action', labelKey: 'wf.node.approval', descKey: 'wf.desc.approval', fields: [], icon: 'check' },
  {
    type: 'action.ask_capture',
    kind: 'action',
    labelKey: 'wf.node.askCapture',
    descKey: 'wf.desc.askCapture',
    fields: ['field', 'question', 'validation', 'retryQuestion', 'maxAttempts'],
    icon: 'question',
  },
  {
    type: 'action.extract_booking_details',
    kind: 'action',
    labelKey: 'wf.node.extractBookingDetails',
    descKey: 'wf.desc.extractBookingDetails',
    fields: ['provider', 'allowedFields', 'reviewTag'],
    icon: 'extract',
  },
  {
    type: 'action.check_availability',
    kind: 'action',
    labelKey: 'wf.node.checkAvailability',
    descKey: 'wf.desc.checkAvailability',
    fields: ['doctorIdField', 'dateField', 'days', 'slotsField'],
    icon: 'calendarCheck',
  },
  {
    type: 'action.offer_slots',
    kind: 'action',
    labelKey: 'wf.node.offerSlots',
    descKey: 'wf.desc.offerSlots',
    fields: ['slotsField', 'count', 'message'],
    icon: 'calendar',
  },
  {
    type: 'action.offer_slot_menu',
    kind: 'action',
    labelKey: 'wf.node.offerSlotMenu',
    descKey: 'wf.desc.offerSlotMenu',
    fields: ['pickerMode', 'slotsField', 'dateField', 'selectField', 'pageSize', 'header', 'message', 'footer'],
    icon: 'calendarMenu',
  },
  {
    type: 'action.create_or_reschedule_booking',
    kind: 'action',
    labelKey: 'wf.node.createOrRescheduleBooking',
    descKey: 'wf.desc.createOrRescheduleBooking',
    fields: [
      'mode',
      'appointmentIdField',
      'doctorIdField',
      'serviceIdField',
      'dateField',
      'timeField',
      'durationMinutes',
      'title',
    ],
    icon: 'calendarPlus',
  },
  {
    type: 'action.transcribe_booking_voice',
    kind: 'action',
    labelKey: 'wf.node.transcribeBookingVoice',
    descKey: 'wf.desc.transcribeBookingVoice',
    fields: ['provider', 'allowedFields', 'reviewTag'],
    icon: 'voice',
  },
  {
    type: 'action.ai_agent',
    kind: 'action',
    labelKey: 'wf.node.aiAgent',
    descKey: 'wf.desc.aiAgent',
    fields: ['personality', 'customInstructions', 'communicationStyle', 'scenarios'],
    icon: 'robot',
  },
  { type: 'action.end', kind: 'action', labelKey: 'wf.node.end', descKey: 'wf.desc.end', fields: [], icon: 'end' },
]

export const nodeDef = (type: string): NodeTypeDef | undefined =>
  WORKFLOW_NODE_TYPES.find((n) => n.type === type)

// --- In-place node type changing ---------------------------------------------
// Reassigning `node.type` on an EXISTING node (keeping its id, so every edge
// pointing at it survives) instead of forcing delete-and-re-add. Restricted to
// same-kind swaps (trigger↔trigger, logic↔logic, action↔action) — a trigger
// becoming an action (or vice versa) would change the node's structural role
// in the graph (triggers sit at the root, everything else doesn't), which is
// a different operation than "this node should now behave differently."

/** Config keys whose value is tied to the OLD type's specific shape (option
 *  list, AI scenarios, per-branch colors) — always cleared on a type change,
 *  even if the new type happens to declare a field with the same key name,
 *  since the value's internal shape (JSON keyed by the old handles) would be
 *  meaningless for the new type's own handles. */
const STRUCTURED_DATA_KEYS = new Set(['options', 'scenarios', 'branchColors'])

/** Every OTHER node type the given node could switch to (same kind only). */
export function changeableNodeTypes(node: WorkflowNode): NodeTypeDef[] {
  const current = nodeDef(node.type)
  if (!current) return []
  return WORKFLOW_NODE_TYPES.filter((d) => d.kind === current.kind && d.type !== node.type)
}

/** True when the node has any structured data that a type change would
 *  discard — used to decide whether to confirm with the admin first. `options`
 *  and `scenarios` are JSON arrays (empty array = nothing configured yet, not
 *  "has data"); `branchColors` is a JSON object (empty object = same). A
 *  malformed/unparseable value is treated as "has data" — safer to confirm
 *  unnecessarily than to silently discard something real. */
export function nodeHasStructuredData(node: WorkflowNode): boolean {
  for (const key of STRUCTURED_DATA_KEYS) {
    const raw = node.config?.[key]
    if (raw === undefined) continue
    const text = String(raw).trim()
    if (!text) continue
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed) ? parsed.length > 0 : Object.keys(parsed ?? {}).length > 0) return true
    } catch {
      return true
    }
  }
  return false
}

/** Pure: returns a new node with `type` reassigned. Config keys present in
 *  BOTH the old and new type's `fields` list carry over (best-effort);
 *  everything else — including all STRUCTURED_DATA_KEYS — is dropped. */
export function changeNodeType(node: WorkflowNode, newType: string): WorkflowNode {
  const oldFields = new Set(nodeDef(node.type)?.fields ?? [])
  const newFields = new Set(nodeDef(newType)?.fields ?? [])
  const nextConfig: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.config ?? {})) {
    if (STRUCTURED_DATA_KEYS.has(key)) continue
    if (oldFields.has(key) && newFields.has(key)) nextConfig[key] = value
  }
  return { ...node, type: newType, config: nextConfig }
}

/** Canvas tone per node kind. */
export const NODE_KIND_TONE: Record<WorkflowNodeKind, string> = {
  trigger: 'border-emerald-400 dark:border-emerald-600',
  logic: 'border-amber-400 dark:border-amber-600',
  action: 'border-teal-400 dark:border-teal-600',
}

/** Badge (icon chip) colors per node kind — used by the canvas node header. */
export const NODE_KIND_BADGE: Record<WorkflowNodeKind, string> = {
  trigger: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200',
  logic: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  action: 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-200',
}

/** Selected-card ring color per node kind — so a selected card visually
 *  confirms its kind at a glance, instead of every selection looking the
 *  same regardless of what type of node it is. */
export const NODE_KIND_RING: Record<WorkflowNodeKind, string> = {
  trigger: 'ring-2 ring-emerald-300 dark:ring-emerald-700',
  logic: 'ring-2 ring-amber-300 dark:ring-amber-700',
  action: 'ring-2 ring-teal-300 dark:ring-teal-700',
}

/** Item 22 of the 25-item batch: a solid light-tint card background per node
 *  kind (light/dark aware), replacing the plain white/gray card fill so a
 *  node's kind is legible even before reading its badge or border. */
export const NODE_KIND_FILL: Record<WorkflowNodeKind, string> = {
  trigger: 'bg-emerald-50 dark:bg-emerald-950/40',
  logic: 'bg-amber-50 dark:bg-amber-950/40',
  action: 'bg-teal-50 dark:bg-teal-950/40',
}

/** Cheap, node-local subset of workflow-validator.ts's rules — fast enough to
 *  run on every render for an inline "this node has an issue" indicator.
 *  Deliberately NOT a reimplementation of the full validator (no graph
 *  traversal, no edge-wiring checks) — those stay exclusively in the
 *  save/activate error list; this is just an early, local hint. Returns an
 *  i18n key (not a message) so the caller renders it via `t()`. */
export function nodeHasIssue(node: WorkflowNode): string | undefined {
  const cfg = node.config ?? {}
  if (node.type === 'action.interactive_menu') {
    const options = parseMenuOptionsSafe(cfg.options)
    if (options.length === 0) return 'wf.issue.menuNoOptions'
  }
  if (node.type === 'action.offer_slot_menu') {
    const mode = String(cfg.pickerMode ?? 'date')
    if (mode !== 'date' && mode !== 'time') return 'wf.issue.slotMenuBadMode'
  }
  if (node.type === 'action.ai_agent') {
    const scenarios = parseAiAgentScenarioList(cfg.scenarios)
    if (scenarios.length === 0) return 'wf.issue.aiAgentNoScenarios'
  }
  return undefined
}

// --- No-code "Field" selector -------------------------------------------------
// Several node types reference a named slot in the workflow's runtime context
// (WorkflowContext, a plain string-keyed bag) rather than a literal value —
// e.g. logic.condition's `field`, or create_or_reschedule_booking's
// `doctorIdField`. Historically the admin had to spell that name correctly by
// hand, matching whatever an earlier node happened to call it. Instead, the
// config panel now offers a dropdown of every field name any node in the
// workflow could plausibly have written, computed below from what each node
// type is actually known to write (verified against workflow-engine.ts and
// workflow-runner.worker.ts).

/** Config keys whose value is a reference to a context field name. Rendered
 *  as a no-code dropdown (see FIELD_REFERENCE_KEYS usage in WorkflowCanvas). */
export const FIELD_REFERENCE_KEYS = new Set([
  'field',
  'confidenceField',
  'doctorIdField',
  'dateField',
  'slotsField',
  'serviceIdField',
  'timeField',
  'appointmentIdField',
  'selectField',
])

/** Context fields present on every run regardless of graph shape (see the
 *  WorkflowContext base interface in workflow-engine.ts). */
const BASE_WORKFLOW_FIELDS = ['message', 'patientId', 'conversationId', 'appointmentId', 'transcript']

interface FieldProducer {
  /** Field names this node type always writes under a fixed key. */
  fixed?: string[]
  /** Field names taken from one of this node's own config values (falls back
   *  to a default when that config value is unset — matching the worker's
   *  own `configField(node, key, fallback)` default). */
  fromConfig?: { key: string; fallback: string }[]
  /** A config key holding a comma-separated list of field names (e.g.
   *  extract_booking_details's `allowedFields`) — each becomes available. */
  csvFromConfig?: string
}

const FIELD_PRODUCERS: Partial<Record<string, FieldProducer>> = {
  'action.ask_capture': { fromConfig: [{ key: 'field', fallback: '' }], fixed: ['capture_status', 'capture_error'] },
  'action.interactive_menu': { fromConfig: [{ key: 'field', fallback: '' }] },
  'action.check_availability': { fromConfig: [{ key: 'slotsField', fallback: 'available_slots' }], fixed: ['availability_count'] },
  'action.offer_slots': { fixed: ['offered_slots'] },
  // pickerMode ('date'|'time') decides whether selectField defaults to
  // preferred_date or preferred_time; offering both keeps the no-code
  // dropdown correct either way.
  'action.offer_slot_menu': { fromConfig: [{ key: 'selectField', fallback: '' }], fixed: ['preferred_date', 'preferred_time'] },
  'action.create_or_reschedule_booking': { fixed: ['appointment_id', 'booking_status'] },
  'action.extract_booking_details': {
    csvFromConfig: 'allowedFields',
    fixed: ['needs_review', 'contains_disallowed_medical_content', 'voice_booking_confidence', 'booking_confidence', 'voice_booking_source'],
  },
  'action.transcribe_booking_voice': {
    csvFromConfig: 'allowedFields',
    fixed: ['needs_review', 'contains_disallowed_medical_content', 'voice_booking_confidence', 'booking_confidence', 'voice_booking_source'],
  },
  'logic.ai_classify_intent': { fromConfig: [{ key: 'confidenceField', fallback: 'booking_confidence' }], fixed: ['classification_confidence'] },
  'action.ai_agent': { fixed: ['ai_agent_matched_scenario', 'ai_agent_action', 'ai_agent_kb_hit'] },
}

/**
 * Every context field name any node in this workflow could plausibly have
 * written, for the "Field" no-code selector. Deliberately not reachability-
 * or order-aware (it scans every node, not just ones upstream of the one
 * being configured) — flows are usually built out of order, and an admin
 * wiring node 2 before node 5 should still see node 5's fields once it
 * exists. Sorted alphabetically; deduped.
 */
export function collectWorkflowFields(nodes: WorkflowNode[]): string[] {
  const fields = new Set(BASE_WORKFLOW_FIELDS)
  for (const node of nodes) {
    const producer = FIELD_PRODUCERS[node.type]
    if (!producer) continue
    for (const f of producer.fixed ?? []) fields.add(f)
    for (const { key, fallback } of producer.fromConfig ?? []) {
      const value = String(node.config?.[key] ?? '').trim()
      fields.add(value || fallback)
    }
    if (producer.csvFromConfig) {
      const raw = String(node.config?.[producer.csvFromConfig] ?? '')
      for (const part of raw.split(',')) {
        const trimmed = part.trim()
        if (trimmed) fields.add(trimmed)
      }
    }
  }
  fields.delete('')
  return Array.from(fields).sort()
}

/** Every `tag` value an action.add_tag node in this workflow already uses,
 *  for the Tag no-code selector's "already used in this flow" section
 *  (in addition to the canonical TAG_TYPES palette from tagTypes.ts). */
export function collectWorkflowTags(nodes: WorkflowNode[]): string[] {
  const tags = new Set<string>()
  for (const node of nodes) {
    if (node.type !== 'action.add_tag') continue
    const value = String(node.config?.['tag'] ?? '').trim()
    if (value) tags.add(value)
  }
  return Array.from(tags).sort()
}

/** Fixed, small vocabularies for enum-like config keys — rendered as a plain
 *  dropdown (no "custom" escape hatch; the engine only understands these
 *  exact values). `labelKey` resolves through the shared i18n dictionary. */
export const ENUM_FIELD_OPTIONS: Record<string, { value: string; labelKey: string }[]> = {
  variant: [
    { value: 'list', labelKey: 'wf.variant.list' },
    { value: 'button', labelKey: 'wf.variant.button' },
  ],
  pickerMode: [
    { value: 'date', labelKey: 'wf.slotMenuMode.date' },
    { value: 'time', labelKey: 'wf.slotMenuMode.time' },
  ],
  communicationStyle: [
    { value: 'professional', labelKey: 'wf.style.professional' },
    { value: 'friendly', labelKey: 'wf.style.friendly' },
    { value: 'brief', labelKey: 'wf.style.brief' },
  ],
  op: [
    { value: 'equals', labelKey: 'wf.op.equals' },
    { value: 'contains', labelKey: 'wf.op.contains' },
    { value: 'not_equals', labelKey: 'wf.op.notEquals' },
  ],
  // send_template's `category` — the worker looks up the clinic's APPROVED
  // template for exactly one of these MessageTemplateCategory values (see
  // findApprovedByCategory); anything else silently no-ops at runtime.
  category: [
    { value: 'appointment_confirmation', labelKey: 'studio.templates.category.appointment_confirmation' },
    { value: 'appointment_reminder', labelKey: 'studio.templates.category.appointment_reminder' },
    { value: 'human_handoff_notification', labelKey: 'studio.templates.category.human_handoff_notification' },
    { value: 'review_request', labelKey: 'studio.templates.category.review_request' },
  ],
  // logic.delay's time unit — worker default is 'hour' (workflow-engine.ts), listed first.
  unit: [
    { value: 'hour', labelKey: 'wf.unit.hour' },
    { value: 'minute', labelKey: 'wf.unit.minute' },
    { value: 'day', labelKey: 'wf.unit.day' },
  ],
  // action.create_or_reschedule_booking's mode — worker default is 'create'
  // (workflow-runner.worker.ts), listed first.
  mode: [
    { value: 'create', labelKey: 'wf.mode.create' },
    { value: 'reschedule', labelKey: 'wf.mode.reschedule' },
  ],
  // action.extract_booking_details / action.transcribe_booking_voice's AI
  // provider — worker falls back to 'claude' for anything unrecognized
  // (voice-booking.ts), listed first.
  provider: [
    { value: 'claude', labelKey: 'wf.provider.claude' },
    { value: 'openai', labelKey: 'wf.provider.openai' },
    { value: 'gemini', labelKey: 'wf.provider.gemini' },
    { value: 'custom', labelKey: 'wf.provider.custom' },
  ],
}

/** Fixed vocabulary for action.extract_booking_details / action.transcribe_
 *  booking_voice's `allowedFields` (comma-separated) — mirrors
 *  DEFAULT_ALLOWED_FIELDS in apps/workers/src/voice-booking.ts. Keep in sync
 *  manually (same cross-package boundary as the rest of this file). */
export const ALLOWED_BOOKING_FIELDS = [
  'patient_name',
  'phone_number',
  'preferred_date',
  'preferred_time',
  'clinic_location',
  'doctor_preference',
] as const

// --- No-code dependent "value" selector --------------------------------------
// logic.condition compares a context field against a literal `value`. Once the
// admin has picked the field, the set of values that field can actually hold
// at runtime is often known — so the panel offers those as a dropdown instead
// of demanding an exact hand-typed match (a typo silently never matches).

export interface FieldValueOption {
  /** Exact string the runtime context will hold — this is what gets stored. */
  value: string
  /** Optional display label; the canvas humanizes `value` when absent. */
  label?: string
}

/** Reserved menu handles the engine may write into a menu's field when the
 *  reply did not match an option (mirrors MENU_RESERVED_HANDLES in
 *  @docmee/agents workflow-engine — ctx[field] = selected?.title ?? handle). */
const MENU_HANDLE_VALUES = ['restart', 'livechat', 'default']

/** Fields whose runtime values come from a fixed vocabulary, verified against
 *  workflow-runner.worker.ts / workflow-engine.ts. (classification_confidence
 *  and booking_confidence are deliberately absent — the worker writes numeric
 *  scores there, not enums.) */
const FIXED_FIELD_VALUES: Record<string, string[]> = {
  // askAndCapture: 'captured' on success, 'pending' while waiting, 'error' otherwise
  capture_status: ['captured', 'pending', 'error'],
  // askAndCapture: `invalid_${validation}` or 'conversation_required'
  capture_error: ['invalid_text', 'invalid_date', 'invalid_time', 'invalid_phone', 'invalid_number', 'invalid_email', 'conversation_required'],
  // createOrRescheduleBooking
  booking_status: ['created', 'rescheduled'],
  // extract/transcribe: extraction.confidence is a high/medium/low enum
  voice_booking_confidence: ['high', 'medium', 'low'],
  // extract/transcribe booleans (evalCondition stringifies ctx values, so
  // boolean true/false compare against these exact strings)
  needs_review: ['true', 'false'],
  contains_disallowed_medical_content: ['true', 'false'],
}

interface MenuOptionLike {
  optionId: string
  title: string
}

/** Slug for a menu optionId derived from a display name ("Dr. García" →
 *  "dr_garcia"): strips accents, lowercases, folds non-alphanumerics to `_`.
 *  Used when an admin picks a real entity (e.g. a clinic doctor) to fill a
 *  menu option — the id stays a readable branch handle while the option's
 *  title carries the exact name the runtime doctor resolver matches on. */
export function slugifyOptionId(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return slug || 'option'
}

/** `slugifyOptionId` guaranteed unique among existing optionIds
 *  (appends `_2`, `_3`, … on collision). */
export function uniqueOptionId(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base
  let suffix = 2
  while (existing.includes(`${base}_${suffix}`)) suffix++
  return `${base}_${suffix}`
}

/** Parse a menu node's `config.options` (JSON string or array). Local copy of
 *  the engine's parseMenuOptions so inboxos stays dependency-free. */
function parseMenuOptionList(raw: unknown): MenuOptionLike[] {
  let list: unknown = raw
  if (typeof list === 'string') {
    if (!list.trim()) return []
    try {
      list = JSON.parse(list)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list.filter(
    (o): o is MenuOptionLike =>
      typeof o === 'object' && o !== null &&
      typeof (o as MenuOptionLike).optionId === 'string' &&
      typeof (o as MenuOptionLike).title === 'string',
  )
}

export type AiAgentScenarioAction = 'reply' | 'route' | 'handoff'

export interface AiAgentScenarioLike {
  id: string
  description: string
  action: AiAgentScenarioAction
  targetWorkflowId?: string
}

/** Parse an action.ai_agent node's `config.scenarios` (JSON string or array).
 *  Local copy of the engine's parseAiAgentScenarios so inboxos stays
 *  dependency-free of @docmee/agents, mirroring parseMenuOptionList above. */
export function parseAiAgentScenarioList(raw: unknown): AiAgentScenarioLike[] {
  let list: unknown = raw
  if (typeof list === 'string') {
    if (!list.trim()) return []
    try {
      list = JSON.parse(list)
    } catch {
      return []
    }
  }
  if (!Array.isArray(list)) return []
  return list.filter(
    (o): o is AiAgentScenarioLike =>
      typeof o === 'object' && o !== null &&
      typeof (o as AiAgentScenarioLike).id === 'string' &&
      typeof (o as AiAgentScenarioLike).description === 'string' &&
      ((o as AiAgentScenarioLike).action === 'reply' || (o as AiAgentScenarioLike).action === 'route' || (o as AiAgentScenarioLike).action === 'handoff'),
  )
}

/**
 * Every literal value the given context field can plausibly hold at runtime,
 * for the dependent "value" dropdown in logic.condition:
 * - a field produced by an interactive_menu node takes the chosen option's
 *   **title** (the engine stores `selected?.title ?? handle`), plus the
 *   reserved restart/livechat/default handles it may fall back to;
 * - fixed-vocabulary fields (capture_status, booking_status, …) take their
 *   known enum values.
 * Empty for fields with free-text values (ask_capture answers, dates, …) —
 * the panel keeps a plain text input for those. Deduped, order-preserving.
 */
export function collectFieldValueOptions(nodes: WorkflowNode[], fieldName: string): FieldValueOption[] {
  const field = fieldName.trim()
  if (!field) return []
  const out: FieldValueOption[] = []
  const seen = new Set<string>()
  const push = (value: string, label?: string) => {
    if (!value || seen.has(value)) return
    seen.add(value)
    out.push(label === undefined ? { value } : { value, label })
  }
  for (const node of nodes) {
    if (node.type !== 'action.interactive_menu') continue
    if (String(node.config?.['field'] ?? '').trim() !== field) continue
    for (const opt of parseMenuOptionList(node.config?.['options'])) push(opt.title)
    for (const handle of MENU_HANDLE_VALUES) push(handle)
  }
  for (const value of FIXED_FIELD_VALUES[field] ?? []) push(value)
  return out
}

// --- Shared canvas + editor helpers ------------------------------------------
// Moved out of WorkflowCanvas.tsx so the linear (Guided) editor can reuse the
// exact same node-face/branch/label logic instead of drifting out of sync with
// the canvas over time.

/** Humanize a config key/value into a display label ("doctorIdField" -> "Doctor
 *  Id Field"). Used wherever a config value doubles as its own label (no i18n
 *  key covers arbitrary admin-entered field/tag names). */
export function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

export interface MenuOption {
  optionId: string
  title: string
  description?: string
}

/** Parse an interactive_menu node's `config.options` (JSON string or array),
 *  keeping `description` (unlike the leaner MenuOptionLike/parseMenuOptionList
 *  above, which only the dependent condition-value dropdown needs). */
export function parseMenuOptionsSafe(raw: unknown): MenuOption[] {
  if (Array.isArray(raw)) {
    return raw.filter(
      (o): o is MenuOption =>
        typeof o === 'object' && o !== null && typeof (o as MenuOption).optionId === 'string' && typeof (o as MenuOption).title === 'string',
    )
  }
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((o): o is MenuOption => typeof o === 'object' && o !== null && typeof o.optionId === 'string' && typeof o.title === 'string')
      : []
  } catch {
    return []
  }
}

/** Next default optionId ("option_1", "option_2", …) for a new menu option. */
export function nextMenuOptionId(existing: MenuOption[]): string {
  let n = existing.length + 1
  while (existing.some((o) => o.optionId === `option_${n}`)) n++
  return `option_${n}`
}

/** Parses the "Bulk add options" textarea: one option per line, either
 *  `Title` or `Title | Description`. Blank lines and lines with an empty
 *  title (after trimming) are skipped. optionIds are slugified from the
 *  title and de-duplicated against `existing` (and against each other,
 *  since a bulk paste can itself contain repeated titles) using the exact
 *  same `slugifyOptionId`/`uniqueOptionId` pair the one-at-a-time doctor
 *  picker already uses — pure, so a bulk paste never collides with a
 *  hand-added option's id. Returns only the NEW options to append. */
export function parseBulkMenuOptionLines(text: string, existing: MenuOption[]): MenuOption[] {
  const takenIds = existing.map((o) => o.optionId)
  const added: MenuOption[] = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const [titlePart, ...descParts] = line.split('|')
    const title = (titlePart ?? '').trim()
    if (!title) continue
    const description = descParts.join('|').trim()
    const optionId = uniqueOptionId(slugifyOptionId(title), takenIds)
    takenIds.push(optionId)
    added.push({ optionId, title, ...(description ? { description } : {}) })
  }
  return added
}

/** Branch output rows per node type. `key` is the sourceHandle id used on both
 *  the canvas edges and the Guided editor's per-branch "go to step" dropdowns. */
export function branchRows(wf: WorkflowNode): { key: string; tone: string; label?: string }[] {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'logic.condition':
      return [
        { key: 'true', tone: 'emerald' },
        { key: 'false', tone: 'red' },
      ]
    case 'logic.ai_classify_intent':
      return [
        { key: 'high', tone: 'emerald' },
        { key: 'low', tone: 'amber' },
        { key: 'error', tone: 'red' },
      ]
    case 'action.interactive_menu': {
      // A reserved handle (restart/livechat/default) the admin has turned into
      // a real, visible option already comes through here with its own
      // configured title (same as any other option). Only the ones the admin
      // hasn't made visible still need a synthesized row, so routing to them
      // (via the '0'/'1' shortcut or an unmatched reply) stays wireable even
      // when there's no button for them.
      const opts = parseMenuOptionsSafe(cfg.options).map((o) => ({ key: o.optionId, tone: 'teal', label: o.title }))
      const configuredIds = new Set(opts.map((o) => o.key))
      const RESERVED_TONE: Record<string, string> = { restart: 'slate', livechat: 'sky', default: 'slate' }
      const fallbackReserved = (['restart', 'livechat', 'default'] as const)
        .filter((id) => !configuredIds.has(id))
        .map((id) => ({ key: id, tone: RESERVED_TONE[id]! }))
      return [...opts, ...fallbackReserved]
    }
    case 'action.ai_agent':
      return [
        { key: 'replied', tone: 'emerald' },
        { key: 'handoff', tone: 'sky' },
        { key: 'no_match', tone: 'slate' },
        { key: 'error', tone: 'red' },
      ]
    case 'action.offer_slot_menu':
      // Matches workflow-validator.ts's own required handle set exactly
      // (`selected`/`empty` mandatory, `restart`/`livechat` optional) — this
      // node type was missing from branchRows() entirely until now, which
      // made it silently indistinguishable from a plain linear node to every
      // branchRows()-driven consumer (the canvas's option-row rendering, the
      // Guided editor's linear-vs-branching classification). Both now treat
      // it correctly as branching, matching what the engine has always
      // required.
      return [
        { key: 'selected', tone: 'emerald' },
        { key: 'empty', tone: 'amber' },
        { key: 'restart', tone: 'slate' },
        { key: 'livechat', tone: 'sky' },
      ]
    default:
      return []
  }
}

// --- Routing-line colors (canvas edges) --------------------------------------
// Every branching node type's edges get a sensible default color from its
// branchRows() tone (see TONE_DEFAULT_COLOR below) so tracing a graph works
// out of the box. An admin can override any individual branch's color -- e.g.
// to keep two condition nodes' "true" paths visually distinct in a busy
// canvas -- stored as a flat JSON map on the node's own config, keyed by
// sourceHandle, so it round-trips through the exact same
// onPatchConfig(key, value) contract every other config field already uses.

const TONE_DEFAULT_COLOR: Record<string, string> = {
  emerald: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  sky: '#0ea5e9',
  slate: '#94a3b8',
  teal: '#14b8a6',
}

/** Parse a node's `config.branchColors` (JSON string, object, or missing) into
 *  a plain `{ [sourceHandle]: '#rrggbb' }` map. Malformed input -> `{}`. */
export function parseBranchColors(raw: unknown): Record<string, string> {
  let value: unknown = raw
  if (typeof value === 'string') {
    if (!value.trim()) return {}
    try {
      value = JSON.parse(value)
    } catch {
      return {}
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v) out[key] = v
  }
  return out
}

/** The color to draw a node's outgoing edge/line for one branch handle: the
 *  admin's own override if set, else the tone-based default that matches
 *  branchRows()'s own tone for that same row, else a neutral gray fallback
 *  (e.g. for a stale sourceHandle that no longer matches any current row). */
export function resolveBranchColor(node: WorkflowNode, handleKey: string): string {
  const custom = parseBranchColors(node.config?.branchColors)[handleKey]
  if (custom) return custom
  const row = branchRows(node).find((r) => r.key === handleKey)
  return (row && TONE_DEFAULT_COLOR[row.tone]) || TONE_DEFAULT_COLOR.slate!
}
