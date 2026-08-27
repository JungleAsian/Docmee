// Req 40: public client config. Exposes the server's feature-flag state (booleans
// only — never secrets) so the panel can show/hide gated surfaces such as the
// advanced analytics dashboard. Unauthenticated, like /health.
//   GET /config -> { features: { advancedAnalytics: boolean } }
import type { FastifyPluginAsync } from 'fastify'
import { getDocmeeExpansionFeatures, getFeatures } from '../lib/features.js'
import { verifyAccessToken } from '../auth/jwt.js'
import { resolveClinicScope } from '../lib/scope.js'

const configRoute: FastifyPluginAsync = async (app) => {
  app.get('/config', async (request) => {
    // Keep the route public for login/bootstrap callers, but use authenticated
    // clinic scope when available so clinic-specific rollout overrides reach the
    // active InboxOS session. Invalid/missing auth simply gets global defaults.
    const auth = request.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      try { request.user = verifyAccessToken(auth.slice(7)) } catch { /* anonymous config */ }
    }
    const clinicId = request.user ? resolveClinicScope(request) ?? undefined : undefined
    return { features: { ...getFeatures(), ...(await getDocmeeExpansionFeatures(clinicId)) } }
  })
}

export default configRoute
