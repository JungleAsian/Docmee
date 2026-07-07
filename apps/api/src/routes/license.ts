// License routes (P11 — Admin Studio "License Management").
// A clinic's signed license key lives in clinics.settings.license_key (set by the
// licensekit service). These endpoints surface its decoded status to the admin
// panel and let an operator paste a new/renewed key.
//   GET  /clinics/:id/license  (clinic_admin, ia_studio_admin — own clinic)
//   POST /clinics/:id/license  (ia_studio_admin)
//
// NOTE: decoding here is display-only and does NOT verify the Ed25519 signature —
// that is licensekit's job (POST /validate + the heartbeat worker). Per THE ONE
// RULE, nothing here ever interrupts a live clinic; it only reports status.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createClinicsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const LICENSE_SETTINGS_KEY = 'license_key'

type LicenseState = 'none' | 'active' | 'expired' | 'invalid'

interface LicenseInfo {
  state: LicenseState
  clinicName?: string
  seats?: number
  issuedAt?: string
  expiresAt?: string
}

interface DecodedPayload {
  clinicName?: unknown
  seats?: unknown
  issuedAt?: unknown
  expiresAt?: unknown
}

/** Decode the base64 JSON payload of a `payload.signature` license key (no verify). */
function describeLicense(licenseKey: unknown): LicenseInfo {
  if (typeof licenseKey !== 'string' || licenseKey.length === 0) return { state: 'none' }
  const [b64] = licenseKey.split('.')
  if (!b64) return { state: 'invalid' }
  let payload: DecodedPayload
  try {
    payload = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as DecodedPayload
  } catch {
    return { state: 'invalid' }
  }
  const expiresAt = typeof payload.expiresAt === 'string' ? payload.expiresAt : undefined
  const expMs = expiresAt ? Date.parse(expiresAt) : NaN
  const state: LicenseState = Number.isNaN(expMs) ? 'invalid' : expMs <= Date.now() ? 'expired' : 'active'
  return {
    state,
    clinicName: typeof payload.clinicName === 'string' ? payload.clinicName : undefined,
    seats: typeof payload.seats === 'number' ? payload.seats : undefined,
    issuedAt: typeof payload.issuedAt === 'string' ? payload.issuedAt : undefined,
    expiresAt,
  }
}

const setSchema = z.object({ licenseKey: z.string().min(1) })

const licenseRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/license',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb(async (sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { license: describeLicense(clinic.settings[LICENSE_SETTINGS_KEY]) }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/license',
    { preHandler: requireRole('ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(setSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const info = describeLicense(parsed.data.licenseKey)
      if (info.state === 'invalid') {
        return reply.code(422).send({ error: 'License key is not a valid token' })
      }
      const clinic = await withDb(async (sql) => {
        const repo = createClinicsRepository(sql)
        const existing = await repo.findById(clinicId)
        if (!existing) return null
        // Merge so we never drop other settings (googleCalendar, businessHours, …).
        const settings = { ...existing.settings, [LICENSE_SETTINGS_KEY]: parsed.data.licenseKey }
        return repo.update(clinicId, { settings })
      })
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { license: describeLicense(clinic.settings[LICENSE_SETTINGS_KEY]) }
    },
  )
}

export default licenseRoute
