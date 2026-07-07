// Req 32 — Quality of Service monitoring. Service-quality signals for the clinic:
// upset patients, abandoned conversations, response times, unclosed conversations
// and follow-up opportunities, plus a "needs attention" list.
//   GET /clinics/:id/qos?staleHours=24  (clinic_admin, ia_studio_admin — own clinic)
import type { FastifyPluginAsync } from 'fastify'
import { createClinicsRepository, createQosRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const DEFAULT_STALE_HOURS = 24

/** Parse the staleHours query value, clamped to a sane 1–168h (one week) range. */
function parseStaleHours(value: string | undefined): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_STALE_HOURS
  return Math.min(168, Math.max(1, Math.floor(n)))
}

const qosRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string }; Querystring: { staleHours?: string } }>(
    '/clinics/:id/qos',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const staleHours = parseStaleHours(request.query.staleHours)

      const qos = await withDb(async (sql) => {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        if (!clinic) return null
        return createQosRepository(sql).dashboard(clinicId, staleHours)
      })
      if (!qos) return reply.code(404).send({ error: 'Clinic not found' })
      return { qos }
    },
  )
}

export default qosRoute
