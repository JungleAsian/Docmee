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

  app.get<{ Params: { id: string } }>('/clinics/:id/automation-health', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const health = await withDb(async (sql) => {
      const rows = await sql<Array<{
        doctorsWithoutServices: number
        doctorsWithoutCalendar: number
        unsentFollowUps: number
        openMetaErrors: number
        reviewEnabled: boolean
        reviewLink: string
      }>>`
        SELECT
          (
            SELECT COUNT(*)::int
            FROM doctors d
            WHERE d.clinic_id = c.id
              AND d.is_active = TRUE
              AND NOT EXISTS (
                SELECT 1
                FROM doctor_services ds
                JOIN services s ON s.id = ds.service_id
                WHERE ds.clinic_id = c.id
                  AND ds.doctor_id = d.id
                  AND s.is_active = TRUE
              )
          ) AS doctors_without_services,
          (
            SELECT COUNT(*)::int
            FROM doctors d
            WHERE d.clinic_id = c.id
              AND d.is_active = TRUE
              AND EXISTS (
                SELECT 1
                FROM doctor_services ds
                JOIN services s ON s.id = ds.service_id
                WHERE ds.clinic_id = c.id
                  AND ds.doctor_id = d.id
                  AND s.is_active = TRUE
              )
              AND NOT (
                (
                  NULLIF(d.google_calendar_access_token_encrypted, '') IS NOT NULL
                  AND NULLIF(d.google_calendar_refresh_token_encrypted, '') IS NOT NULL
                )
                OR (
                  NULLIF(c.settings #>> '{googleCalendar,accessToken}', '') IS NOT NULL
                  AND NULLIF(c.settings #>> '{googleCalendar,refreshToken}', '') IS NOT NULL
                )
              )
          ) AS doctors_without_calendar,
          (
            SELECT COUNT(*)::int
            FROM follow_ups f
            WHERE f.clinic_id = c.id
              AND f.status IN ('pending', 'pending_approval')
          ) AS unsent_follow_ups,
          (
            SELECT COUNT(*)::int
            FROM error_reviews e
            WHERE e.clinic_id = c.id
              AND e.status IN ('open', 'reviewed')
              AND (
                e.error_type LIKE 'meta_%'
                OR e.error_type LIKE 'whatsapp_%'
                OR e.error_type = 'provider_acceptance_persistence_failure'
              )
          ) AS open_meta_errors,
          COALESCE((c.settings #>> '{automations,reviewRequest,enabled}')::boolean, TRUE) AS review_enabled,
          COALESCE(c.settings ->> 'reviewLink', '') AS review_link
        FROM clinics c
        WHERE c.id = ${clinicId}
      `
      return rows[0] ?? null
    })
    if (!health) return reply.code(404).send({ error: 'Clinic not found' })

    const issues = [
      ...(health.doctorsWithoutServices > 0
        ? [{ code: 'doctor_services_disabled', count: health.doctorsWithoutServices, message: `${health.doctorsWithoutServices} active doctor(s) have no enabled services.` }]
        : []),
      ...(health.doctorsWithoutCalendar > 0
        ? [{ code: 'doctor_calendar_missing', count: health.doctorsWithoutCalendar, message: `${health.doctorsWithoutCalendar} bookable doctor(s) have no usable doctor or clinic calendar connection.` }]
        : []),
      ...(health.reviewEnabled && !health.reviewLink.trim()
        ? [{ code: 'review_link_missing', count: 1, message: 'Review requests are configured but no review link is set.' }]
        : []),
      ...(health.unsentFollowUps > 0
        ? [{ code: 'follow_ups_unsent', count: health.unsentFollowUps, message: `${health.unsentFollowUps} follow-up(s) are still unsent.` }]
        : []),
      ...(health.openMetaErrors > 0
        ? [{ code: 'meta_sync_errors_open', count: health.openMetaErrors, message: `${health.openMetaErrors} unresolved Meta/WhatsApp error(s) remain.` }]
        : []),
    ]
    return {
      state: issues.length === 0 ? 'ready' : 'attention',
      issues,
      checkedAt: new Date().toISOString(),
    }
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
