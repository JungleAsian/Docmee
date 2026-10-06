// Superuser change log. One set of app-level hooks records every change made to a
// workflow, setting or configuration — who, which clinic, what changed — instead
// of relying on each route to remember to log. Workflows and clinic settings get a
// real before/after diff; other configuration records the (redacted) submission.
//
// Logging is strictly best-effort: it runs after the response is sent and never
// blocks or fails a request. Secrets are redacted before anything is stored.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  createChangeLogRepository,
  createClinicsRepository,
  createWorkflowsRepository,
  type CreateChangeLogInput,
} from '@docmee/db'
import { hasDatabaseUrl, withDb } from './db.js'

export type ChangeArea =
  | 'workflow'
  | 'automation'
  | 'clinic_settings'
  | 'channels'
  | 'ai'
  | 'calendar'
  | 'doctors_services'
  | 'templates'
  | 'knowledge_base'
  | 'governance'
  | 'users'
  | 'reports'
  | 'media'
  | 'license'

type Snapshot = 'workflow' | 'clinic'

export interface ChangeRule {
  area: ChangeArea
  resourceType: string
  /** Human label for summaries, e.g. "Workflow". */
  label: string
  pattern: RegExp
  methods?: readonly string[]
  snapshot?: Snapshot
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Matched against Fastify's route pattern (request.routeOptions.url). Read-only
// checks (diagnostics, simulations, previews, connection tests) and day-to-day
// patient operations (messages, conversations, appointments) are intentionally
// absent: this log is for workflow, setting and configuration changes.
export const CHANGE_RULES: readonly ChangeRule[] = [
  { area: 'workflow', resourceType: 'workflow', label: 'Workflow', pattern: /^\/clinics\/:id\/workflows(\/wizard)?$/, methods: ['POST'] },
  { area: 'workflow', resourceType: 'workflow', label: 'Workflow', pattern: /^\/clinics\/:id\/workflows\/:workflowId$/, snapshot: 'workflow' },
  { area: 'workflow', resourceType: 'workflow', label: 'Workflow', pattern: /^\/clinics\/:id\/workflows\/:workflowId\/lifecycle$/, snapshot: 'workflow' },
  { area: 'workflow', resourceType: 'workflow', label: 'Workflow', pattern: /^\/clinics\/:id\/workflows\/:workflowId\/revisions\/:revisionId\/restore$/, snapshot: 'workflow' },
  { area: 'workflow', resourceType: 'workflow_run', label: 'Workflow run', pattern: /^\/clinics\/:id\/workflows\/:workflowId\/runs\/:runId\/cancel$/ },
  { area: 'workflow', resourceType: 'workflow_approval', label: 'Workflow approval', pattern: /^\/clinics\/:id\/workflow-approvals\/:approvalId\/decision$/ },
  { area: 'workflow', resourceType: 'custom_flow', label: 'Custom flow', pattern: /^\/clinics\/:id\/custom-flows(\/:flowId)?$/ },
  { area: 'automation', resourceType: 'patient_automation', label: 'Patient automation', pattern: /^\/patients\/:id\/(automation-mode|staff-opt-out)$/ },
  { area: 'clinic_settings', resourceType: 'clinic', label: 'Clinic', pattern: /^\/clinics(\/:id(\/clone)?)?$/, snapshot: 'clinic' },
  { area: 'clinic_settings', resourceType: 'launch_readiness', label: 'Launch readiness', pattern: /^\/clinics\/:clinicId\/launch-readiness$/ },
  { area: 'channels', resourceType: 'channel', label: 'Channel', pattern: /^\/clinics\/:id\/channels\/:channel$/ },
  { area: 'channels', resourceType: 'whatsapp_account', label: 'WhatsApp account', pattern: /^\/clinics\/:id\/channels\/whatsapp\/(:accountId(\/register)?|embedded-signup)$/ },
  { area: 'channels', resourceType: 'email_delivery', label: 'Email delivery', pattern: /^\/clinics\/:id\/email-delivery$/ },
  { area: 'ai', resourceType: 'ai_provider', label: 'AI provider', pattern: /^\/clinic\/:clinicId\/ai\/:provider\/(connect|disconnect)$/ },
  { area: 'calendar', resourceType: 'calendar', label: 'Clinic calendar', pattern: /^\/clinic\/:clinicId\/calendar\/(auth-url|disconnect)$/ },
  { area: 'calendar', resourceType: 'doctor_calendar', label: 'Doctor calendar', pattern: /^\/clinics\/:clinicId\/doctors\/:doctorId\/calendar\/(auth-url|disconnect)$/ },
  { area: 'doctors_services', resourceType: 'doctor', label: 'Doctor', pattern: /^\/clinics\/:id\/doctors(\/:doctorId)?$/ },
  { area: 'doctors_services', resourceType: 'service', label: 'Service', pattern: /^\/clinics\/:id\/(services|doctors\/:doctorId\/services(\/:serviceId)?)$/ },
  { area: 'templates', resourceType: 'message_template', label: 'Message template', pattern: /^\/clinics\/:id\/message-templates(\/:templateId(\/sync)?)?$/ },
  { area: 'templates', resourceType: 'quick_reply', label: 'Quick reply', pattern: /^\/clinics\/:id\/quick-reply-templates(\/:templateId)?$/ },
  { area: 'governance', resourceType: 'governance', label: 'Governance', pattern: /^\/clinics\/:id\/(governance\/:recordId|kb\/:entryId\/governance|custom-attributes\/:attributeId|api-tokens(\/:tokenId)?|webhook-registry)$/ },
  { area: 'knowledge_base', resourceType: 'kb_entry', label: 'Knowledge base', pattern: /^\/clinics\/:id\/kb(\/:entryId|\/approve-all|\/reembed|\/upload)?$/ },
  { area: 'knowledge_base', resourceType: 'kb_learning', label: 'KB learning', pattern: /^\/clinics\/:id\/kb\/learning\// },
  { area: 'knowledge_base', resourceType: 'kb_draft', label: 'KB teaching draft', pattern: /^\/clinics\/:id\/kb\/teaching\/drafts$/ },
  { area: 'knowledge_base', resourceType: 'kb_entry', label: 'Knowledge base', pattern: /^\/clinics\/:id\/errors\/:errorId\/add-to-kb$/ },
  { area: 'users', resourceType: 'user', label: 'User', pattern: /^\/clinics\/:id\/users(\/:userId)?$/ },
  { area: 'users', resourceType: 'signup_request', label: 'Signup request', pattern: /^\/auth\/signup-requests\/:id\/(approve|reject)$/ },
  { area: 'reports', resourceType: 'report_settings', label: 'Report settings', pattern: /^\/clinics\/:id\/reports\/settings$/ },
  { area: 'license', resourceType: 'license', label: 'License', pattern: /^\/clinics\/:id\/license$/ },
  { area: 'media', resourceType: 'media_asset', label: 'Media library', pattern: /^\/clinics\/:id\/media(\/:assetId|\/google-drive\/upload|\/google-drive\/:fileId\/import)?$/ },
]

export function matchChangeRule(method: string, route: string | undefined): ChangeRule | null {
  if (!route || !MUTATING.has(method)) return null
  return CHANGE_RULES.find((rule) => rule.pattern.test(route) && (!rule.methods || rule.methods.includes(method))) ?? null
}

// Trailing route segments that name the action better than the HTTP verb does.
const VERB_SEGMENTS = new Set([
  'clone', 'lifecycle', 'restore', 'cancel', 'decision', 'approve', 'reject', 'register', 'sync',
  'approve-all', 'reembed', 'import', 'upload', 'resolve', 'review', 'candidate', 'feedback',
  'embedded-signup', 'auth-url', 'add-to-kb', 'connect', 'disconnect', 'wizard', 'automation-mode',
  'staff-opt-out', 'drafts',
])

export function deriveAction(method: string, route: string): string {
  const last = route.split('/').filter(Boolean).pop() ?? ''
  if (VERB_SEGMENTS.has(last)) return last.replace(/-/g, '_')
  return method === 'POST' ? 'created' : method === 'DELETE' ? 'deleted' : 'updated'
}

// ── Redaction ────────────────────────────────────────────────────────────────

const SECRET_KEY = /(pass(word)?|secret|token|api[-_]?key|apikey|license[-_]?key|credential|authorization|private[-_]?key|cookie|signature|refresh)/i
const REDACTED = '[redacted]'
const MAX_STRING = 600
const MAX_ARRAY = 40
const MAX_DEPTH = 6

export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

/** Deep copy with secret-looking keys masked and large values truncated. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (+${value.length - MAX_STRING} chars)` : value
  }
  if (typeof value !== 'object') return value
  if (depth >= MAX_DEPTH) return '[…]'
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY).map((item) => redact(item, depth + 1))
    if (value.length > MAX_ARRAY) items.push(`… ${value.length - MAX_ARRAY} more`)
    return items
  }
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSecretKey(key) ? (inner === null || inner === '' ? inner : REDACTED) : redact(inner, depth + 1)
  }
  return out
}

// ── Diffs ────────────────────────────────────────────────────────────────────

export interface FieldChange {
  path: string
  before: unknown
  after: unknown
}

const MAX_FIELD_CHANGES = 80

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Field-level differences between two values, recursing into plain objects. */
export function diffValues(before: unknown, after: unknown, path = '', out: FieldChange[] = [], depth = 0): FieldChange[] {
  if (out.length >= MAX_FIELD_CHANGES) return out
  if (isPlainObject(before) && isPlainObject(after) && depth < 4) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    for (const key of [...keys].sort()) {
      const childPath = path ? `${path}.${key}` : key
      if (isSecretKey(key)) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
          out.push({ path: childPath, before: REDACTED, after: REDACTED })
        }
        continue
      }
      diffValues(before[key], after[key], childPath, out, depth + 1)
    }
    return out
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path: path || '(value)', before: redact(before ?? null), after: redact(after ?? null) })
  }
  return out
}

interface GraphNode {
  id: string
  type: string
  config?: Record<string, unknown>
  x?: number
  y?: number
}

interface GraphEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
}

export interface WorkflowSnapshot {
  name: string
  status: string
  nodes: GraphNode[]
  edges: GraphEdge[]
}

function nodeLabel(node: GraphNode): string {
  const config = node.config ?? {}
  for (const key of ['customLabel', 'label', 'title', 'name']) {
    const value = config[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80)
  }
  return node.type
}

const edgeKey = (edge: GraphEdge) => `${edge.source}->${edge.target}:${edge.sourceHandle ?? ''}`

/** Step-level description of what changed in a workflow graph. */
export function diffWorkflow(before: WorkflowSnapshot | null, after: WorkflowSnapshot | null): Record<string, unknown> {
  if (!before && !after) return {}
  if (!after) return { deleted: { name: before!.name, steps: before!.nodes.length } }
  if (!before) return { created: { name: after.name, status: after.status, steps: after.nodes.length } }

  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]))
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]))
  const describe = (node: GraphNode) => ({ id: node.id, type: node.type, label: nodeLabel(node) })

  const stepsAdded = after.nodes.filter((node) => !beforeNodes.has(node.id)).map(describe)
  const stepsRemoved = before.nodes.filter((node) => !afterNodes.has(node.id)).map(describe)
  const stepsChanged: Array<Record<string, unknown>> = []
  let stepsMoved = 0
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id)
    if (!previous) continue
    if (previous.x !== node.x || previous.y !== node.y) stepsMoved++
    const fields = diffValues(previous.config ?? {}, node.config ?? {})
    if (previous.type !== node.type) fields.unshift({ path: 'type', before: previous.type, after: node.type })
    if (fields.length > 0) stepsChanged.push({ ...describe(node), fields })
  }

  const beforeEdges = new Set(before.edges.map(edgeKey))
  const afterEdges = new Set(after.edges.map(edgeKey))
  const connectionsAdded = [...afterEdges].filter((key) => !beforeEdges.has(key)).length
  const connectionsRemoved = [...beforeEdges].filter((key) => !afterEdges.has(key)).length

  const result: Record<string, unknown> = {}
  if (before.name !== after.name) result['name'] = { before: before.name, after: after.name }
  if (before.status !== after.status) result['status'] = { before: before.status, after: after.status }
  if (stepsAdded.length) result['stepsAdded'] = stepsAdded
  if (stepsRemoved.length) result['stepsRemoved'] = stepsRemoved
  if (stepsChanged.length) result['stepsChanged'] = stepsChanged
  if (stepsMoved) result['stepsMoved'] = stepsMoved
  if (connectionsAdded) result['connectionsAdded'] = connectionsAdded
  if (connectionsRemoved) result['connectionsRemoved'] = connectionsRemoved
  return result
}

function workflowSummaryDetail(diff: Record<string, unknown>): string {
  const parts: string[] = []
  const count = (key: string) => (Array.isArray(diff[key]) ? (diff[key] as unknown[]).length : 0)
  if (diff['status']) parts.push(`status ${(diff['status'] as { before: string }).before} → ${(diff['status'] as { after: string }).after}`)
  if (diff['name']) parts.push('renamed')
  if (count('stepsAdded')) parts.push(`${count('stepsAdded')} step(s) added`)
  if (count('stepsRemoved')) parts.push(`${count('stepsRemoved')} step(s) removed`)
  if (count('stepsChanged')) parts.push(`${count('stepsChanged')} step(s) edited`)
  const connections = Number(diff['connectionsAdded'] ?? 0) + Number(diff['connectionsRemoved'] ?? 0)
  if (connections) parts.push(`${connections} connection change(s)`)
  if (diff['stepsMoved'] && parts.length === 0) parts.push('layout rearranged')
  return parts.join(', ')
}

// ── Capture ──────────────────────────────────────────────────────────────────

interface ChangeLogState {
  rule: ChangeRule
  before?: unknown
  response?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    changeLog?: ChangeLogState
  }
}

type Params = Record<string, string | undefined>

function clinicIdFor(request: FastifyRequest, route: string): string | null {
  const params = (request.params ?? {}) as Params
  if (params['clinicId']) return params['clinicId']
  if (route.startsWith('/clinics/:id')) return params['id'] ?? null
  const header = request.headers['x-clinic-id']
  if (typeof header === 'string' && /^[0-9a-f-]{36}$/i.test(header)) return header
  return request.user?.clinicId ?? null
}

async function loadSnapshot(kind: Snapshot, clinicId: string | null, params: Params): Promise<unknown> {
  if (!clinicId) return undefined
  return withDb(async (sql) => {
    if (kind === 'workflow') {
      const workflowId = params['workflowId']
      if (!workflowId) return undefined
      const workflow = await createWorkflowsRepository(sql).findById(clinicId, workflowId)
      return workflow
        ? ({ name: workflow.name, status: workflow.status, nodes: workflow.nodes, edges: workflow.edges } satisfies WorkflowSnapshot)
        : null
    }
    const clinic = await createClinicsRepository(sql).findById(clinicId)
    if (!clinic) return null
    // Identity and timestamps are not settings; leave them out of the diff.
    const rest: Record<string, unknown> = { ...(clinic as unknown as Record<string, unknown>) }
    for (const key of ['id', 'createdAt', 'updatedAt']) delete rest[key]
    return rest
  })
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return isPlainObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The created/updated record in a JSON response (`{ workflow: {...} }` or the record itself). */
function responseRecord(body: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!body) return null
  if (typeof body['id'] === 'string') return body
  for (const value of Object.values(body)) {
    if (isPlainObject(value) && typeof value['id'] === 'string') return value
  }
  return null
}

function nameOf(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) return null
  for (const key of ['name', 'title', 'fullName', 'full_name', 'displayName', 'email', 'question']) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 120)
  }
  return null
}

const clinicNames = new Map<string, { name: string | null; at: number }>()

async function clinicName(clinicId: string | null): Promise<string | null> {
  if (!clinicId) return null
  const cached = clinicNames.get(clinicId)
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.name
  const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId)).catch(() => null)
  const name = clinic?.name ?? null
  clinicNames.set(clinicId, { name, at: Date.now() })
  return name
}

export async function buildChangeLogEntry(request: FastifyRequest, reply: FastifyReply): Promise<CreateChangeLogInput | null> {
  const state = request.changeLog
  const user = request.user
  if (!state || !user) return null
  const route = request.routeOptions.url ?? request.url
  const method = request.method
  const params = (request.params ?? {}) as Params
  const status = reply.statusCode
  const outcome = status < 400 ? 'succeeded' : 'failed'
  const action = deriveAction(method, route)
  const body = isPlainObject(request.body) ? request.body : null
  const record = responseRecord(parseJson(state.response))
  // A newly created clinic is its own clinic, not the creator's active one.
  const clinicId =
    route === '/clinics' && method === 'POST'
      ? (typeof record?.['id'] === 'string' ? record['id'] : null)
      : clinicIdFor(request, route)

  let changes: Record<string, unknown> = {}
  let resourceName = nameOf(record) ?? nameOf(body)
  let detail = ''

  if (outcome === 'succeeded' && state.rule.snapshot === 'workflow') {
    const after = method === 'DELETE' ? null : ((await loadSnapshot('workflow', clinicId, params)) as WorkflowSnapshot | null)
    const before = (state.before ?? null) as WorkflowSnapshot | null
    changes = diffWorkflow(before, after)
    resourceName = after?.name ?? before?.name ?? resourceName
    detail = workflowSummaryDetail(changes)
  } else if (outcome === 'succeeded' && state.rule.snapshot === 'clinic' && method !== 'POST') {
    const before = state.before ?? null
    const after = method === 'DELETE' ? null : await loadSnapshot('clinic', clinicId, params)
    const fields = after === null ? [] : diffValues(before ?? {}, after ?? {})
    changes = after === null ? { deleted: true } : { fields }
    resourceName = nameOf(after as Record<string, unknown>) ?? nameOf(before as Record<string, unknown>) ?? resourceName
    detail = fields.length ? `${fields.length} setting(s) changed` : ''
  } else if (body && Object.keys(body).length > 0) {
    changes = { submitted: redact(body) }
  }

  // The record's own id, else the last route param unless that param is just the clinic.
  const paramKeys = Object.keys(params)
  const lastKey = paramKeys[paramKeys.length - 1]
  const lastIsClinic = lastKey === 'clinicId' || (lastKey === 'id' && route.startsWith('/clinics/:id'))
  const resourceId =
    record && typeof record['id'] === 'string'
      ? record['id']
      : lastKey && (!lastIsClinic || state.rule.resourceType === 'clinic')
        ? params[lastKey] ?? null
        : null

  const verb = action.replace(/_/g, ' ')
  const named = resourceName ? ` “${resourceName}”` : ''
  const summary =
    outcome === 'failed'
      ? `${state.rule.label} ${verb}${named} failed (HTTP ${status})`
      : `${state.rule.label} ${verb}${named}${detail ? ` — ${detail}` : ''}`

  return {
    clinicId,
    clinicName: await clinicName(clinicId),
    actorId: user.userId ?? null,
    actorEmail: user.email ?? null,
    actorRole: user.role ?? null,
    area: state.rule.area,
    action,
    method,
    route,
    resourceType: state.rule.resourceType,
    resourceId,
    resourceName,
    outcome,
    statusCode: status,
    summary: summary.slice(0, 500),
    changes,
    requestId: request.id ?? null,
  }
}

/** Register the capture hooks. Call before any route plugin is registered. */
export function registerChangeLog(app: FastifyInstance): void {
  app.decorateRequest('changeLog', undefined)

  app.addHook('preHandler', async (request) => {
    const rule = matchChangeRule(request.method, request.routeOptions.url)
    if (!rule) return
    request.changeLog = { rule }
    if (rule.snapshot && request.method !== 'POST' && hasDatabaseUrl()) {
      const route = request.routeOptions.url ?? ''
      request.changeLog.before = await loadSnapshot(rule.snapshot, clinicIdFor(request, route), (request.params ?? {}) as Params)
        .catch(() => undefined)
    }
  })

  app.addHook('onSend', async (request, _reply, payload) => {
    if (request.changeLog && typeof payload === 'string' && payload.length < 256_000) {
      request.changeLog.response = payload
    }
    return payload
  })

  app.addHook('onResponse', async (request, reply) => {
    if (!request.changeLog || !request.user || !hasDatabaseUrl()) return
    // Never delay or fail the request: the response has already been sent.
    void buildChangeLogEntry(request, reply)
      .then((entry) => (entry ? withDb((sql) => createChangeLogRepository(sql).log(entry)) : undefined))
      .catch((error: unknown) => {
        request.log.warn({ err: error instanceof Error ? error.message : String(error) }, '[change-log] failed to record change')
      })
  })
}
