// P18 (Gap #39): Advanced analytics. Resolution rate, conversation length, peak-hour
// heatmap, patient retention and bot effectiveness over a date range.
//   GET /clinics/:id/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD
//      (clinic_admin, ia_studio_admin — own clinic)
import type { FastifyPluginAsync } from 'fastify'
import { createClinicsRepository, createAnalyticsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { getFeatures } from '../lib/features.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Parse a YYYY-MM-DD query value to an ISO instant, or null if absent/invalid. */
function parseDate(value: string | undefined, endOfDay: boolean): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const analyticsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string }; Querystring: { from?: string; to?: string } }>(
    '/clinics/:id/analytics',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      // Req 40: the advanced analytics surface is gated behind a feature flag. When
      // disabled the route is invisible (404) regardless of role/clinic.
      if (!getFeatures().advancedAnalytics) {
        return reply.code(404).send({ error: 'Not found' })
      }

      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const now = Date.now()
      const to = parseDate(request.query.to, true) ?? new Date(now).toISOString()
      const from = parseDate(request.query.from, false) ?? new Date(now - 30 * DAY_MS).toISOString()

      const analytics = await withDb(async (sql) => {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        if (!clinic) return null
        return createAnalyticsRepository(sql).advanced(clinicId, from, to, clinic.timezone)
      })
      if (!analytics) return reply.code(404).send({ error: 'Clinic not found' })
      return { analytics, range: { from, to } }
    },
  )
}

export default analyticsRoute
