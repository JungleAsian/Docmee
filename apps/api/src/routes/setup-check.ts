// Clinic setup check (read side). Lists the configuration and live-workflow
// problems that currently affect what patients get, so the panel can show them.
// The same check runs after every configuration change (lib/change-log.ts) and
// notifies admins about new problems.
//   GET /clinics/:id/setup-check  (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import { resolveClinicScope } from '../lib/scope.js'
import { runSetupCheck } from '../lib/setup-check.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const setupCheckRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/setup-check',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const issues = await runSetupCheck(clinicId)
      return { issues, checkedAt: new Date().toISOString() }
    },
  )
}

export default setupCheckRoute
