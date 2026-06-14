import type { PlatformTx, Queryable } from "../types.js";

export interface ClinicUserAuth {
  id: string;
  clinicId: string;
  name: string;
  role: "doctor" | "secretary" | "admin" | "assistant";
  passwordHash: string;
  mustRotate: boolean;
}

export interface PlatformUserAuth {
  id: string;
  name: string;
  passwordHash: string;
  mustRotate: boolean;
}

/** Pre-tenant login lookup via the SECURITY DEFINER function (bypasses RLS safely). */
export async function findClinicUserByEmail(
  q: Queryable,
  email: string,
): Promise<ClinicUserAuth | null> {
  const { rows } = await q.query<{
    id: string;
    clinic_id: string;
    name: string;
    role: ClinicUserAuth["role"];
    password_hash: string;
    must_rotate: boolean;
  }>(`SELECT * FROM find_clinic_user_by_email($1)`, [email.toLowerCase()]);
  const r = rows[0];
  return r
    ? {
        id: r.id,
        clinicId: r.clinic_id,
        name: r.name,
        role: r.role,
        passwordHash: r.password_hash,
        mustRotate: r.must_rotate,
      }
    : null;
}

export async function findPlatformUserByEmail(
  q: Queryable,
  email: string,
): Promise<PlatformUserAuth | null> {
  const { rows } = await q.query<{
    id: string;
    name: string;
    password_hash: string;
    must_rotate: boolean;
  }>(`SELECT * FROM find_platform_user_by_email($1)`, [email.toLowerCase()]);
  const r = rows[0];
  return r
    ? { id: r.id, name: r.name, passwordHash: r.password_hash, mustRotate: r.must_rotate }
    : null;
}

// ── Provisioning (G3) — privileged platform writes ────────────────────────────

export async function createPlatformUser(
  tx: PlatformTx,
  u: { email: string; name: string; passwordHash: string; mustRotate?: boolean },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO platform_users (email, name, password_hash, must_rotate)
     VALUES (lower($1), $2, $3, $4) RETURNING id`,
    [u.email, u.name, u.passwordHash, u.mustRotate ?? true],
  );
  return rows[0]!;
}

export async function createClinic(
  tx: PlatformTx,
  c: { name: string; whatsappPhoneNumberId?: string; locale?: "es" | "en" },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO clinics (name, whatsapp_phone_number_id, locale)
     VALUES ($1, $2, $3) RETURNING id`,
    [c.name, c.whatsappPhoneNumberId ?? null, c.locale ?? "es"],
  );
  return rows[0]!;
}

export async function createClinicUser(
  tx: PlatformTx,
  u: {
    clinicId: string;
    email: string;
    name: string;
    role: ClinicUserAuth["role"];
    passwordHash: string;
    mustRotate?: boolean;
  },
): Promise<{ id: string }> {
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO clinic_users (clinic_id, email, name, role, password_hash, must_rotate)
     VALUES ($1, lower($2), $3, $4, $5, $6) RETURNING id`,
    [u.clinicId, u.email, u.name, u.role, u.passwordHash, u.mustRotate ?? true],
  );
  return rows[0]!;
}

/** Resolve a clinic by its Meta phone_number_id (inbound routing, decision #8). */
export async function findClinicByPhoneNumberId(
  tx: PlatformTx,
  phoneNumberId: string,
): Promise<{ id: string } | null> {
  const { rows } = await tx.query<{ id: string }>(
    `SELECT id FROM clinics WHERE whatsapp_phone_number_id = $1 LIMIT 1`,
    [phoneNumberId],
  );
  return rows[0] ?? null;
}
