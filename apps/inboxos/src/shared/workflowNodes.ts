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
}

export const WORKFLOW_NODE_TYPES: NodeTypeDef[] = [
  // Triggers - what starts the workflow (exactly one per workflow).
  // Only list events which the worker currently produces. Do not let a clinic
  // activate a workflow that would remain inert.
  { type: 'trigger.message_keyword', kind: 'trigger', labelKey: 'wf.node.messageKeyword', descKey: 'wf.desc.messageKeyword', fields: ['keywords'] },
  { type: 'trigger.patient_upset', kind: 'trigger', labelKey: 'wf.node.patientUpset', descKey: 'wf.desc.patientUpset', fields: [] },
  // Logic - routing + timing.
  { type: 'logic.condition', kind: 'logic', labelKey: 'wf.node.condition', descKey: 'wf.desc.condition', fields: ['field', 'op', 'value'] },
  { type: 'logic.delay', kind: 'logic', labelKey: 'wf.node.delay', descKey: 'wf.desc.delay', fields: ['amount', 'unit'] },
  { type: 'logic.wait_for_reply', kind: 'logic', labelKey: 'wf.node.waitForReply', descKey: 'wf.desc.waitForReply', fields: ['timeoutMinutes'] },
  {
    type: 'logic.ai_classify_intent',
    kind: 'logic',
    labelKey: 'wf.node.aiClassifyIntent',
    descKey: 'wf.desc.aiClassifyIntent',
    fields: ['confidenceField', 'highThreshold', 'lowThreshold', 'prompt'],
  },
  // Actions - what the workflow does.
  { type: 'action.send_message', kind: 'action', labelKey: 'wf.node.sendMessage', descKey: 'wf.desc.sendMessage', fields: ['text'] },
  { type: 'action.send_template', kind: 'action', labelKey: 'wf.node.sendTemplate', descKey: 'wf.desc.sendTemplate', fields: ['category'] },
  { type: 'action.notify_secretary', kind: 'action', labelKey: 'wf.node.notify', descKey: 'wf.desc.notify', fields: [] },
  { type: 'action.add_tag', kind: 'action', labelKey: 'wf.node.addTag', descKey: 'wf.desc.addTag', fields: ['tag'] },
  { type: 'action.ai_draft', kind: 'action', labelKey: 'wf.node.aiDraft', descKey: 'wf.desc.aiDraft', fields: ['prompt', 'queryLimit', 'responseBuffer'] },
  {
    type: 'action.interactive_menu',
    kind: 'action',
    labelKey: 'wf.node.interactiveMenu',
    descKey: 'wf.desc.interactiveMenu',
    fields: ['variant', 'header', 'message', 'footer', 'options', 'field'],
  },
  { type: 'action.approval', kind: 'action', labelKey: 'wf.node.approval', descKey: 'wf.desc.approval', fields: [] },
  {
    type: 'action.ask_capture',
    kind: 'action',
    labelKey: 'wf.node.askCapture',
    descKey: 'wf.desc.askCapture',
    fields: ['field', 'question', 'validation', 'retryQuestion', 'maxAttempts'],
  },
  {
    type: 'action.extract_booking_details',
    kind: 'action',
    labelKey: 'wf.node.extractBookingDetails',
    descKey: 'wf.desc.extractBookingDetails',
    fields: ['provider', 'allowedFields', 'reviewTag'],
  },
  {
    type: 'action.check_availability',
    kind: 'action',
    labelKey: 'wf.node.checkAvailability',
    descKey: 'wf.desc.checkAvailability',
    fields: ['doctorIdField', 'dateField', 'days', 'slotsField'],
  },
  {
    type: 'action.offer_slots',
    kind: 'action',
    labelKey: 'wf.node.offerSlots',
    descKey: 'wf.desc.offerSlots',
    fields: ['slotsField', 'count', 'message'],
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
  },
  {
    type: 'action.transcribe_booking_voice',
    kind: 'action',
    labelKey: 'wf.node.transcribeBookingVoice',
    descKey: 'wf.desc.transcribeBookingVoice',
    fields: ['provider', 'allowedFields', 'reviewTag'],
  },
  { type: 'action.end', kind: 'action', labelKey: 'wf.node.end', descKey: 'wf.desc.end', fields: [] },
]

export const nodeDef = (type: string): NodeTypeDef | undefined =>
  WORKFLOW_NODE_TYPES.find((n) => n.type === type)

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
  op: [
    { value: 'equals', labelKey: 'wf.op.equals' },
    { value: 'contains', labelKey: 'wf.op.contains' },
    { value: 'not_equals', labelKey: 'wf.op.notEquals' },
  ],
}

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
