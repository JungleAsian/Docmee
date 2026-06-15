import { loadEnv } from "@docmee/core";
import { migrateToLatest } from "@docmee/db";

/** Operator CLI: apply all pending migrations to DATABASE_URL (forward-only). */
async function main(): Promise<void> {
  const env = loadEnv();
  // DDL (CREATE TABLE/ROLE, SECURITY DEFINER fns) must run as the owner/superuser,
  // not the RLS-bound app role — prefer the admin URL.
  const migrationUrl = env.DATABASE_ADMIN_URL ?? env.DATABASE_URL;
  if (!migrationUrl) {
    console.error("DATABASE_ADMIN_URL (or DATABASE_URL) is required to run migrations.");
    process.exit(1);
  }
  const result = await migrateToLatest(migrationUrl);
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
