// P18 (Gap #32): Doctor management. Each clinic's doctors, each with their own
// Google Calendar + weekly availability. Managed in Admin Studio.
//   GET    /clinics/:id/doctors             (any authenticated user, own clinic)
//   POST   /clinics/:id/doctors             (clinic_admin, ia_studio_admin)
//   PATCH  /clinics/:id/doctors/:doctorId   (clinic_admin, ia_studio_admin)
//   DELETE /clinics/:id/doctors/:doctorId   (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createDoctorsRepository, type Doctor } from '@docmee/db'
import { encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

// Req 30: per-doctor working hours. Each weekday maps to a list of ordered HH:MM
// ranges; unknown keys / malformed times are rejected (400) so only a clean
// schedule reaches the DB. An absent weekday means the doctor is off that day.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')
const timeRange = z
  .object({ start: hhmm, end: hhmm })
  .refine((r) => r.start < r.end, { message: 'start must be before end' })
const availableDaysSchema = z
  .object({
    mon: z.array(timeRange).optional(),
    tue: z.array(timeRange).optional(),
    wed: z.array(timeRange).optional(),
    thu: z.array(timeRange).optional(),
    fri: z.array(timeRange).optional(),
    sat: z.array(timeRange).optional(),
    sun: z.array(timeRange).optional(),
  })
  .strict()

const createSchema = z.object({
  name: z.string().min(1),
  specialty: z.string().optional(),
  googleCalendarId: z.string().optional(),
  googleCalendarAccessToken: z.string().optional(),
  googleCalendarRefreshToken: z.string().optional(),
  availableDays: availableDaysSchema.optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  specialty: z.string().optional(),
  googleCalendarId: z.string().optional(),
  googleCalendarAccessToken: z.string().optional(),
  googleCalendarRefreshToken: z.string().optional(),
  availableDays: availableDaysSchema.optional(),
  isActive: z.boolean().optional(),
})

/** Never expose a doctor's encrypted calendar tokens to API clients. */
function redactDoctor(doctor: Doctor): Omit<
  Doctor,
  'googleCalendarAccessTokenEncrypted' | 'googleCalendarRefreshTokenEncrypted'
> & { calendarConnected: boolean } {
  const {
    googleCalendarAccessTokenEncrypted,
    googleCalendarRefreshTokenEncrypted,
    ...rest
  } = doctor
  return {
    ...rest,
    calendarConnected: Boolean(googleCalendarAccessTokenEncrypted && googleCalendarRefreshTokenEncrypted),
  }
}

const doctorsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/doctors', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const doctors = await withDb(async (sql) => createDoctorsRepository(sql).listByClinic(clinicId))
    return { doctors: doctors.map(redactDoctor) }
  })

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/doctors',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(createSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const doctor = await withDb(async (sql) =>
        createDoctorsRepository(sql).create({
          clinicId,
          name: parsed.data.name,
          specialty: parsed.data.specialty,
          googleCalendarId: parsed.data.googleCalendarId,
          googleCalendarAccessTokenEncrypted: parsed.data.googleCalendarAccessToken
            ? encryptValue(parsed.data.googleCalendarAccessToken)
            : undefined,
          googleCalendarRefreshTokenEncrypted: parsed.data.googleCalendarRefreshToken
            ? encryptValue(parsed.data.googleCalendarRefreshToken)
            : undefined,
          availableDays: parsed.data.availableDays,
        }),
      )
      return reply.code(201).send({ doctor: redactDoctor(doctor) })
    },
  )

  app.patch<{ Params: { id: string; doctorId: string } }>(
    '/clinics/:id/doctors/:doctorId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const doctor = await withDb(async (sql) => {
        const repo = createDoctorsRepository(sql)
        if (!(await repo.findById(clinicId, request.params.doctorId))) return null
        return repo.update(clinicId, request.params.doctorId, {
          name: parsed.data.name,
          specialty: parsed.data.specialty,
          googleCalendarId: parsed.data.googleCalendarId,
          googleCalendarAccessTokenEncrypted: parsed.data.googleCalendarAccessToken
            ? encryptValue(parsed.data.googleCalendarAccessToken)
            : undefined,
          googleCalendarRefreshTokenEncrypted: parsed.data.googleCalendarRefreshToken
            ? encryptValue(parsed.data.googleCalendarRefreshToken)
            : undefined,
          availableDays: parsed.data.availableDays,
          isActive: parsed.data.isActive,
        })
      })
      if (!doctor) return reply.code(404).send({ error: 'Doctor not found' })
      return { doctor: redactDoctor(doctor) }
    },
  )

  app.delete<{ Params: { id: string; doctorId: string } }>(
    '/clinics/:id/doctors/:doctorId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await withDb(async (sql) => createDoctorsRepository(sql).delete(clinicId, request.params.doctorId))
      return { deleted: true }
    },
  )
}

export default doctorsRoute
