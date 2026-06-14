/**
 * @docmee/db — Supabase/Postgres data-access layer. OWNER: Prime. Migrations append-only.
 *
 * Phase-0 contract (declared now, implemented when infra X6 lands):
 *  - G2 RLS chokepoint: `withClinicContext(clinicId, fn)` opens a tx, runs
 *    `SET LOCAL app.clinic_id = <clinicId>`, and yields a tx handle. The raw pool
 *    stays PRIVATE to this package and is never exported.
 *  - Decision #1: a single audited `withAdminContext()` is the only cross-tenant door.
 *
 * This file currently exposes only the TYPES so the rest of the backend can be
 * written against the seam; the runtime lands in Phase 0.
 */

/** A transaction handle scoped to one clinic via RLS (`app.clinic_id`). */
export interface ClinicTx {
  readonly clinicId: string;
  /** Parameterized query within the clinic-scoped transaction. */
  query<T = unknown>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

/** The RLS chokepoint (G2). Implemented in Phase 0. */
export type WithClinicContext = <T>(
  clinicId: string,
  fn: (tx: ClinicTx) => Promise<T>,
) => Promise<T>;

/** True when a live Postgres is configured (gates integration tests until X6). */
export function isLiveDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}
