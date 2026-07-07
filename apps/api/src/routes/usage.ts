// Usage routes (P11 — Admin Studio "Usage Dashboard" AI-cost section).
// Real per-clinic AI spend is recorded in ai_usage_events (cost_usd + tokens);
// these endpoints roll it up for the admin dashboard.
//   GET /clinics/:id/usage  (clinic_admin, ia_studio_admin — own clinic)
//   GET /usage/summary      (ia_studio_admin — every clinic)
import type { FastifyPluginAsync } from 'fastify'
import { createAiUsageRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const usageRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // Platform-wide breakdown (declared before /:id so it is not shadowed).
  app.get('/usage/summary', { preHandler: requireRole('ia_studio_admin') }, async () => {
    const clinics = await withDb(async (sql) => createAiUsageRepository(sql).summaryAllClinics())
    return { clinics }
  })

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/usage',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const usage = await withDb(async (sql) =>
        createAiUsageRepository(sql).summaryByClinic(clinicId),
      )
      return { usage }
    },
  )
}

export default usageRoute
