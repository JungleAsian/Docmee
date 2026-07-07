import type { FastifyPluginAsync } from 'fastify'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createAuditRepository, createAppointmentsRepository, createDoctorsRepository, createKnowledgeRepository } from '@docmee/db'
import { toJson } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const AREA = ['knowledge', 'attributes', 'schedule', 'developer'] as const
const REVIEW_STATE = ['trusted', 'needs_review', 'stale', 'excluded', 'archived'] as const
const RISK = ['low', 'medium', 'high'] as const
const ATTR_SOURCE = ['ai', 'staff', 'system', 'import'] as const
const ATTR_EDITOR = ['ai', 'staff', 'admin', 'system'] as const
const VISIBILITY = ['clinic_staff', 'restricted', 'admin_only'] as const

const governancePatchSchema = z.object({
  owner: z.string().max(160).nullable().optional(),
  reviewState: z.enum(REVIEW_STATE).optional(),
  riskTier: z.enum(RISK).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  allowedEditor: z.string().max(80).nullable().optional(),
  source: z.string().max(80).nullable().optional(),
  lastReviewedAt: z.string().datetime().nullable().optional(),
  lastTrainedAt: z.string().datetime().nullable().optional(),
  lastTestedAt: z.string().datetime().nullable().optional(),
  secretState: z.string().max(80).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const attributePatchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  source: z.array(z.enum(ATTR_SOURCE)).optional(),
  allowedEditor: z.array(z.enum(ATTR_EDITOR)).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  lifecycle: z.string().max(1000).optional(),
  workflowUse: z.array(z.string().max(80)).optional(),
  sensitive: z.boolean().optional(),
  aiCollectable: z.boolean().optional(),
  active: z.boolean().optional(),
})

const tokenCreateSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().min(1).max(500),
  scopes: z.array(z.string().min(1).max(80)).default([]),
})

const webhookSchema = z.object({
  endpointUrl: z.string().url(),
  owner: z.string().min(1).max(160),
  purpose: z.string().min(1).max(500),
  events: z.array(z.string().min(1).max(100)).default([]),
  secretState: z.enum(['configured', 'missing', 'rotation_recommended']).default('missing'),
  active: z.boolean().default(true),
})

type Sql = Parameters<Parameters<typeof withDb>[0]>[0]

async function ensureSchema(sql: Sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS clinic_governance_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      area text NOT NULL,
      key text NOT NULL,
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      owner text,
      review_state text NOT NULL DEFAULT 'needs_review',
      risk_tier text NOT NULL DEFAULT 'medium',
      visibility text NOT NULL DEFAULT 'clinic_staff',
      source text,
      allowed_editor text,
      last_reviewed_at timestamptz,
      last_trained_at timestamptz,
      last_tested_at timestamptz,
      secret_state text,
      notes text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (clinic_id, area, key)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS clinic_custom_attributes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      key text NOT NULL,
      label text NOT NULL,
      source text[] NOT NULL DEFAULT '{}',
      allowed_editor text[] NOT NULL DEFAULT '{}',
      visibility text NOT NULL DEFAULT 'clinic_staff',
      lifecycle text NOT NULL DEFAULT '',
      workflow_use text[] NOT NULL DEFAULT '{}',
      sensitive boolean NOT NULL DEFAULT false,
      ai_collectable boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (clinic_id, key)
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS clinic_api_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      name text NOT NULL,
      purpose text NOT NULL,
      scopes text[] NOT NULL DEFAULT '{}',
      token_hash text NOT NULL,
      token_prefix text NOT NULL,
      status text NOT NULL DEFAULT 'active',
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      last_used_at timestamptz
    )
  `
  await sql`
    CREATE TABLE IF NOT EXISTS clinic_webhook_registry (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
      endpoint_url text NOT NULL,
      owner text NOT NULL,
      purpose text NOT NULL,
      events text[] NOT NULL DEFAULT '{}',
      secret_state text NOT NULL DEFAULT 'missing',
      active boolean NOT NULL DEFAULT true,
      last_tested_at timestamptz,
      last_success_at timestamptz,
      failure_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

const DEFAULT_ATTRIBUTES = [
  ['patient_type', 'Patient type', ['ai', 'staff', 'system'], ['ai', 'staff'], 'clinic_staff', 'new/existing patient context', ['routing', 'intake', 'analytics'], false, true],
  ['preferred_doctor', 'Preferred doctor', ['ai', 'staff'], ['ai', 'staff'], 'clinic_staff', 'booking preference', ['booking', 'inbox_filter'], false, true],
  ['service_reason', 'Service / reason', ['ai', 'staff'], ['ai', 'staff'], 'clinic_staff', 'appointment reason', ['booking', 'faq_relevance'], false, true],
  ['insurance_payment_note', 'Insurance / payment note', ['ai', 'staff', 'import'], ['staff'], 'restricted', 'captured only when needed', ['booking_preparation'], true, false],
  ['appointment_preference', 'Appointment preference', ['ai', 'staff'], ['ai', 'staff'], 'clinic_staff', 'slot suggestion preference', ['slot_suggestion'], false, true],
  ['language', 'Language', ['ai', 'staff', 'system'], ['ai', 'staff'], 'clinic_staff', 'patient communication language', ['messaging', 'templates'], false, true],
  ['consent_opt_in_state', 'Consent / opt-in state', ['system', 'staff'], ['admin', 'system'], 'restricted', 'messaging eligibility', ['messaging_eligibility'], true, false],
  ['urgency_safety_flag', 'Urgency / safety flag', ['ai', 'staff', 'system'], ['ai', 'staff', 'system'], 'restricted', 'patient safety escalation', ['alerts', 'handoff'], true, true],
  ['follow_up_status', 'Follow-up status', ['system', 'staff'], ['staff', 'system'], 'clinic_staff', 'follow-up lifecycle', ['reminders', 'reports'], false, false],
] as const

async function seedGovernance(sql: Sql, clinicId: string) {
  const records = [
    ['knowledge', 'source_review', 'AI training source review', 'Owner, freshness, review state, exclusion, and risk controls for assistant knowledge.', 'needs_review', 'high', 'restricted'],
    ['attributes', 'intake_attributes', 'Clinic custom attributes', 'Clinic-safe intake attributes mapped to source, editor, visibility, lifecycle, and workflow use.', 'needs_review', 'medium', 'restricted'],
    ['schedule', 'availability_hierarchy', 'Schedule consistency', 'Clinic hours, provider availability, support coverage, holiday closures, and slot-rule conflict checks.', 'needs_review', 'high', 'clinic_staff'],
    ['developer', 'tokens_webhooks', 'API token and webhook governance', 'Token lifecycle, webhook subscriptions, secret masking, owner, test date, and audit events.', 'needs_review', 'high', 'admin_only'],
  ] as const

  for (const r of records) {
    await sql`
      INSERT INTO clinic_governance_records
        (clinic_id, area, key, title, description, review_state, risk_tier, visibility)
      VALUES (${clinicId}, ${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, ${r[4]}, ${r[5]}, ${r[6]})
      ON CONFLICT (clinic_id, area, key) DO NOTHING
    `
  }
  for (const a of DEFAULT_ATTRIBUTES) {
    await sql`
      INSERT INTO clinic_custom_attributes
        (clinic_id, key, label, source, allowed_editor, visibility, lifecycle, workflow_use, sensitive, ai_collectable)
      VALUES (${clinicId}, ${a[0]}, ${a[1]}, ${a[2]}, ${a[3]}, ${a[4]}, ${a[5]}, ${a[6]}, ${a[7]}, ${a[8]})
      ON CONFLICT (clinic_id, key) DO NOTHING
    `
  }
}

function weekdayKeys(): string[] {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
}

function ranges(value: unknown): Array<{ start: string; end: string }> {
  return Array.isArray(value) ? value.filter((r) => r && typeof r.start === 'string' && typeof r.end === 'string') : []
}

function within(inner: { start: string; end: string }, outers: Array<{ start: string; end: string }>): boolean {
  return outers.some((outer) => inner.start >= outer.start && inner.end <= outer.end)
}

function buildScheduleWarnings(clinicSettings: Record<string, unknown>, doctors: Array<Record<string, unknown>>, services: Array<Record<string, unknown>>) {
  const warnings: Array<{ code: string; severity: 'warning' | 'critical'; message: string }> = []
  const businessHours = (clinicSettings['businessHours'] ?? clinicSettings['hours']) as Record<string, unknown> | undefined
  if (!businessHours || typeof businessHours !== 'object') {
    warnings.push({ code: 'missing_clinic_hours', severity: 'warning', message: 'Clinic business hours are not configured.' })
  }

  for (const doctor of doctors) {
    const name = String(doctor['name'] ?? 'Provider')
    const availableDays = (doctor['availableDays'] ?? {}) as Record<string, unknown>
    if (Object.keys(availableDays).some((key) => key.toLowerCase().includes('test'))) {
      warnings.push({ code: 'test_schedule_key', severity: 'critical', message: `${name} has a test/demo availability key active.` })
    }
    if (businessHours && typeof businessHours === 'object') {
      for (const day of weekdayKeys()) {
        const doctorRanges = ranges(availableDays[day])
        const clinicRanges = ranges(businessHours[day])
        for (const r of doctorRanges) {
          if (clinicRanges.length > 0 && !within(r, clinicRanges)) {
            warnings.push({ code: 'provider_outside_clinic_hours', severity: 'warning', message: `${name} has ${day} availability outside clinic hours.` })
          }
        }
      }
    }
  }
  if (doctors.length > 0 && services.length === 0) {
    warnings.push({ code: 'no_services', severity: 'critical', message: 'Providers exist but no bookable services are configured.' })
  }
  return warnings
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

const governanceRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/governance', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const result = await withDb(async (sql) => {
      await ensureSchema(sql)
      await seedGovernance(sql, clinicId)
      const [records, attributes, tokens, webhooks, docs, doctors, services, clinicRows] = await Promise.all([
        sql`SELECT * FROM clinic_governance_records WHERE clinic_id = ${clinicId} ORDER BY area, key`,
        sql`SELECT * FROM clinic_custom_attributes WHERE clinic_id = ${clinicId} ORDER BY key`,
        sql`SELECT id, name, purpose, scopes, token_prefix, status, created_by, created_at, revoked_at, last_used_at FROM clinic_api_tokens WHERE clinic_id = ${clinicId} ORDER BY created_at DESC`,
        sql`SELECT * FROM clinic_webhook_registry WHERE clinic_id = ${clinicId} ORDER BY created_at DESC`,
        createKnowledgeRepository(sql).listDocuments(clinicId),
        createDoctorsRepository(sql).listByClinic(clinicId),
        createAppointmentsRepository(sql).listServices(clinicId),
        sql`SELECT settings FROM clinics WHERE id = ${clinicId} LIMIT 1`,
      ])
      const scheduleWarnings = buildScheduleWarnings(
        (clinicRows[0]?.settings ?? {}) as Record<string, unknown>,
        doctors as unknown as Array<Record<string, unknown>>,
        services as unknown as Array<Record<string, unknown>>,
      )
      return {
        records,
        attributes,
        tokens,
        webhooks,
        knowledgeSources: docs.map((doc) => ({
          id: doc.id,
          title: doc.title,
          documentType: doc.documentType,
          status: doc.status,
          reviewState: typeof doc.metadata?.['governanceReviewState'] === 'string' ? doc.metadata['governanceReviewState'] : 'needs_review',
          owner: doc.metadata?.['governanceOwner'] ?? null,
          lastReviewedAt: doc.metadata?.['governanceLastReviewedAt'] ?? null,
          riskTier: doc.metadata?.['governanceRiskTier'] ?? (doc.documentType === 'policy' ? 'high' : 'medium'),
        })),
        scheduleWarnings,
        readiness: {
          knowledgeStale: docs.filter((doc) => ['needs_review', 'stale'].includes(String(doc.metadata?.['governanceReviewState'] ?? 'needs_review'))).length,
          excludedKnowledge: docs.filter((doc) => ['excluded', 'archived'].includes(String(doc.metadata?.['governanceReviewState'] ?? ''))).length,
          customAttributes: attributes.length,
          scheduleWarnings: scheduleWarnings.length,
          activeTokens: (tokens as unknown as Array<{ status: string }>).filter((t) => t.status === 'active').length,
          activeWebhooks: (webhooks as unknown as Array<{ active: boolean }>).filter((w) => w.active).length,
        },
      }
    })
    return result
  })

  app.patch<{ Params: { id: string; recordId: string } }>(
    '/clinics/:id/governance/:recordId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(governancePatchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const record = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          UPDATE clinic_governance_records SET
            owner = COALESCE(${parsed.data.owner ?? null}, owner),
            review_state = COALESCE(${parsed.data.reviewState ?? null}, review_state),
            risk_tier = COALESCE(${parsed.data.riskTier ?? null}, risk_tier),
            visibility = COALESCE(${parsed.data.visibility ?? null}, visibility),
            source = COALESCE(${parsed.data.source ?? null}, source),
            allowed_editor = COALESCE(${parsed.data.allowedEditor ?? null}, allowed_editor),
            last_reviewed_at = COALESCE(${parsed.data.lastReviewedAt ?? null}::timestamptz, last_reviewed_at),
            last_trained_at = COALESCE(${parsed.data.lastTrainedAt ?? null}::timestamptz, last_trained_at),
            last_tested_at = COALESCE(${parsed.data.lastTestedAt ?? null}::timestamptz, last_tested_at),
            secret_state = COALESCE(${parsed.data.secretState ?? null}, secret_state),
            notes = COALESCE(${parsed.data.notes ?? null}, notes),
            metadata = metadata || ${sql.json(toJson(parsed.data.metadata ?? {}))},
            updated_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${request.params.recordId}
          RETURNING *
        `
        if (rows[0]) {
          await createAuditRepository(sql).log({
            clinicId,
            actorId: request.user?.userId,
            actorEmail: request.user?.email,
            action: 'governance.updated',
            resourceType: 'governance_record',
            resourceId: request.params.recordId,
            metadata: { area: rows[0].area, key: rows[0].key, reviewState: rows[0].reviewState },
            ipAddress: request.ip,
          })
        }
        return rows[0] ?? null
      })
      if (!record) return reply.code(404).send({ error: 'Governance record not found' })
      return { record }
    },
  )

  app.patch<{ Params: { id: string; entryId: string } }>(
    '/clinics/:id/kb/:entryId/governance',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(governancePatchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const doc = await withDb(async (sql) => {
        const state = parsed.data.reviewState
        const metadata = {
          ...(state ? { governanceReviewState: state } : {}),
          ...(parsed.data.owner !== undefined ? { governanceOwner: parsed.data.owner } : {}),
          ...(parsed.data.lastReviewedAt !== undefined ? { governanceLastReviewedAt: parsed.data.lastReviewedAt } : {}),
          ...(parsed.data.riskTier !== undefined ? { governanceRiskTier: parsed.data.riskTier } : {}),
          ...(parsed.data.notes !== undefined ? { governanceNotes: parsed.data.notes } : {}),
        }
        const rows = await sql`
          UPDATE knowledge_documents
          SET metadata = metadata || ${sql.json(toJson(metadata))},
              status = CASE WHEN ${state ?? null} IN ('excluded', 'archived') THEN 'archived' ELSE status END
          WHERE clinic_id = ${clinicId} AND id = ${request.params.entryId}
          RETURNING *
        `
        if (rows[0]) {
          await createAuditRepository(sql).log({
            clinicId,
            actorId: request.user?.userId,
            actorEmail: request.user?.email,
            action: 'knowledge.governance_updated',
            resourceType: 'knowledge_document',
            resourceId: request.params.entryId,
            metadata: { reviewState: state },
            ipAddress: request.ip,
          })
        }
        return rows[0] ?? null
      })
      if (!doc) return reply.code(404).send({ error: 'Document not found' })
      return { document: doc }
    },
  )

  app.patch<{ Params: { id: string; attributeId: string } }>(
    '/clinics/:id/custom-attributes/:attributeId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(attributePatchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const attr = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          UPDATE clinic_custom_attributes SET
            label = COALESCE(${parsed.data.label ?? null}, label),
            source = COALESCE(${parsed.data.source ?? null}, source),
            allowed_editor = COALESCE(${parsed.data.allowedEditor ?? null}, allowed_editor),
            visibility = COALESCE(${parsed.data.visibility ?? null}, visibility),
            lifecycle = COALESCE(${parsed.data.lifecycle ?? null}, lifecycle),
            workflow_use = COALESCE(${parsed.data.workflowUse ?? null}, workflow_use),
            sensitive = COALESCE(${parsed.data.sensitive ?? null}, sensitive),
            ai_collectable = COALESCE(${parsed.data.aiCollectable ?? null}, ai_collectable),
            active = COALESCE(${parsed.data.active ?? null}, active),
            updated_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${request.params.attributeId}
          RETURNING *
        `
        return rows[0] ?? null
      })
      if (!attr) return reply.code(404).send({ error: 'Custom attribute not found' })
      return { attribute: attr }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/api-tokens',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(tokenCreateSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const token = `docmee_${randomBytes(24).toString('base64url')}`
      const created = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          INSERT INTO clinic_api_tokens (clinic_id, name, purpose, scopes, token_hash, token_prefix, created_by)
          VALUES (${clinicId}, ${parsed.data.name}, ${parsed.data.purpose}, ${parsed.data.scopes}, ${hashToken(token)}, ${token.slice(0, 14)}, ${request.user?.email ?? null})
          RETURNING id, name, purpose, scopes, token_prefix, status, created_by, created_at, revoked_at, last_used_at
        `
        await createAuditRepository(sql).log({
          clinicId,
          actorId: request.user?.userId,
          actorEmail: request.user?.email,
          action: 'api_token.created',
          resourceType: 'api_token',
          resourceId: rows[0].id,
          metadata: { name: parsed.data.name, scopes: parsed.data.scopes, tokenPrefix: token.slice(0, 14) },
          ipAddress: request.ip,
        })
        return rows[0]
      })
      return reply.code(201).send({ token, record: created })
    },
  )

  app.delete<{ Params: { id: string; tokenId: string } }>(
    '/clinics/:id/api-tokens/:tokenId',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const token = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          UPDATE clinic_api_tokens SET status = 'revoked', revoked_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${request.params.tokenId}
          RETURNING id, name, purpose, scopes, token_prefix, status, created_by, created_at, revoked_at, last_used_at
        `
        if (rows[0]) {
          await createAuditRepository(sql).log({
            clinicId,
            actorId: request.user?.userId,
            actorEmail: request.user?.email,
            action: 'api_token.revoked',
            resourceType: 'api_token',
            resourceId: request.params.tokenId,
            metadata: { tokenPrefix: rows[0].tokenPrefix },
            ipAddress: request.ip,
          })
        }
        return rows[0] ?? null
      })
      if (!token) return reply.code(404).send({ error: 'Token not found' })
      return { token }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/webhook-registry',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(webhookSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const webhook = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          INSERT INTO clinic_webhook_registry (clinic_id, endpoint_url, owner, purpose, events, secret_state, active)
          VALUES (${clinicId}, ${parsed.data.endpointUrl}, ${parsed.data.owner}, ${parsed.data.purpose}, ${parsed.data.events}, ${parsed.data.secretState}, ${parsed.data.active})
          RETURNING *
        `
        await createAuditRepository(sql).log({
          clinicId,
          actorId: request.user?.userId,
          actorEmail: request.user?.email,
          action: 'webhook_registry.created',
          resourceType: 'webhook',
          resourceId: rows[0].id,
          metadata: { endpointUrl: parsed.data.endpointUrl, events: parsed.data.events },
          ipAddress: request.ip,
        })
        return rows[0]
      })
      return reply.code(201).send({ webhook })
    },
  )

  app.post<{ Params: { id: string; webhookId: string } }>(
    '/clinics/:id/webhook-registry/:webhookId/test',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const webhook = await withDb(async (sql) => {
        await ensureSchema(sql)
        const rows = await sql`
          UPDATE clinic_webhook_registry SET last_tested_at = now(), updated_at = now()
          WHERE clinic_id = ${clinicId} AND id = ${request.params.webhookId}
          RETURNING *
        `
        if (rows[0]) {
          await createAuditRepository(sql).log({
            clinicId,
            actorId: request.user?.userId,
            actorEmail: request.user?.email,
            action: 'webhook_registry.tested',
            resourceType: 'webhook',
            resourceId: request.params.webhookId,
            metadata: { endpointUrl: rows[0].endpointUrl },
            ipAddress: request.ip,
          })
        }
        return rows[0] ?? null
      })
      if (!webhook) return reply.code(404).send({ error: 'Webhook not found' })
      return { webhook }
    },
  )
}

export default governanceRoute
