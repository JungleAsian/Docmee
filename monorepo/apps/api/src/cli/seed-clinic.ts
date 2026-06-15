import { randomBytes } from "node:crypto";
import { loadEnv, hashPassword } from "@docmee/core";
import { createDatabase, auth } from "@docmee/db";

/**
 * Operator CLI: seed a clinic + its first admin clinic_user so staff can log in
 * via POST /auth/login. Uses the app's own hashing + DAL invariants (RLS-safe
 * platform context) — the correct, safe alternative to hand-written prod SQL.
 * Generates a random password, prints it ONCE, forces rotation on first login.
 *
 * Usage: node dist/cli/seed-clinic.js "<Clinic Name>" <admin-email> "<Admin Name>" [whatsappPhoneNumberId]
 */
async function main(): Promise<void> {
  const env = loadEnv();
  if (!env.DATABASE_URL) {
    console.error("DATABASE_URL is required to seed a clinic.");
    process.exit(1);
  }
  const clinicName = process.argv[2] ?? "Clínica Demo";
  const email = process.argv[3] ?? "admin@clinic.local";
  const name = process.argv[4] ?? "Clinic Admin";
  const whatsappPhoneNumberId = process.argv[5] ?? `pn_${randomBytes(6).toString("hex")}`;

  const db = createDatabase({
    databaseUrl: env.DATABASE_URL,
    adminDatabaseUrl: env.DATABASE_ADMIN_URL ?? env.DATABASE_URL,
  });

  const password = randomBytes(12).toString("base64url");
  const passwordHash = await hashPassword(password);

  const { clinicId, userId } = await db.withPlatformContext(async (tx) => {
    const clinic = await auth.createClinic(tx, { name: clinicName, whatsappPhoneNumberId });
    const user = await auth.createClinicUser(tx, {
      clinicId: clinic.id,
      email,
      name,
      role: "admin",
      passwordHash,
      mustRotate: true,
    });
    return { clinicId: clinic.id, userId: user.id };
  });
  await db.close();

  console.log("Seeded clinic + admin user:");
  console.log(`  clinic:   ${clinicName} (${clinicId})`);
  console.log(`  user:     ${name} <${email}> (${userId}, role=admin)`);
  console.log(`  password: ${password}   (one-time — rotate on first login)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed-clinic failed:", err);
  process.exit(1);
});
