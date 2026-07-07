// Auth + RBAC middleware (P08). requireAuth verifies the bearer access token and
// attaches the decoded payload to request.user; requireRole gates a handler to a
// set of panel roles. Register as Fastify preHandlers.
import type { FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../auth/jwt.js'
import type { JwtPayload } from '../auth/jwt.js'

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token' })
  }
  try {
    request.user = verifyAccessToken(authHeader.slice(7))
  } catch {
    return reply.code(401).send({ error: 'Invalid token' })
  }
}

export function requireRole(...roles: JwtPayload['role'][]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) return reply.code(401).send({ error: 'Unauthorized' })
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }
  }
}

// Attach the decoded JWT to the request type so handlers see request.user.
declare module 'fastify' {
  interface FastifyRequest {
    user?: import('../auth/jwt.js').JwtPayload
  }
}
