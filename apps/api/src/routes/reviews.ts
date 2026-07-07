// P18 (Gap #37): Review link redirector. Public (no auth) — the review-request
// worker sends patients a tracked link of the form /r/:followUpId. Visiting it
// stamps review_clicked and 302-redirects to the clinic's configured review URL.
//   GET /r/:followUpId
import type { FastifyPluginAsync } from 'fastify'
import { createFollowUpsRepository, createClinicsRepository } from '@docmee/db'
import { withDb } from '../lib/db.js'

const reviewsRoute: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { followUpId: string } }>('/r/:followUpId', async (request, reply) => {
    const target = await withDb(async (sql) => {
      const followUp = await createFollowUpsRepository(sql).markClicked(request.params.followUpId)
      if (!followUp) return null
      const clinic = await createClinicsRepository(sql).findById(followUp.clinicId)
      const link = (clinic?.settings as { reviewLink?: unknown } | undefined)?.reviewLink
      return typeof link === 'string' && link ? link : null
    })
    if (!target) return reply.code(404).send({ error: 'Review link not found' })
    return reply.redirect(302, target)
  })
}

export default reviewsRoute
