// Req 30 (Multi-doctor): clinic services + per-doctor service assignment.
//
// Services are clinic-wide; each doctor is assigned the subset they offer. The
// booking flow then asks the patient which service they need and uses that
// service's duration as the appointment length.
//   GET    /clinics/:id/services                               (any auth, own clinic)
//   POST   /clinics/:id/services                               (clinic_admin, ia_studio_admin)
//   GET    /clinics/:id/doctors/:doctorId/services             (any auth, own clinic)
//   POST   /clinics/:id/doctors/:doctorId/services             (clinic_admin, ia_studio_admin)
//   DELETE /clinics/:id/doctors/:doctorId/services/:serviceId  (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  createAppointmentsRepository,
  createDoctorsRepository,
  createDoctorServicesRepository,
} from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const createServiceSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  durationMinutes: z.number().int().positive().max(480).optional(),
  price: z.number().nonnegative().optional(),
  currency: z.string().min(1).max(8).optional(),
})

const assignSchema = z.object({
  serviceId: z.string().uuid(),
})

const servicesRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/services', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const services = await withDb(async (sql) => createAppointmentsRepository(sql).listServices(clinicId))
    return { services }
  })

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/services',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createServiceSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const service = await withDb(async (sql) =>
        createAppointmentsRepository(sql).createService({ clinicId, ...parsed.data }),
      )
      return reply.code(201).send({ service })
    },
  )

  app.get<{ Params: { id: string; doctorId: string } }>(
    '/clinics/:id/doctors/:doctorId/services',
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const result = await withDb(async (sql) => {
        const doctor = await createDoctorsRepository(sql).findById(clinicId, request.params.doctorId)
        if (!doctor) return null
        return createDoctorServicesRepository(sql).listServicesForDoctor(clinicId, request.params.doctorId)
      })
      if (result === null) return reply.code(404).send({ error: 'Doctor not found' })
      return { services: result }
    },
  )

  app.post<{ Params: { id: string; doctorId: string } }>(
    '/clinics/:id/doctors/:doctorId/services',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(assignSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const result = await withDb(async (sql) => {
        const doctor = await createDoctorsRepository(sql).findById(clinicId, request.params.doctorId)
        if (!doctor) return { error: 'doctor' as const }
        // Only a service that belongs to this clinic may be assigned (the FK does
        // not enforce clinic scoping, so we check membership here).
        const services = await createAppointmentsRepository(sql).listServices(clinicId)
        if (!services.some((s) => s.id === parsed.data.serviceId)) return { error: 'service' as const }
        const repo = createDoctorServicesRepository(sql)
        await repo.assign(clinicId, request.params.doctorId, parsed.data.serviceId)
        return { services: await repo.listServicesForDoctor(clinicId, request.params.doctorId) }
      })
      if ('error' in result) {
        return reply.code(404).send({ error: result.error === 'doctor' ? 'Doctor not found' : 'Service not found' })
      }
      return reply.code(201).send(result)
    },
  )

  app.delete<{ Params: { id: string; doctorId: string; serviceId: string } }>(
    '/clinics/:id/doctors/:doctorId/services/:serviceId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await withDb(async (sql) =>
        createDoctorServicesRepository(sql).remove(clinicId, request.params.doctorId, request.params.serviceId),
      )
      return { deleted: true }
    },
  )
}

export default servicesRoute
