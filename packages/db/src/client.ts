// Only file permitted to import the postgres driver (enforced by ESLint no-direct-postgres rule).
// All other packages must go through @docmee/db boundary functions.

import postgres from 'postgres'

export type Sql   = postgres.Sql
export type TxSql = postgres.TransactionSql

/**
 * Cast a JSON-serializable object to the type postgres.js sql.json() expects.
 * postgres.js's internal JSONValue type is stricter than Record<string, unknown>;
 * this helper contains the single `as any` escape hatch needed across all repositories.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const toJson = (obj: Record<string, unknown> | readonly unknown[]): any => obj

/**
 * Returns a postgres.js client for clinic-scoped (RLS-enforced) operations.
 * Wrap queries with withClinicContext to set app.clinic_id before they execute.
 */
export function createDbClient(config: { url: string }): Sql {
  return postgres(config.url, {
    prepare: false,
    transform: postgres.camel,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  })
}

/**
 * Returns a postgres.js client that bypasses Row Level Security.
 * Reserved for: migrations, seed scripts, background workers that own the full dataset.
 * Never expose this client to untrusted code paths.
 */
export function createServiceDbClient(config: { url: string }): Sql {
  return postgres(config.url, {
    prepare: false,
    transform: postgres.camel,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
  })
}

/**
 * Wraps a callback in a transaction with app.clinic_id set so RLS policies fire.
 * Use this whenever the app layer needs to enforce clinic isolation at the DB level.
 */
export async function withClinicContext<T>(
  sql: Sql,
  clinicId: string,
  fn: (tx: TxSql) => Promise<T>,
): Promise<T> {
  // sql.begin() return type is UnwrapPromiseArray<T>; cast needed for promise unwrapping
  return (sql.begin(async (tx) => {
    await tx`SELECT set_config('app.clinic_id', ${clinicId}, true)`
    return fn(tx)
  }) as unknown as Promise<T>)
}
