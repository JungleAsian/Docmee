import { buildApp } from "./app.js";
import { loadEnv } from "@docmee/core";
import { Keyring, createDatabase, type Database } from "@docmee/db";

async function main(): Promise<void> {
  const env = loadEnv();

  const keyring = Keyring.fromEnv() ?? undefined;
  const db: Database | undefined = env.DATABASE_URL
    ? createDatabase({
        databaseUrl: env.DATABASE_URL,
        adminDatabaseUrl: env.DATABASE_ADMIN_URL,
      })
    : undefined;

  const app = buildApp({ env, db, keyring });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    await app.close();
    if (db) await db.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
