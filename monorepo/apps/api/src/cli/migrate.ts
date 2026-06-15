import { loadEnv } from "@docmee/core";
import { migrateToLatest } from "@docmee/db";

/** Operator CLI: apply all pending migrations to DATABASE_URL (forward-only). */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is required to run migrations.");
    process.exit(1);
  }
  const result = await migrateToLatest(env.DATABASE_URL);
  if (result.applied.length) {
    console.log(`Applied migrations: ${result.applied.join(", ")}`);
  } else {
    console.log(`Up to date (${result.alreadyApplied.length} migrations already applied).`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
