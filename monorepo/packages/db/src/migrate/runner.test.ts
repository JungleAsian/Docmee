import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { runMigrations } from "./runner.js";
import { migrations } from "./migrations/index.js";
import type { ConnectionProvider } from "../types.js";

function providerOver(pg: PGlite): ConnectionProvider {
  return {
    acquire: async () => ({
      query: async (sql, params) => {
        const r = await pg.query(sql, params as unknown[] | undefined);
        return { rows: r.rows as never[] };
      },
      exec: async (sql) => {
        await pg.exec(sql);
      },
      release: () => {},
    }),
    end: async () => {},
  };
}

describe("migration runner", () => {
  it("applies all migrations forward from an empty DB, then is idempotent", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    const provider = providerOver(pg);

    const first = await runMigrations(provider, migrations);
    expect(first.applied).toEqual(migrations.map((m) => m.version));

    const second = await runMigrations(provider, migrations);
    expect(second.applied).toEqual([]);
    expect(second.alreadyApplied).toEqual(migrations.map((m) => m.version));

    await pg.close();
  });

  it("rejects duplicate version numbers", async () => {
    const pg = new PGlite();
    await pg.waitReady;
    await expect(
      runMigrations(providerOver(pg), [
        { version: 99, name: "a", sql: "SELECT 1" },
        { version: 99, name: "b", sql: "SELECT 1" },
      ]),
    ).rejects.toThrow(/Duplicate migration version/);
    await pg.close();
  });
});
