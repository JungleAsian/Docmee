import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { Database } from "../database.js";
import { runMigrations } from "../migrate/runner.js";
import { migrations } from "../migrate/migrations/index.js";
import type { Connection, ConnectionProvider } from "../types.js";

/**
 * In-process Postgres (WASM) test harness. Real Postgres semantics — RLS, roles,
 * SECURITY DEFINER, partial indexes — with zero external infra, so the Phase-0
 * isolation gates run live in CI.
 *
 * The `app` provider runs each transaction as the non-superuser `docmee_app` role
 * (RLS enforced). The `admin` provider stays superuser (the cross-tenant door).
 * PGlite is single-connection; tests run serially, so sharing one instance is safe.
 */
function makeProvider(pg: PGlite, asAppRole: boolean): ConnectionProvider {
  const conn: Connection = {
    query: async (sql, params) => {
      const res = await pg.query(sql, params as unknown[] | undefined);
      // Pin the RLS-bound role immediately after opening the transaction.
      if (asAppRole && sql.trim().toUpperCase() === "BEGIN") {
        await pg.query("SET LOCAL ROLE docmee_app");
      }
      return { rows: res.rows as never[] };
    },
    exec: async (sql) => {
      await pg.exec(sql);
    },
    release: () => {
      /* single shared connection; nothing to release */
    },
  };
  return {
    acquire: async () => conn,
    end: async () => {
      /* closed via TestDb.close */
    },
  };
}

export interface TestDb {
  db: Database;
  pg: PGlite;
  close: () => Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite({ extensions: { vector } });
  await pg.waitReady;

  // Migrations run as the owner (superuser) via a non-role-switching provider.
  const ownerProvider = makeProvider(pg, false);
  await runMigrations(ownerProvider, migrations);

  const db = new Database({
    app: makeProvider(pg, true),
    admin: makeProvider(pg, false),
  });

  return {
    db,
    pg,
    close: async () => {
      await pg.close();
    },
  };
}
