// Metrics routes (P16 — Gap #27). Aggregated activity for the clinic dashboard.
//   GET /clinics/:id/metrics?window=7|30|90  (clinic_admin, ia_studio_admin — own clinic)
import type { FastifyPluginAsync } from 'fastify'
import { createClinicsRepository, createMetricsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

// Req 17 (filters): the dashboard's period selector. A whitelist — not a free range —
// keeps the aggregate queries cheap and bounded; an unknown value falls back to 30 days.
const ALLOWED_WINDOWS = [7, 30, 90]
const DEFAULT_WINDOW = 30

function parseWindow(value: string | undefined): number {
  const n = Number(value)
  return ALLOWED_WINDOWS.includes(n) ? n : DEFAULT_WINDOW
}

const metricsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string }; Querystring: { window?: string } }>(
    '/clinics/:id/metrics',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const window = parseWindow(request.query.window)
      const metrics = await withDb(async (sql) => {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        if (!clinic) return null
        return createMetricsRepository(sql).dashboard(clinicId, clinic.timezone, window)
      })
      if (!metrics) return reply.code(404).send({ error: 'Clinic not found' })
      return { metrics, window }
    },
  )
}

export default metricsRoute
