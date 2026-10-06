// Superuser change log (read side). Entries are written by the app-level hooks in
// lib/change-log.ts; this endpoint only lists them, newest first.
//   GET /change-log  (ia_studio_admin only)
//     ?clinic_id=<uuid>&area=<area>&outcome=succeeded|failed&q=<text>&before=<iso>&limit=<1-200>
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { createChangeLogRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { CHANGE_RULES } from '../lib/change-log.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const AREAS = [...new Set(CHANGE_RULES.map((rule) => rule.area))] as [string, ...string[]]

const querySchema = z.object({
  clinic_id: z.string().uuid().optional(),
  area: z.enum(AREAS).optional(),
  outcome: z.enum(['succeeded', 'failed']).optional(),
  q: z.string().trim().max(120).optional(),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
})

const changeLogRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get('/change-log', { preHandler: requireRole('ia_studio_admin') }, async (request, reply) => {
    const parsed = validate(querySchema, request.query, reply)
    if (!parsed.ok) return
    const { clinic_id, area, outcome, q, before, limit = 100 } = parsed.data
    const entries = await withDb((sql) =>
      createChangeLogRepository(sql).list({ clinicId: clinic_id, area, outcome, search: q, before, limit }),
    )
    const last = entries[entries.length - 1]
    return {
      entries,
      areas: AREAS,
      nextBefore: entries.length === limit && last ? new Date(last.createdAt).toISOString() : null,
    }
  })
}

export default changeLogRoute
