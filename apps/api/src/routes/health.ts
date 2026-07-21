import type { FastifyPluginAsync } from 'fastify'
import { withDb } from '../lib/db.js'
import { redisHealthy } from '../auth/token-store.js'
import { releaseBuildId } from '@docmee/shared'

const healthRoute: FastifyPluginAsync = async (app) => {
  app.get('/health', async () => {
    return { ok: true, service: 'docmee-api', buildId: releaseBuildId() }
  })

  app.get('/heartbeat', async () => {
    return { ok: true, ts: new Date().toISOString(), buildId: releaseBuildId() }
  })

  // CRE-58: deep health — probe the critical dependencies so a load balancer or
  // uptime monitor can tell "process up" apart from "actually serving". Returns
  // 503 when any dependency is unreachable.
  app.get('/health/deep', async (_request, reply) => {
    const checks: Record<string, boolean> = { db: false, redis: false }
    try {
      await withDb(async (sql) => {
        await sql`SELECT 1`
      })
      checks.db = true
    } catch {
      checks.db = false
    }
    try {
      checks.redis = await redisHealthy()
    } catch {
      checks.redis = false
    }
    const ok = Object.values(checks).every(Boolean)
    reply.code(ok ? 200 : 503)
    return { ok, checks, ts: new Date().toISOString(), buildId: releaseBuildId() }
  })
}

export default healthRoute
