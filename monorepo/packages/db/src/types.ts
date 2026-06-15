/** Minimal query surface shared by node-postgres and PGlite. */
export interface QueryResult<T> {
  rows: T[];
}

export interface Queryable {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

/** An exclusive connection that can be returned to its pool. */
export interface Connection extends Queryable {
  /** Run one or more statements with no parameters (for migrations/DDL). */
  exec(sql: string): Promise<void>;
  release(): void;
}

/** Supplies exclusive connections (pg Pool, or a serialized PGlite handle). */
export interface ConnectionProvider {
  acquire(): Promise<Connection>;
  end(): Promise<void>;
}

/** A transaction scoped to one clinic via RLS (`app.clinic_id`). */
export interface ClinicTx extends Queryable {
  readonly clinicId: string;
}

/**
 * The fixed allowlist of cross-tenant operations permitted through the audited
 * admin door (decision #1). Never arbitrary unscoped SQL.
 */
export type AdminOperation = "metrics_read" | "dlq_drain" | "ia_studio_read";

/** A transaction running under the admin carve-out. Every use is audited. */
export interface AdminTx extends Queryable {
  readonly operation: AdminOperation;
  readonly reason: string;
}

/** A privileged platform-write transaction (bootstrap/provisioning/unrouted log). */
export type PlatformTx = Queryable;
