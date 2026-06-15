import { randomBytes } from "node:crypto";
import { loadEnv, hashPassword } from "@docmee/core";
import { createDatabase, auth } from "@docmee/db";

/**
 * Operator CLI (G3): seed the first platform admin. Generates a random password,
 * prints it ONCE, and forces rotation on first login. Idempotent-ish: a duplicate
 * email fails the unique constraint (re-run with a different email or clear first).
 *
 * Usage: node dist/cli/bootstrap.js [email] [name]
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is required to bootstrap.");
    process.exit(1);
  }
  const email = process.argv[2] ?? "admin@docmee.local";
  const name = process.argv[3] ?? "Platform Admin";

  const db = createDatabase({
    databaseUrl: env.DATABASE_URL,
    adminDatabaseUrl: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
  });

  const password = randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(password);
  await db.withPlatformContext((tx) =>
    auth.createPlatformUser(tx, { email, name, passwordHash, mustRotate: true }),
  );
  await db.close();

  console.log("Created platform admin:");
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}   (one-time — rotate on first login)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
