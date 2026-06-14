import pkg from "pg";
import type { Connection, ConnectionProvider } from "./types.js";

const { Pool } = pkg;

/**
 * PRIVATE node-postgres pool. This is the ONLY module that imports `pg` (module
 * boundary rule). The Pool itself is never exported from the package — callers get
 * a `Database` whose only doors are withClinicContext / withAdminContext.
 */
class PgConnectionProvider implements ConnectionProvider {
  private readonly pool: InstanceType<typeof Pool>;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  async acquire(): Promise<Connection> {
    const client = await this.pool.connect();
    return {
      query: async (sql, params) => {
        const res = await client.query(sql, params as unknown[] | undefined);
        return { rows: res.rows };
      },
      exec: async (sql) => {
        await client.query(sql);
      },
      release: () => client.release(),
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

/** Build an app-role connection provider for production (Supabase/Postgres). */
export function createPgProvider(connectionString: string): ConnectionProvider {
  return new PgConnectionProvider(connectionString);
}
