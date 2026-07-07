// Patient routes (P08, extended P16 for the patient history view).
//   GET /patients/:id                (any authenticated user, own clinic)
//   GET /patients/:id/appointments   (any authenticated user, own clinic)
//   GET /patients/:id/conversations  (any authenticated user, own clinic — history)
//   GET /patients/:id/tags           (any authenticated user, own clinic — history)
//   GET /patients/:id/notes          (any authenticated user, own clinic — history)
//   GET /clinics/:id/patients        (clinic_admin, ia_studio_admin)
import type { FastifyPluginAsync } from 'fastify'
import {
  createPatientsRepository,
  createAppointmentsRepository,
  createConversationsRepository,
} from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const patientsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/patients/:id', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const patient = await withDb(async (sql) =>
      createPatientsRepository(sql).findById(clinicId, request.params.id),
    )
    if (!patient) return reply.code(404).send({ error: 'Patient not found' })
    return { patient }
  })

  // ── Appointment history for one patient (patient history view) ──
  app.get<{ Params: { id: string } }>('/patients/:id/appointments', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const appointments = await withDb(async (sql) => {
      const patient = await createPatientsRepository(sql).findById(clinicId, request.params.id)
      if (!patient) return null
      return createAppointmentsRepository(sql).listByPatient(clinicId, request.params.id)
    })
    if (appointments === null) return reply.code(404).send({ error: 'Patient not found' })
    return { appointments }
  })

  // ── Past + current conversations for one patient (read-only history) ──
  app.get<{ Params: { id: string } }>('/patients/:id/conversations', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const conversations = await withDb(async (sql) => {
      const patient = await createPatientsRepository(sql).findById(clinicId, request.params.id)
      if (!patient) return null
      return createConversationsRepository(sql).listByPatient(clinicId, request.params.id)
    })
    if (conversations === null) return reply.code(404).send({ error: 'Patient not found' })
    return { conversations }
  })

  // ── Tags linked to any of one patient's conversations (patient history view) ──
  app.get<{ Params: { id: string } }>('/patients/:id/tags', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const tags = await withDb(async (sql) => {
      const patient = await createPatientsRepository(sql).findById(clinicId, request.params.id)
      if (!patient) return null
      return createConversationsRepository(sql).listTagsForPatient(clinicId, request.params.id)
    })
    if (tags === null) return reply.code(404).send({ error: 'Patient not found' })
    return { tags }
  })

  // ── Internal notes across one patient's conversations (patient history view) ──
  app.get<{ Params: { id: string } }>('/patients/:id/notes', async (request, reply) => {
    const clinicId = resolveClinicScope(request)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const notes = await withDb(async (sql) => {
      const patient = await createPatientsRepository(sql).findById(clinicId, request.params.id)
      if (!patient) return null
      return createConversationsRepository(sql).listNotesForPatient(clinicId, request.params.id)
    })
    if (notes === null) return reply.code(404).send({ error: 'Patient not found' })
    return { notes }
  })

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/patients',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const patients = await withDb(async (sql) => createPatientsRepository(sql).list(clinicId))
      return { patients }
    },
  )
}

export default patientsRoute
