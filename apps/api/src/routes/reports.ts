// Req 37 — Automatic reports. Lets a clinic admin read the scheduled reports the
// reports worker generates (the "panel" delivery channel alongside email).
//   GET /clinics/:id/reports             list (newest first, no html body)
//   GET /clinics/:id/reports/:reportId   one report incl. the rendered html
// clinic_admin / ia_studio_admin, own clinic only.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createClinicsRepository, createReportsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { validate } from '../lib/validate.js'

const reportSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  frequency: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
  recipients: z.array(z.string().email()).max(20).default([]),
  format: z.enum(['html', 'pdf', 'csv']).default('html'),
  hourLocal: z.number().int().min(0).max(23).default(8),
})

function readReportSettings(settings: Record<string, unknown>) {
  const parsed = reportSettingsSchema.safeParse(settings['reports'])
  return parsed.success ? parsed.data : reportSettingsSchema.parse({})
}

const reportsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/reports',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        if (!clinic) return null
        return createReportsRepository(sql).listByClinic(clinicId)
      })
      if (!result) return reply.code(404).send({ error: 'Clinic not found' })
      return { reports: result }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/reports/settings',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb((sql) => createClinicsRepository(sql).findById(clinicId))
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { settings: readReportSettings(clinic.settings) }
    },
  )

  app.patch<{ Params: { id: string } }>(
    '/clinics/:id/reports/settings',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(reportSettingsSchema.partial(), request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const clinic = await withDb(async (sql) => {
        const repo = createClinicsRepository(sql)
        const current = await repo.findById(clinicId)
        if (!current) return null
        const settings = {
          ...current.settings,
          reports: {
            ...readReportSettings(current.settings),
            ...parsed.data,
          },
        }
        return repo.update(clinicId, { settings })
      })
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { settings: readReportSettings(clinic.settings) }
    },
  )

  app.get<{ Params: { id: string; reportId: string } }>(
    '/clinics/:id/reports/:reportId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const report = await withDb((sql) =>
        createReportsRepository(sql).findById(clinicId, request.params.reportId),
      )
      if (!report) return reply.code(404).send({ error: 'Report not found' })
      return { report }
    },
  )
}

export default reportsRoute
