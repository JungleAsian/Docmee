// Clinic routes (P08, extended P09 for Admin Studio).
//   GET   /clinics              (ia_studio_admin — list all clinics)
//   POST  /clinics              (ia_studio_admin — create a clinic)
//   GET   /clinics/:id          (clinic_admin, ia_studio_admin)
//   PATCH /clinics/:id          (clinic_admin, ia_studio_admin)
//   GET   /clinics/:id/stats    (any authenticated user, own clinic)
//   GET   /clinics/:id/team     (any authenticated user, own clinic — AssignPanel)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  createClinicsRepository,
  createConversationsRepository,
  createAuditRepository,
  createPatientsRepository,
  createUsersRepository,
  toJson,
} from '@docmee/db'
import { normalizeNotificationPrefs } from '@docmee/notifications'
import { decryptValue, encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import type { Clinic } from '@docmee/db'

// The Messenger/Instagram Page tokens are write-only — never echo them to the panel.
type RedactedClinic = Omit<
  Clinic,
  'messengerPageAccessTokenEncrypted' | 'instagramPageAccessTokenEncrypted'
>
interface MetaGraphBody {
  error?: { message?: string }
}

const ASSIGNABLE_ROLES = ['secretary', 'doctor', 'clinic_admin'] as const
const ROLE_PERMISSIONS = ['inbox', 'calendar', 'patients', 'templates', 'voice_review', 'analytics', 'exports', 'billing', 'staff'] as const
const ROLE_MENU_ITEMS = ['inbox', 'alerts', 'calendar', 'waitlist', 'metrics', 'analytics', 'qos', 'reports', 'studio'] as const
const JZEL_AI_INTEGRATIONS = new Set(['claude', 'openai', 'gemini', 'custom'])
const JZEL_CONFIGURATION_LOCKED = {
  error: 'jzel_configuration_locked',
  message: 'J.zel is hidden for this user. J.zel and AI service configuration is locked.',
}

const DEFAULT_ROLE_PERMISSIONS = {
  inbox: ['secretary', 'doctor', 'clinic_admin'],
  calendar: ['secretary', 'doctor', 'clinic_admin'],
  patients: ['secretary', 'doctor', 'clinic_admin'],
  templates: ['clinic_admin'],
  voice_review: ['secretary', 'doctor', 'clinic_admin'],
  analytics: ['clinic_admin'],
  exports: ['clinic_admin'],
  billing: ['clinic_admin'],
  staff: ['clinic_admin'],
} satisfies Record<(typeof ROLE_PERMISSIONS)[number], Array<(typeof ASSIGNABLE_ROLES)[number]>>

const DEFAULT_ROLE_MENU_VISIBILITY = {
  inbox: ['secretary', 'doctor', 'clinic_admin'],
  alerts: ['secretary', 'doctor', 'clinic_admin'],
  calendar: ['secretary', 'doctor', 'clinic_admin'],
  waitlist: ['secretary', 'doctor', 'clinic_admin'],
  metrics: ['clinic_admin'],
  analytics: ['clinic_admin'],
  qos: ['clinic_admin'],
  reports: ['clinic_admin'],
  studio: ['clinic_admin'],
} satisfies Record<(typeof ROLE_MENU_ITEMS)[number], Array<(typeof ASSIGNABLE_ROLES)[number]>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function roleList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback
  const allowed = new Set<string>(ASSIGNABLE_ROLES)
  const roles = value.filter((role): role is string => typeof role === 'string' && allowed.has(role))
  return roles.length ? roles : fallback
}

function roleMatrix<T extends string>(
  saved: unknown,
  defaults: Record<T, string[]>,
  keys: readonly T[],
): Record<T, string[]> {
  const source = isRecord(saved) ? saved : {}
  return keys.reduce(
    (acc, key) => {
      acc[key] = roleList(source[key], defaults[key])
      return acc
    },
    {} as Record<T, string[]>,
  )
}

function withRoleAccessDefaults(settings: Record<string, unknown>): Record<string, unknown> {
  return {
    ...settings,
    rolePermissions: roleMatrix(settings['rolePermissions'], DEFAULT_ROLE_PERMISSIONS, ROLE_PERMISSIONS),
    roleMenuVisibility: roleMatrix(settings['roleMenuVisibility'], DEFAULT_ROLE_MENU_VISIBILITY, ROLE_MENU_ITEMS),
  }
}

function touchesJzelConfiguration(settings: unknown): boolean {
  if (!isRecord(settings)) return false
  if ('aiAssistant' in settings) return true
  const integrations = settings['integrations']
  if (!isRecord(integrations)) return false
  return Object.keys(integrations).some((provider) => JZEL_AI_INTEGRATIONS.has(provider))
}

async function isJzelConfigurationLocked(
  sql: Parameters<typeof createUsersRepository>[0],
  clinicId: string,
  userId: string,
): Promise<boolean> {
  const prefs = await createUsersRepository(sql).getNotificationPrefs(clinicId, userId)
  return normalizeNotificationPrefs(prefs ?? {}).jzelEnabled === false
}

// Strip the encrypted per-clinic AI provider keys (settings.integrations.<p>.apiKeyEnc)
// so the ciphertext never reaches the browser. Connection state is exposed separately
// by the /clinic/:id/ai/status route (masked last4 only).
function redactSettings(settings: Clinic['settings']): Clinic['settings'] {
  if (!settings || typeof settings !== 'object') return withRoleAccessDefaults({}) as Clinic['settings']
  const root = { ...(settings as Record<string, unknown>) }
  const integrations = root['integrations']
  if (integrations && typeof integrations === 'object') {
    const cleanedIntegrations: Record<string, unknown> = {}
    for (const [provider, entry] of Object.entries(integrations as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && 'apiKeyEnc' in entry) {
        const safe: Record<string, unknown> = { ...(entry as Record<string, unknown>) }
        delete safe['apiKeyEnc']
        cleanedIntegrations[provider] = safe
      } else {
        cleanedIntegrations[provider] = entry
      }
    }
    root['integrations'] = cleanedIntegrations
  }
  const emailDelivery = root['emailDelivery']
  if (emailDelivery && typeof emailDelivery === 'object') {
    const safeEmail: Record<string, unknown> = { ...(emailDelivery as Record<string, unknown>) }
    const hasPassword = Boolean(safeEmail['smtpPasswordEnc'] || safeEmail['smtpPasswordSet'])
    delete safeEmail['smtpPasswordEnc']
    safeEmail['smtpPasswordSet'] = hasPassword
    root['emailDelivery'] = safeEmail
  }
  return withRoleAccessDefaults(root) as Clinic['settings']
}

function mergeIntegrationsPreservingSecrets(
  current: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const currentIntegrations =
    current && typeof current === 'object' ? { ...(current as Record<string, unknown>) } : {}
  const incomingIntegrations =
    incoming && typeof incoming === 'object' ? { ...(incoming as Record<string, unknown>) } : {}
  const merged: Record<string, unknown> = { ...currentIntegrations, ...incomingIntegrations }

  for (const [provider, currentEntry] of Object.entries(currentIntegrations)) {
    const incomingEntry = incomingIntegrations[provider]
    if (
      currentEntry &&
      typeof currentEntry === 'object' &&
      'apiKeyEnc' in currentEntry &&
      incomingEntry &&
      typeof incomingEntry === 'object' &&
      !('apiKeyEnc' in incomingEntry)
    ) {
      merged[provider] = {
        ...(currentEntry as Record<string, unknown>),
        ...(incomingEntry as Record<string, unknown>),
        apiKeyEnc: (currentEntry as Record<string, unknown>)['apiKeyEnc'],
      }
    }
  }

  return merged
}

function redactClinic(clinic: Clinic): RedactedClinic {
  const rest = { ...clinic } as Partial<Clinic>
  delete rest.messengerPageAccessTokenEncrypted
  delete rest.instagramPageAccessTokenEncrypted
  rest.settings = redactSettings(clinic.settings)
  return rest as RedactedClinic
}

function cloneSafeSettings(settings: Clinic['settings'], sourceId: string): Record<string, unknown> {
  const safe = { ...(settings as Record<string, unknown>) }
  delete safe.license_key
  const integrations = safe.integrations
  if (integrations && typeof integrations === 'object') {
    safe.integrations = Object.fromEntries(
      Object.entries(integrations as Record<string, unknown>).map(([key, value]) => {
        if (!value || typeof value !== 'object') return [key, value]
        const entry = { ...(value as Record<string, unknown>) }
        delete entry.apiKeyEnc
        delete entry.accessTokenEnc
        return [key, entry]
      }),
    )
  }
  return {
    ...safe,
    clonedFromClinicId: sourceId,
    clonedAt: new Date().toISOString(),
  }
}

function readEncryptedToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

async function graphProbe(path: string, token: string) {
  const response = await fetch(`https://graph.facebook.com/v20.0/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.json().catch(() => ({} as MetaGraphBody)) as MetaGraphBody
  return {
    ok: response.ok,
    status: response.status,
    provider: body,
    error: response.ok ? null : body?.error?.message ?? `Meta Graph returned ${response.status}`,
  }
}

const createSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers and dashes'),
  plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
  status: z.enum(['active', 'suspended', 'cancelled']).optional(),
  timezone: z.string().min(1).optional(),
  address: z.string().optional(),
  phone: z.string().optional(),
  clinicType: z.string().optional(),
})

const patchSchema = z
  .object({
    name: z.string().min(1).optional(),
    plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
    status: z.enum(['active', 'suspended', 'cancelled']).optional(),
    timezone: z.string().min(1).optional(),
    address: z.string().optional(),
    phone: z.string().optional(),
    clinicType: z.string().optional(),
    settings: z.record(z.unknown()).optional(),
    // P14 — Facebook Messenger connection. Token is write-only; omit to keep it.
    messengerPageId: z.string().optional(),
    messengerPageAccessToken: z.string().min(1).optional(),
    messengerWebhookVerifyToken: z.string().optional(),
    messengerEnabled: z.boolean().optional(),
    // P15 — Instagram Direct connection. Token is write-only; omit to keep it.
    instagramAccountId: z.string().optional(),
    instagramPageAccessToken: z.string().min(1).optional(),
    instagramWebhookVerifyToken: z.string().optional(),
    instagramEnabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'No fields to update' })

const cloneSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, numbers and dashes'),
})

const clinicsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ── List all clinics (Admin Studio) ──
  app.get('/', { preHandler: requireRole('ia_studio_admin') }, async () => {
    const clinics = await withDb(async (sql) => createClinicsRepository(sql).list())
    return { clinics: clinics.map(redactClinic) }
  })

  // ── Per-clinic operational counts for the Screen 6 directory cards (Admin Studio) ──
  // Returns users / open-chats / handoff / urgent per clinic in a few grouped
  // queries (no N+1). Clinics with no users or conversations are simply absent —
  // the panel defaults their counts to zero.
  app.get('/overview', { preHandler: requireRole('ia_studio_admin') }, async () => {
    const stats = await withDb(async (sql) => createClinicsRepository(sql).directoryStats())
    return { stats }
  })

  // ── The caller's own clinic (Screen 6 — any authenticated role) ──
  // Drives the panel's tenant banner so a secretary / doctor always sees which
  // clinic they are working in. Scoped to the JWT's clinic, never the switched
  // active clinic, so it always names the tenant the user actually belongs to.
  app.get('/current', async (request, reply) => {
    const clinicId = request.user!.clinicId
    const clinic = await withDb(async (sql) => createClinicsRepository(sql).findById(clinicId))
    if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
    return { clinic: redactClinic(clinic) }
  })

  // ── Create a clinic (Admin Studio) ──
  app.post('/', { preHandler: requireRole('ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(createSchema, request.body, reply)
    if (!parsed.ok) return
    const clinic = await withDb(async (sql) => {
      const repo = createClinicsRepository(sql)
      if (await repo.findBySlug(parsed.data.slug)) return null
      return repo.create(parsed.data)
    })
    if (!clinic) return reply.code(409).send({ error: 'Slug already in use' })
    return reply.code(201).send({ clinic: redactClinic(clinic) })
  })

  app.post<{ Params: { id: string } }>('/:id/clone', { preHandler: requireRole('ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(cloneSchema, request.body, reply)
    if (!parsed.ok) return
    const sourceId = request.params.id
    const cloned = await withDb(async (sql) => {
      const clinics = createClinicsRepository(sql)
      const source = await clinics.findById(sourceId)
      if (!source) return { code: 404 as const }
      if (await clinics.findBySlug(parsed.data.slug)) return { code: 409 as const }
      return sql.begin(async (tx) => {
        const [clinic] = await tx<Clinic[]>`
          INSERT INTO clinics (name, slug, plan, status, settings, timezone)
          VALUES (
            ${parsed.data.name},
            ${parsed.data.slug},
            ${source.plan},
            'active',
            ${tx.json(toJson(cloneSafeSettings(source.settings, source.id)))},
            ${source.timezone}
          )
          RETURNING *
        `
        const cloneId = clinic!.id

        await tx`
          INSERT INTO services (clinic_id, name, description, duration_minutes, price, currency, is_active, metadata)
          SELECT ${cloneId}, name, description, duration_minutes, price, currency, is_active, metadata
          FROM services WHERE clinic_id = ${sourceId}
        `
        await tx`
          INSERT INTO doctors (clinic_id, name, specialty, google_calendar_id, available_days, is_active)
          SELECT ${cloneId}, name, specialty, google_calendar_id, available_days, is_active
          FROM doctors WHERE clinic_id = ${sourceId}
        `
        await tx`
          INSERT INTO quick_reply_templates (clinic_id, title, content)
          SELECT ${cloneId}, title, content FROM quick_reply_templates WHERE clinic_id = ${sourceId}
        `
        await tx`
          INSERT INTO message_templates (clinic_id, name, category, language, body, status)
          SELECT ${cloneId}, name, category, language, body, 'pending'
          FROM message_templates WHERE clinic_id = ${sourceId}
          ON CONFLICT (clinic_id, name) DO NOTHING
        `
        await tx`
          INSERT INTO custom_flows (clinic_id, name, trigger_keywords, messages, action, language, enabled)
          SELECT ${cloneId}, name, trigger_keywords, messages, action, language, enabled
          FROM custom_flows WHERE clinic_id = ${sourceId}
        `
        await tx`
          INSERT INTO workflows (clinic_id, name, status, nodes, edges)
          SELECT ${cloneId}, name, 'draft', nodes, edges
          FROM workflows WHERE clinic_id = ${sourceId}
        `
        await tx`
          WITH new_docs AS (
            INSERT INTO knowledge_documents (clinic_id, title, content, document_type, status, metadata)
            SELECT ${cloneId}, title, content, document_type, status, metadata || jsonb_build_object('clonedFromDocumentId', id::text)
            FROM knowledge_documents
            WHERE clinic_id = ${sourceId}
            RETURNING id, metadata
          )
          INSERT INTO knowledge_chunks (document_id, clinic_id, content, chunk_index, metadata)
          SELECT nd.id, ${cloneId}, kc.content, kc.chunk_index, kc.metadata
          FROM knowledge_chunks kc
          JOIN new_docs nd ON nd.metadata->>'clonedFromDocumentId' = kc.document_id::text
          WHERE kc.clinic_id = ${sourceId}
        `
        await tx`
          WITH new_profiles AS (
            INSERT INTO ia_profiles (clinic_id, name, system_prompt, model, temperature, max_tokens, is_active, settings)
            SELECT ${cloneId}, name, system_prompt, model, temperature, max_tokens, is_active, settings || jsonb_build_object('clonedFromProfileId', id::text)
            FROM ia_profiles
            WHERE clinic_id = ${sourceId}
            RETURNING id, settings
          )
          INSERT INTO ia_rules (ia_profile_id, clinic_id, rule_type, condition, action, priority, is_active)
          SELECT np.id, ${cloneId}, r.rule_type, r.condition, r.action, r.priority, r.is_active
          FROM ia_rules r
          JOIN new_profiles np ON np.settings->>'clonedFromProfileId' = r.ia_profile_id::text
          WHERE r.clinic_id = ${sourceId}
        `
        await tx`
          INSERT INTO audit_events
            (clinic_id, actor_id, actor_email, action, resource_type, resource_id, metadata, ip_address)
          VALUES (
            ${cloneId},
            ${request.user?.userId ?? null},
            ${request.user?.email ?? null},
            'clinic.cloned',
            'clinic',
            ${cloneId},
            ${tx.json(toJson({ sourceClinicId: sourceId }))},
            ${request.ip}
          )
        `
        return { code: 201 as const, clinic: clinic! }
      })
    })
    if (cloned.code === 404) return reply.code(404).send({ error: 'Clinic not found' })
    if (cloned.code === 409) return reply.code(409).send({ error: 'Slug already in use' })
    return reply.code(201).send({ clinic: redactClinic(cloned.clinic) })
  })

  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb(async (sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { clinic: redactClinic(clinic) }
    },
  )

  app.get<{ Params: { id: string }; Querystring: { limit?: string; resource_type?: string; action?: string } }>(
    '/:id/audit-events',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const events = await withDb((sql) =>
        createAuditRepository(sql).list(clinicId, {
          limit: Math.min(250, Math.max(1, Number(request.query.limit ?? 100))),
          resourceType: request.query.resource_type,
          action: request.query.action,
        }),
      )
      return { events }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/:id/messenger/test',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const token = readEncryptedToken(clinic.messengerPageAccessTokenEncrypted)
      if (!clinic.messengerPageId || !token) return reply.code(409).send({ ok: false, error: 'Messenger Page ID or token is missing' })
      return graphProbe(`${clinic.messengerPageId}?fields=id,name,access_token`, token)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/:id/instagram/test',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const token = readEncryptedToken(clinic.instagramPageAccessTokenEncrypted)
      if (!clinic.instagramAccountId || !token) return reply.code(409).send({ ok: false, error: 'Instagram account ID or token is missing' })
      return graphProbe(`${clinic.instagramAccountId}?fields=id,username,name`, token)
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/:id',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      // Encrypt Meta Page tokens at rest (the columns are named *_encrypted but the
      // values were stored in plaintext). Mirrors the doctors/calendar token pattern.
      const data = { ...parsed.data }
      if (data.messengerPageAccessToken) data.messengerPageAccessToken = encryptValue(data.messengerPageAccessToken)
      if (data.instagramPageAccessToken) data.instagramPageAccessToken = encryptValue(data.instagramPageAccessToken)
      const isStudioAdmin = request.user?.role === 'ia_studio_admin'
      const requestedJzelConfigChange = touchesJzelConfiguration(data.settings)
      const clinic = await withDb(async (sql) => {
        const repo = createClinicsRepository(sql)
        const existing = await repo.findById(clinicId)
        if (!existing) return null
        if (
          requestedJzelConfigChange &&
          request.user?.userId &&
          (await isJzelConfigurationLocked(sql, clinicId, request.user.userId))
        ) {
          return 'jzel-configuration-locked' as const
        }
        // Merge settings onto the existing blob instead of replacing it, so a PATCH
        // can't wipe license/credential keys it didn't include. Only ia_studio_admin
        // may set the protected license_key via the generic settings object.
        if (data.settings) {
          const incoming: Record<string, unknown> = { ...data.settings }
          if (!isStudioAdmin) delete incoming.license_key
          const current = (existing.settings as Record<string, unknown> | null | undefined) ?? {}
          if ('integrations' in incoming) {
            incoming.integrations = mergeIntegrationsPreservingSecrets(
              current.integrations,
              incoming.integrations,
            )
          }
          data.settings = { ...current, ...incoming }
        }
        const updated = await repo.update(clinicId, data)
        await createAuditRepository(sql).log({
          clinicId,
          actorId: request.user?.userId,
          actorEmail: request.user?.email,
          action: 'clinic.updated',
          resourceType: 'clinic',
          resourceId: clinicId,
          metadata: {
            changed: Object.keys(parsed.data),
            tokenFieldsChanged: ['messengerPageAccessToken', 'instagramPageAccessToken'].filter((key) => key in parsed.data),
          },
          ipAddress: request.ip,
        })
        return updated
      })
      if (clinic === 'jzel-configuration-locked') return reply.code(403).send(JZEL_CONFIGURATION_LOCKED)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { clinic: redactClinic(clinic) }
    },
  )

  app.get<{ Params: { id: string } }>('/:id/stats', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const stats = await withDb(async (sql) => {
      const conversations = createConversationsRepository(sql)
      const patients = createPatientsRepository(sql)
      const [activeConversations, patientRows] = await Promise.all([
        conversations.countActive(clinicId),
        patients.list(clinicId),
      ])
      const base = { activeConversations, totalPatients: patientRows.length }
      if (request.user!.role === 'ia_studio_admin') {
        return { ...base, activeClinics: await createClinicsRepository(sql).countActive() }
      }
      return base
    })
    return { stats }
  })

  // ── Team members (AssignPanel — Gap #12) ──
  app.get<{ Params: { id: string } }>('/:id/team', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const members = await withDb(async (sql) => createUsersRepository(sql).listWithRoles(clinicId))
    // Only expose the fields the assign UI needs — never the password hash.
    return {
      members: members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.email,
        status: m.status,
        role: m.role,
      })),
    }
  })
}

export default clinicsRoute
