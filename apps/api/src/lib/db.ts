// Shared DB access for routes. CRE-57: a single long-lived pooled client is shared
// across requests. postgres.js already manages the underlying connection pool, so
// opening one client per request (and .end()-ing it in finally) only churned
// connections; reusing the pool removes that per-request connect/teardown cost.
import { createServiceDbClient } from '@docmee/db'
import type { Sql } from '@docmee/db'

let shared: Sql | null = null

export function hasDatabaseUrl(): boolean {
  return Boolean(process.env['DATABASE_URL']?.trim())
}

export function dbClient(): Sql {
  if (!shared) shared = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  return shared
}

/** Run `fn` with the shared pooled DB client (no per-call teardown). */
export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  return fn(dbClient())
}

/** Close the shared client. Wired to Fastify onClose for graceful shutdown. */
export async function closeDb(): Promise<void> {
  if (shared) {
    const s = shared
    shared = null
    await s.end()
  }
}
