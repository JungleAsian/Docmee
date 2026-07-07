// Refresh-token revocation store (P08).
// On logout a refresh token is blacklisted until its natural 7d expiry; /auth/refresh
// rejects any blacklisted token. Tokens are keyed by SHA-256 so the raw token is
// never stored. Backed by Redis in normal operation; an in-memory map is used under
// test (NODE_ENV=test) so the suite needs no live Redis.
import { createHash } from 'node:crypto'
import { Redis } from 'ioredis'

const PREFIX = 'auth:refresh:blacklist:'

function keyOf(token: string): string {
  return PREFIX + createHash('sha256').update(token).digest('hex')
}

const isTest = process.env['NODE_ENV'] === 'test'

// In-memory fallback: maps key → epoch-ms expiry. Lazily pruned on read.
const memory = new Map<string, number>()

let redis: Redis | null = null
function client(): Redis {
  if (!redis) {
    redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: true,
    })
  }
  return redis
}

/** Revoke a refresh token for `ttlSeconds` (its remaining lifetime). */
export async function blacklistRefreshToken(token: string, ttlSeconds: number): Promise<void> {
  const key = keyOf(token)
  if (isTest) {
    memory.set(key, Date.now() + ttlSeconds * 1000)
    return
  }
  await client().set(key, '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)))
}

/** True if the refresh token has been revoked. */
export async function isRefreshTokenBlacklisted(token: string): Promise<boolean> {
  const key = keyOf(token)
  if (isTest) {
    const expiry = memory.get(key)
    if (expiry === undefined) return false
    if (expiry <= Date.now()) {
      memory.delete(key)
      return false
    }
    return true
  }
  return (await client().exists(key)) === 1
}

/** Test helper — clears the in-memory blacklist between cases. */
export function __resetTokenStoreForTests(): void {
  memory.clear()
}

/**
 * CRE-58: liveness probe for the deep health check. In test (in-memory mode) we
 * report healthy without touching Redis; otherwise PING the shared client.
 */
export async function redisHealthy(): Promise<boolean> {
  if (isTest) return true
  try {
    const res = await client().ping()
    return res === 'PONG'
  } catch {
    return false
  }
}
