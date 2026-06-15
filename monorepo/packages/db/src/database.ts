import type {
  AdminOperation,
  AdminTx,
  ClinicTx,
  Connection,
  ConnectionProvider,
  PlatformTx,
  Queryable,
} from "./types.js";

/**
 * The RLS chokepoint (G2). `withClinicContext` is the ONLY sanctioned way for the
 * API and workers to touch clinic data: it opens a transaction, pins
 * `app.clinic_id` for the transaction's lifetime (via `set_config(..., true)`), and
 * yields a tx handle. RLS policies (`clinic_id = current_setting('app.clinic_id')`)
 * then enforce isolation at the DB — the final, code-bug-proof layer.
 *
 * The raw connection providers are PRIVATE to this package (never exported from
 * index.ts). The single admin door (`withAdminContext`) is the only cross-tenant
 * path and is restricted to a fixed allowlist + audited by the caller.
 */
export interface DatabaseOptions {
  /** Connections bound to the normal, RLS-enforced app role. */
  app: ConnectionProvider;
  /**
   * Connections bound to the distinct admin role (decision #1). Used ONLY by
   * withAdminContext. If omitted, the admin door is closed (throws).
   */
  admin?: ConnectionProvider;
}

async function runInTransaction<T>(
  conn: Connection,
  setup: (c: Queryable) => Promise<void>,
  fn: (c: Queryable) => Promise<T>,
): Promise<T> {
  try {
    await conn.query("BEGIN");
    await setup(conn);
    const result = await fn(conn);
    await conn.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await conn.query("ROLLBACK");
    } catch {
      // ignore rollback failure; surface the original error
    }
    throw err;
  } finally {
    conn.release();
  }
}

export class Database {
  private readonly app: ConnectionProvider;
  private readonly admin?: ConnectionProvider;

  constructor(opts: DatabaseOptions) {
    this.app = opts.app;
    this.admin = opts.admin;
  }

  /** Run `fn` inside a clinic-scoped transaction (the normal path). */
  async withClinicContext<T>(
    clinicId: string,
    fn: (tx: ClinicTx) => Promise<T>,
  ): Promise<T> {
    const conn = await this.app.acquire();
    return runInTransaction(
      conn,
      async (c) => {
        // set_config(..., is_local=true) scopes the GUC to this transaction.
        await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
      },
      (c) => fn(Object.assign(c, { clinicId }) as ClinicTx),
    );
  }

  /**
   * The single audited cross-tenant door (decision #1). Restricted to the fixed
   * operation allowlist; callers MUST pass a reason and write an audit record.
   */
  async withAdminContext<T>(
    operation: AdminOperation,
    reason: string,
    fn: (tx: AdminTx) => Promise<T>,
  ): Promise<T> {
    if (!this.admin) {
      throw new Error("Admin context is not configured (no admin connection)");
    }
    const conn = await this.admin.acquire();
    return runInTransaction(
      conn,
      async () => {
        /* no clinic scope; admin role */
      },
      (c) => fn(Object.assign(c, { operation, reason }) as AdminTx),
    );
  }

  /**
   * Pre-tenant auth lookups (login). Runs as the RLS-bound app role with NO clinic
   * pinned, so only the SECURITY DEFINER lookup functions return rows — a stray
   * `SELECT * FROM clinic_users` here is correctly denied by RLS.
   */
  async withAuthLookup<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
    const conn = await this.app.acquire();
    return runInTransaction(
      conn,
      async () => {},
      (c) => fn(c),
    );
  }

  /**
   * Privileged platform writes that have no clinic context by nature: bootstrap,
   * create-clinic / invite-admin (G3), and unrouted-event logging (decision #8).
   * Uses the admin role; distinct from the read-only carve-out allowlist.
   */
  async withPlatformContext<T>(fn: (tx: PlatformTx) => Promise<T>): Promise<T> {
    if (!this.admin) {
      throw new Error("Platform context is not configured (no admin connection)");
    }
    const conn = await this.admin.acquire();
    return runInTransaction(
      conn,
      async () => {},
      (c) => fn(c as PlatformTx),
    );
  }

  async close(): Promise<void> {
    await this.app.end();
    if (this.admin) await this.admin.end();
  }
}
