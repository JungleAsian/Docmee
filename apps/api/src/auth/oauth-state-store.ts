import { createHash, randomBytes } from 'node:crypto'
import { Redis } from 'ioredis'

const PREFIX = 'auth:google-oauth-state:'
const DEFAULT_TTL_SECONDS = 10 * 60
const isTest = process.env['NODE_ENV'] === 'test'

export type GoogleOAuthStateBinding =
  | { flow: 'clinic'; clinicId: string; userId: string }
  | { flow: 'doctor'; clinicId: string; doctorId: string; userId: string }

const memory = new Map<string, { binding: GoogleOAuthStateBinding; expiresAt: number }>()
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

function keyOf(state: string): string {
  return PREFIX + createHash('sha256').update(state).digest('hex')
}

function parseBinding(value: string): GoogleOAuthStateBinding | null {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed['clinicId'] !== 'string' || typeof parsed['userId'] !== 'string') return null
    if (parsed['flow'] === 'clinic') {
      return { flow: 'clinic', clinicId: parsed['clinicId'], userId: parsed['userId'] }
    }
    if (parsed['flow'] === 'doctor' && typeof parsed['doctorId'] === 'string') {
      return { flow: 'doctor', clinicId: parsed['clinicId'], doctorId: parsed['doctorId'], userId: parsed['userId'] }
    }
    return null
  } catch {
    return null
  }
}

export async function issueGoogleOAuthState(
  binding: GoogleOAuthStateBinding,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const ttl = Math.max(1, Math.trunc(ttlSeconds))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = randomBytes(32).toString('base64url')
    const key = keyOf(state)
    if (isTest) {
      if (memory.has(key)) continue
      memory.set(key, { binding, expiresAt: Date.now() + ttl * 1000 })
      return state
    }
    const stored = await client().set(key, JSON.stringify(binding), 'EX', ttl, 'NX')
    if (stored === 'OK') return state
  }
  throw new Error('Unable to issue Google OAuth state')
}

export async function consumeGoogleOAuthState(state: string): Promise<GoogleOAuthStateBinding | null> {
  if (!state || state.length > 256) return null
  const key = keyOf(state)
  if (isTest) {
    const stored = memory.get(key)
    memory.delete(key)
    if (!stored || stored.expiresAt <= Date.now()) return null
    return stored.binding
  }
  const value = await client().eval(
    "local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]); end; return value",
    1,
    key,
  )
  return typeof value === 'string' ? parseBinding(value) : null
}

export function __resetGoogleOAuthStateStoreForTests(): void {
  memory.clear()
}
