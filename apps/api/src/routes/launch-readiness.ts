import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { toJson } from '@docmee/db'
import { hasDatabaseUrl, withDb } from '../lib/db.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

interface LaunchWaiver {
  reviewer: string
  reason: string
  risk: string
  owner: string
  followUpDate: string
  createdAt: string
}

interface LaunchReadinessRecord {
  clinicId: string
  waivers: Record<string, LaunchWaiver>
  whatsappTests: Record<string, string>
  updatedAt: string
}

interface LaunchReadinessResponse {
  readiness: LaunchReadinessRecord
  persistence: 'database' | 'file'
}

interface LaunchReadinessEvent {
  id: string
  clinicId: string
  actorId: string | null
  actorEmail: string | null
  action: string
  field: string
  beforeValue: unknown
  afterValue: unknown
  createdAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function sanitizeWaivers(value: unknown): Record<string, LaunchWaiver> | null {
  if (value === undefined) return null
  if (!isRecord(value)) return null

  const waivers: Record<string, LaunchWaiver> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) return null
    const waiver = {
      reviewer: item['reviewer'],
      reason: item['reason'],
      risk: item['risk'],
      owner: item['owner'],
      followUpDate: item['followUpDate'],
      createdAt: item['createdAt'],
    }
    if (Object.values(waiver).some((field) => typeof field !== 'string')) return null
    waivers[key] = waiver as LaunchWaiver
  }
  return waivers
}

function sanitizeWhatsappTests(value: unknown): Record<string, string> | null {
  if (value === undefined) return null
  if (!isRecord(value)) return null

  const tests: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return null
    tests[key] = item
  }
  return tests
}

function normalizeJsonRecord<T extends Record<string, unknown>>(value: unknown): T {
  if (isRecord(value)) return value as T
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      if (isRecord(parsed)) return parsed as T
    } catch {
      return {} as T
    }
  }
  return {} as T
}

function toIsoTimestamp(value: unknown, fallback = new Date(0)): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === 'string' || typeof value === 'number'
        ? new Date(value)
        : fallback
  return Number.isNaN(date.getTime()) ? fallback.toISOString() : date.toISOString()
}

function dataDir(): string {
  return process.env['DOCMEE_RUNTIME_DATA_DIR']?.trim() || join(process.cwd(), '.runtime-data')
}

function fileFor(clinicId: string): string {
  return join(dataDir(), `launch-readiness-${clinicId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`)
}

async function readRecord(clinicId: string): Promise<LaunchReadinessRecord> {
  try {
    const raw = await readFile(fileFor(clinicId), 'utf8')
    const parsed = JSON.parse(raw) as Partial<LaunchReadinessRecord>
    return {
      clinicId,
      waivers: parsed.waivers ?? {},
      whatsappTests: parsed.whatsappTests ?? {},
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
    }
  } catch {
    return { clinicId, waivers: {}, whatsappTests: {}, updatedAt: new Date(0).toISOString() }
  }
}

async function writeRecord(record: LaunchReadinessRecord): Promise<LaunchReadinessRecord> {
  await mkdir(dataDir(), { recursive: true })
  const next = { ...record, updatedAt: new Date().toISOString() }
  await writeFile(fileFor(record.clinicId), JSON.stringify(next, null, 2))
  return next
}

function actor(request: FastifyRequest): { actorId: string | null; actorEmail: string | null } {
  const user = (request as FastifyRequest & { user?: { userId?: string; id?: string; email?: string } }).user
  return {
    actorId: user?.userId ?? user?.id ?? null,
    actorEmail: user?.email ?? null,
  }
}

async function ensureSchema() {
  await withDb(async (sql) => {
    await sql`
      CREATE TABLE IF NOT EXISTS clinic_launch_readiness (
        clinic_id uuid PRIMARY KEY REFERENCES clinics(id) ON DELETE CASCADE,
        waivers jsonb NOT NULL DEFAULT '{}'::jsonb,
        whatsapp_tests jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`
      CREATE TABLE IF NOT EXISTS clinic_launch_readiness_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
        actor_id text,
        actor_email text,
        action text NOT NULL,
        field text NOT NULL,
        before_value jsonb,
        after_value jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `
    await sql`
      CREATE INDEX IF NOT EXISTS clinic_launch_readiness_events_clinic_created_idx
        ON clinic_launch_readiness_events (clinic_id, created_at DESC)
    `
  })
}

async function readDbRecord(clinicId: string): Promise<LaunchReadinessRecord> {
  await ensureSchema()
  return withDb(async (sql) => {
    const rows = await sql<
      Array<{
        clinic_id?: string
        clinicId?: string
        waivers: Record<string, LaunchWaiver>
        whatsapp_tests?: Record<string, string>
        whatsappTests?: Record<string, string>
        updated_at?: string | Date
        updatedAt?: string | Date
      }>
    >`
      SELECT clinic_id, waivers, whatsapp_tests, updated_at
      FROM clinic_launch_readiness
      WHERE clinic_id = ${clinicId}
      LIMIT 1
    `
    const row = rows[0]
    return {
      clinicId,
      waivers: normalizeJsonRecord<Record<string, LaunchWaiver>>(row?.waivers),
      whatsappTests: normalizeJsonRecord<Record<string, string>>(row?.whatsapp_tests ?? row?.whatsappTests),
      updatedAt: row?.updated_at || row?.updatedAt ? toIsoTimestamp(row.updated_at ?? row.updatedAt) : new Date(0).toISOString(),
    }
  })
}

async function readDbEvents(clinicId: string): Promise<LaunchReadinessEvent[]> {
  await ensureSchema()
  return withDb(async (sql) => {
    const rows = await sql<
      Array<{
        id: string
        clinic_id?: string
        clinicId?: string
        actor_id?: string | null
        actorId?: string | null
        actor_email?: string | null
        actorEmail?: string | null
        action: string
        field: string
        before_value?: unknown
        beforeValue?: unknown
        after_value?: unknown
        afterValue?: unknown
        created_at?: string | Date
        createdAt?: string | Date
      }>
    >`
      SELECT id, clinic_id, actor_id, actor_email, action, field, before_value, after_value, created_at
      FROM clinic_launch_readiness_events
      WHERE clinic_id = ${clinicId}
      ORDER BY created_at DESC
      LIMIT 25
    `
    return rows.map((row) => ({
      id: row.id,
      clinicId: row.clinic_id ?? row.clinicId ?? clinicId,
      actorId: row.actor_id ?? row.actorId ?? null,
      actorEmail: row.actor_email ?? row.actorEmail ?? null,
      action: row.action,
      field: row.field,
      beforeValue: row.before_value ?? row.beforeValue,
      afterValue: row.after_value ?? row.afterValue,
      createdAt: toIsoTimestamp(row.created_at ?? row.createdAt),
    }))
  })
}

async function writeDbRecord({
  clinicId,
  waivers,
  whatsappTests,
  request,
}: {
  clinicId: string
  waivers?: Record<string, LaunchWaiver>
  whatsappTests?: Record<string, string>
  request: FastifyRequest
}): Promise<LaunchReadinessRecord> {
  await ensureSchema()
  return withDb(async (sql) => {
    const current = await readDbRecord(clinicId)
    const nextWaivers = waivers ?? current.waivers
    const nextWhatsappTests = whatsappTests ?? current.whatsappTests
    const rows = await sql<
      Array<{
        clinic_id?: string
        clinicId?: string
        waivers: Record<string, LaunchWaiver>
        whatsapp_tests?: Record<string, string>
        whatsappTests?: Record<string, string>
        updated_at?: string | Date
        updatedAt?: string | Date
      }>
    >`
      INSERT INTO clinic_launch_readiness (clinic_id, waivers, whatsapp_tests)
      VALUES (${clinicId}, ${sql.json(toJson(nextWaivers))}, ${sql.json(toJson(nextWhatsappTests))})
      ON CONFLICT (clinic_id) DO UPDATE SET
        waivers = EXCLUDED.waivers,
        whatsapp_tests = EXCLUDED.whatsapp_tests,
        updated_at = now()
      RETURNING clinic_id, waivers, whatsapp_tests, updated_at
    `
    const { actorId, actorEmail } = actor(request)
    if (waivers !== undefined) {
      await sql`
        INSERT INTO clinic_launch_readiness_events
          (clinic_id, actor_id, actor_email, action, field, before_value, after_value)
        VALUES
          (${clinicId}, ${actorId}, ${actorEmail}, 'launch_readiness.updated', 'waivers', ${sql.json(toJson(current.waivers))}, ${sql.json(toJson(nextWaivers))})
      `
    }
    if (whatsappTests !== undefined) {
      await sql`
        INSERT INTO clinic_launch_readiness_events
          (clinic_id, actor_id, actor_email, action, field, before_value, after_value)
        VALUES
          (${clinicId}, ${actorId}, ${actorEmail}, 'launch_readiness.updated', 'whatsapp_tests', ${sql.json(toJson(current.whatsappTests))}, ${sql.json(toJson(nextWhatsappTests))})
      `
    }
    const row = rows[0]
    return {
      clinicId,
      waivers: normalizeJsonRecord<Record<string, LaunchWaiver>>(row?.waivers),
      whatsappTests: normalizeJsonRecord<Record<string, string>>(row?.whatsapp_tests ?? row?.whatsappTests),
      updatedAt: row?.updated_at || row?.updatedAt ? toIsoTimestamp(row.updated_at ?? row.updatedAt, new Date()) : new Date().toISOString(),
    }
  })
}

async function readReadiness(clinicId: string): Promise<LaunchReadinessResponse> {
  if (hasDatabaseUrl()) {
    try {
      return { readiness: await readDbRecord(clinicId), persistence: 'database' }
    } catch (error) {
      console.warn('launch_readiness_db_read_failed', error)
    }
  }
  return { readiness: await readRecord(clinicId), persistence: 'file' }
}

async function writeReadiness({
  clinicId,
  waivers,
  whatsappTests,
  request,
}: {
  clinicId: string
  waivers?: Record<string, LaunchWaiver>
  whatsappTests?: Record<string, string>
  request: FastifyRequest
}): Promise<LaunchReadinessResponse> {
  if (hasDatabaseUrl()) {
    try {
      return {
        readiness: await writeDbRecord({ clinicId, waivers, whatsappTests, request }),
        persistence: 'database',
      }
    } catch (error) {
      console.warn('launch_readiness_db_write_failed', error)
    }
  }
  const current = await readRecord(clinicId)
  return {
    readiness: await writeRecord({
      clinicId,
      waivers: waivers ?? current.waivers,
      whatsappTests: whatsappTests ?? current.whatsappTests,
      updatedAt: current.updatedAt,
    }),
    persistence: 'file',
  }
}

const launchReadinessRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get(
    '/clinics/:clinicId/launch-readiness',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request) => {
      const { clinicId } = request.params as { clinicId: string }
      return readReadiness(clinicId)
    },
  )

  app.put(
    '/clinics/:clinicId/launch-readiness',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const { clinicId } = request.params as { clinicId: string }
      const body = request.body
      if (!isRecord(body)) {
        return reply.code(400).send({ error: 'invalid_launch_readiness_payload' })
      }
      const waivers = sanitizeWaivers(body['waivers'])
      const whatsappTests = sanitizeWhatsappTests(body['whatsappTests'])
      if ((body['waivers'] !== undefined && waivers === null) || (body['whatsappTests'] !== undefined && whatsappTests === null)) {
        return reply.code(400).send({ error: 'invalid_launch_readiness_payload' })
      }
      return writeReadiness({
        clinicId,
        waivers: waivers ?? undefined,
        whatsappTests: whatsappTests ?? undefined,
        request,
      })
    },
  )

  app.get(
    '/clinics/:clinicId/launch-readiness/events',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request) => {
      const { clinicId } = request.params as { clinicId: string }
      if (!hasDatabaseUrl()) return { events: [], persistence: 'file' }
      try {
        return { events: await readDbEvents(clinicId), persistence: 'database' }
      } catch (error) {
        console.warn('launch_readiness_db_events_failed', error)
        return { events: [], persistence: 'file' }
      }
    },
  )
}

export default launchReadinessRoute
