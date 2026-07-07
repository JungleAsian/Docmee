// Secretary-facing notification feed (P07 feed, P08 adds auth + clinic scoping).
//   GET  /notifications?clinic_id=X     → 50 most recent, newest first
//   POST /notifications/:id/acknowledge → mark acknowledged
import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { createNotificationsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth } from '../middleware/auth.js'

function isPlatformSuperuser(request: FastifyRequest): boolean {
  return (
    request.user?.role === 'ia_studio_admin' &&
    request.user.email.trim().toLowerCase() === 'docmeedev'
  )
}

const notificationsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Querystring: { clinic_id?: string } }>('/', async (request, reply) => {
    const platformSuperuser = isPlatformSuperuser(request)
    const platformWide = platformSuperuser && !request.query.clinic_id
    const clinicId = platformWide ? null : resolveClinicScope(request, request.query.clinic_id)
    if (!platformWide && clinicId === null) return reply.code(403).send({ error: 'Forbidden' })
    const notifications = await withDb(async (sql) =>
      platformWide
        ? createNotificationsRepository(sql).listAll(50)
        : createNotificationsRepository(sql).listByClinic(clinicId!, 50),
    )
    return { notifications }
  })

  app.post<{ Params: { id: string } }>('/:id/acknowledge', async (request, reply) => {
    const clinicId = isPlatformSuperuser(request) ? undefined : request.user?.clinicId
    if (clinicId === null || clinicId === '') return reply.code(403).send({ error: 'Forbidden' })
    const updated = await withDb(async (sql) =>
      createNotificationsRepository(sql).acknowledge(request.params.id, clinicId),
    )
    if (!updated) return reply.code(404).send({ error: 'Notification not found' })
    return { acknowledged: true, notification: updated }
  })
}

export default notificationsRoute
