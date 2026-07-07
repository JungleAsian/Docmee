// Req 40: public client config. Exposes the server's feature-flag state (booleans
// only — never secrets) so the panel can show/hide gated surfaces such as the
// advanced analytics dashboard. Unauthenticated, like /health.
//   GET /config -> { features: { advancedAnalytics: boolean } }
import type { FastifyPluginAsync } from 'fastify'
import { getFeatures } from '../lib/features.js'

const configRoute: FastifyPluginAsync = async (app) => {
  app.get('/config', async () => {
    return { features: getFeatures() }
  })
}

export default configRoute
