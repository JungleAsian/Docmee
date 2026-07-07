// Rev 2 — Approval node API. When a clinic requires sign-off for a follow-up type,
// the worker drafts the message and parks it as `pending_approval`. A secretary
// reviews the queue and approves (re-enqueues the send job — the worker re-runs
// every consent/window/anti-spam re-check) or rejects it (never sends).
//   GET  /clinics/:id/follow-ups         (recent activity)
//   GET  /clinics/:id/follow-ups/pending
//   POST /clinics/:id/follow-ups/:followUpId/approve
//   POST /clinics/:id/follow-ups/:followUpId/reject
import type { FastifyPluginAsync } from 'fastify'
import { createFollowUpsRepository } from '@docmee/db'
import { followUpQueue } from '@docmee/queue'
import { withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth } from '../middleware/auth.js'

const followUpsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { id: string } }>('/clinics/:id/follow-ups', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const rows = await withDb(async (sql) => createFollowUpsRepository(sql).listByClinic(clinicId))
    const followUps = rows.slice(0, 25).map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      patientId: r.patientId,
      appointmentId: r.appointmentId,
      reviewSentAt: r.reviewSentAt,
      reviewClickedAt: r.reviewClickedAt,
      createdAt: r.createdAt,
    }))
    return { followUps }
  })

  app.get<{ Params: { id: string } }>('/clinics/:id/follow-ups/pending', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const rows = await withDb(async (sql) => createFollowUpsRepository(sql).listPendingApprovals(clinicId))
    const pending = rows.map((r) => ({
      id: r.id,
      type: r.type,
      patientId: r.patientId,
      draft: (r.metadata as { draft?: string }).draft ?? '',
      createdAt: r.createdAt,
    }))
    return { pending }
  })

  app.post<{ Params: { id: string; followUpId: string } }>(
    '/clinics/:id/follow-ups/:followUpId/approve',
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const row = await withDb(async (sql) => createFollowUpsRepository(sql).findById(clinicId, request.params.followUpId))
      if (!row || row.status !== 'pending_approval') return reply.code(404).send({ error: 'No pending follow-up' })
      const job = (row.metadata as { job?: Record<string, unknown> }).job
      if (!job) return reply.code(409).send({ error: 'Draft is missing its job payload' })
      // Re-enqueue the original job; the worker re-runs all safety re-checks before
      // sending and claims this row atomically (so a double-approve never double-sends).
      await followUpQueue.add('send', { ...job, approved: true, followUpId: row.id })
      return { approved: true }
    },
  )

  app.post<{ Params: { id: string; followUpId: string } }>(
    '/clinics/:id/follow-ups/:followUpId/reject',
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      await withDb(async (sql) => createFollowUpsRepository(sql).reject(clinicId, request.params.followUpId))
      return { rejected: true }
    },
  )
}

export default followUpsRoute
