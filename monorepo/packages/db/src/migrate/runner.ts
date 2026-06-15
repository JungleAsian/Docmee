import type { Connection, ConnectionProvider } from "../types.js";

/**
 * Forward-only migration runner (G1). No ORM. Each migration applies inside its
 * own transaction; `schema_migrations` records what ran. Re-running is a no-op.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const SCHEMA_MIGRATIONS = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     integer PRIMARY KEY,
    name        text NOT NULL,
    applied_at  timestamptz NOT NULL DEFAULT now()
  );
`;

async function appliedVersions(conn: Connection): Promise<Set<number>> {
  const { rows } = await conn.query<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version",
  );
  return new Set(rows.map((r) => Number(r.version)));
}

export interface MigrateResult {
  applied: number[];
  alreadyApplied: number[];
}

export async function runMigrations(
  provider: ConnectionProvider,
  migrations: readonly Migration[],
): Promise<MigrateResult> {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  // Guard against duplicate / non-monotonic version numbers.
  ordered.forEach((m, i) => {
    if (i > 0 && m.version === ordered[i - 1]!.version) {
      throw new Error(`Duplicate migration version ${m.version}`);
    }
  });

  const conn = await provider.acquire();
  const applied: number[] = [];
  const alreadyApplied: number[] = [];
  try {
    await conn.exec(SCHEMA_MIGRATIONS);
    const done = await appliedVersions(conn);

    for (const m of ordered) {
      if (done.has(m.version)) {
        alreadyApplied.push(m.version);
        continue;
      }
      try {
        await conn.query("BEGIN");
        await conn.exec(m.sql);
        await conn.query(
          "INSERT INTO schema_migrations (version, name) VALUES ($1, $2)",
          [m.version, m.name],
        );
        await conn.query("COMMIT");
        applied.push(m.version);
      } catch (err) {
        try {
          await conn.query("ROLLBACK");
        } catch {
          /* surface original */
        }
        throw new Error(
          `Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`,
        );
      }
    }
  } finally {
    conn.release();
  }
  return { applied, alreadyApplied };
}
