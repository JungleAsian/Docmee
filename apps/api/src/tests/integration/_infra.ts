// Shared helpers for the P17 integration suite.
//
// Integration tests talk to a REAL local Redis + a REAL test Postgres (Supabase).
// They are opt-in: when the infrastructure is not reachable (the default in CI's
// headless gate and on a fresh checkout) the probes below return false and each
// suite is `describe.skipIf`-ped, so `pnpm test` stays green without Docker.
//
// To run them for real:
//   docker compose up -d           # postgres + redis
//   pnpm tool migrate run          # schema + RLS policies
//   DATABASE_URL=postgres://postgres:postgres@localhost:5432/docmee \
//   REDIS_URL=redis://localhost:6379 LLM_STUB=true pnpm --filter @docmee/api test
import { Redis } from 'ioredis'
import { connect } from 'node:net'
import { createServiceDbClient, type Sql } from '@docmee/db'

export const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
export const DATABASE_URL = process.env['DATABASE_URL'] ?? ''

/**
 * True when a TCP connection to the Redis host:port succeeds. Uses a raw socket
 * (not ioredis) so an absent Redis produces no noisy "error" events in the gate.
 */
export async function redisAvailable(): Promise<boolean> {
  let host = 'localhost'
  let port = 6379
  try {
    const url = new URL(REDIS_URL)
    host = url.hostname || host
    port = url.port ? Number(url.port) : port
  } catch {
    /* keep defaults */
  }
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (ok: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(1000)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

/** True when DATABASE_URL is set and a `SELECT 1` succeeds. */
export async function dbAvailable(): Promise<boolean> {
  if (!DATABASE_URL) return false
  const sql = createServiceDbClient({ url: DATABASE_URL })
  try {
    await sql`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await sql.end()
  }
}

/** Service-role client for test setup/teardown (bypasses RLS). */
export function serviceDb(): Sql {
  return createServiceDbClient({ url: DATABASE_URL })
}

/** Flush the BullMQ keyspace for the named queues so assertions start clean. */
export async function flushQueues(...queues: string[]): Promise<void> {
  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null })
  try {
    for (const name of queues) {
      const keys = await redis.keys(`bull:${name}:*`)
      if (keys.length) await redis.del(...keys)
    }
  } finally {
    redis.disconnect()
  }
}

/** Poll `fn` until it returns truthy or `timeoutMs` elapses. */
export async function waitFor<T>(fn: () => Promise<T> | T, timeoutMs = 5000, stepMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await fn()
    if (value) return value
    if (Date.now() > deadline) return value
    await new Promise((resolve) => setTimeout(resolve, stepMs))
  }
}
