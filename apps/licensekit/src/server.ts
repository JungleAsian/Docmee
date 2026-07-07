import 'dotenv/config'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createServiceDbClient, createClinicsRepository } from '@docmee/db'
import { generateLicenseKey, parseLicenseKey, type LicensePayload } from './license-key.js'
import type { LicenseState } from './validator.js'

const VERSION = '0.1.0'

// A clinic's signed license key lives in clinics.settings under this key.
export const LICENSE_SETTINGS_KEY = 'license_key'

const PORT = Number(process.env['LICENSEKIT_PORT'] ?? process.env['LICENSE_PORT']) || 3002
const PUBLIC_KEY = process.env['LICENSE_PUBLIC_KEY'] ?? ''
const PRIVATE_KEY = process.env['LICENSE_PRIVATE_KEY'] ?? ''
const ADMIN_KEY = process.env['LICENSE_ADMIN_KEY'] ?? ''

/** Resolve a license key string into a license state (valid | expired | invalid). */
export function stateForKey(licenseKey: string | null | undefined, publicKeyPem: string): LicenseState {
  if (!licenseKey) return 'invalid'
  const payload = parseLicenseKey(licenseKey, publicKeyPem)
  if (!payload) return 'invalid'
  return Date.parse(payload.expiresAt) <= Date.now() ? 'expired' : 'valid'
}

function requireAdminKey(request: FastifyRequest, reply: FastifyReply): void {
  if (!ADMIN_KEY || request.headers['x-admin-key'] !== ADMIN_KEY) {
    reply.code(403).send({ error: 'Forbidden' })
  }
}

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: process.env['NODE_ENV'] !== 'test' })

  // POST /validate — report a clinic's current license state.
  // NOTE: this is advisory. Enforcement (enforceLicenseGate) only ever blocks NEW
  // clinic activations; a running clinic is never interrupted by this result.
  app.post('/validate', async (request, reply) => {
    const body = z.object({ clinicId: z.string().uuid() }).safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'clinicId (uuid) is required' })

    const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
    try {
      const clinic = await createClinicsRepository(sql).findById(body.data.clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const licenseKey = clinic.settings[LICENSE_SETTINGS_KEY]
      const state = stateForKey(typeof licenseKey === 'string' ? licenseKey : null, PUBLIC_KEY)
      return reply.send({ state })
    } finally {
      await sql.end()
    }
  })

  // POST /generate — admin: mint a new license key.
  app.post('/generate', { preHandler: requireAdminKey }, async (request, reply) => {
    const body = z
      .object({
        clinicName: z.string().min(1),
        seats: z.number().int().min(1),
        days: z.number().int().min(1),
      })
      .safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'clinicName, seats, days are required' })
    if (!PRIVATE_KEY) return reply.code(500).send({ error: 'LICENSE_PRIVATE_KEY is not configured' })

    const { clinicName, seats, days } = body.data
    const issuedAt = new Date().toISOString()
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
    const payload: LicensePayload = { clinicName, seats, expiresAt, issuedAt, licenseId: randomUUID() }
    const licenseKey = generateLicenseKey(payload, PRIVATE_KEY)
    return reply.send({ licenseKey, expiresAt })
  })

  app.get('/health', async () => ({ status: 'ok', service: 'docmee-licensekit', version: VERSION }))

  return app
}

// Only start listening when run directly (not when imported by tests).
if (process.env['NODE_ENV'] !== 'test') {
  const app = buildServer()
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
