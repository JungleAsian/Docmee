import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { toJson } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { validate } from '../lib/validate.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const createSchema = z.object({
  patientId: z.string().uuid().optional(),
  doctorId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  desiredFrom: z.string().datetime().optional(),
  desiredTo: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
})

const patchSchema = z.object({
  status: z.enum(['active', 'notified', 'booked', 'expired', 'cancelled']),
  metadata: z.record(z.unknown()).optional(),
})

const waitlistRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/clinics/:id/waitlist',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const rows = await withDb((sql) => sql`
        SELECT * FROM waitlist_entries
        WHERE clinic_id = ${clinicId}
          AND (${request.query.status ?? null}::text IS NULL OR status = ${request.query.status ?? null})
        ORDER BY created_at DESC
        LIMIT 200
      `)
      return { entries: rows }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/waitlist',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const rows = await withDb((sql) => sql`
        INSERT INTO waitlist_entries
          (clinic_id, patient_id, doctor_id, service_id, desired_from, desired_to, metadata)
        VALUES (
          ${clinicId},
          ${parsed.data.patientId ?? null},
          ${parsed.data.doctorId ?? null},
          ${parsed.data.serviceId ?? null},
          ${parsed.data.desiredFrom ?? null},
          ${parsed.data.desiredTo ?? null},
          ${sql.json(toJson(parsed.data.metadata ?? {}))}
        )
        RETURNING *
      `)
      return reply.code(201).send({ entry: rows[0] })
    },
  )

  app.patch<{ Params: { id: string; entryId: string } }>(
    '/clinics/:id/waitlist/:entryId',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const rows = await withDb((sql) => sql`
        UPDATE waitlist_entries
        SET status = ${parsed.data.status},
            metadata = CASE WHEN ${parsed.data.metadata !== undefined} THEN ${sql.json(toJson(parsed.data.metadata ?? {}))} ELSE metadata END,
            updated_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${request.params.entryId}
        RETURNING *
      `)
      if (!rows[0]) return reply.code(404).send({ error: 'Waitlist entry not found' })
      return { entry: rows[0] }
    },
  )
}

export default waitlistRoute
