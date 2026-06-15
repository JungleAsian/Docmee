import type { ClinicTx } from "../types.js";
import type { Keyring } from "../crypto/keyring.js";
import { encrypt, decrypt } from "../crypto/encryption.js";
import { hmacIdentifier } from "../crypto/hmac.js";

export interface NewPatient {
  name?: string;
  phone?: string;
  channelId?: string;
}

export interface PatientRow {
  id: string;
  clinic_id: string;
  name: string | null;
  status: string;
  opted_out: boolean;
  created_at: string;
}

export interface PatientView {
  id: string;
  clinicId: string;
  name: string | null;
  phone: string | null;
  status: string;
  tags: string[];
  optedOut: boolean;
  createdAt: string;
}

interface FullRow extends PatientRow {
  tags: string[];
  phone_ciphertext: string | null;
  phone_key_version: number | null;
}

const SELECT_COLS = `id, clinic_id, name, status, tags, opted_out, created_at,
  phone_ciphertext, phone_key_version`;

function toView(row: FullRow, keyring: Keyring): PatientView {
  const phone =
    row.phone_ciphertext && row.phone_key_version != null
      ? decrypt(row.phone_ciphertext, row.phone_key_version, keyring)
      : null;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    phone,
    status: row.status,
    tags: row.tags ?? [],
    optedOut: row.opted_out,
    createdAt: row.created_at,
  };
}

/** Create a patient. Identifiers are encrypted; HMAC columns enable lookup. */
export async function createPatient(
  tx: ClinicTx,
  keyring: Keyring,
  p: NewPatient,
): Promise<PatientView> {
  const phoneEnc = p.phone ? encrypt(p.phone, keyring) : null;
  const phoneHmac = p.phone ? hmacIdentifier(p.phone, keyring) : null;
  const chanEnc = p.channelId ? encrypt(p.channelId, keyring) : null;
  const chanHmac = p.channelId ? hmacIdentifier(p.channelId, keyring) : null;

  const { rows } = await tx.query<FullRow>(
    `INSERT INTO patients
       (clinic_id, name, phone_ciphertext, phone_key_version, phone_hmac,
        channel_id_ciphertext, channel_id_key_version, channel_id_hmac)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING ${SELECT_COLS}`,
    [
      tx.clinicId,
      p.name ?? null,
      phoneEnc?.ciphertext ?? null,
      phoneEnc?.keyVersion ?? null,
      phoneHmac,
      chanEnc?.ciphertext ?? null,
      chanEnc?.keyVersion ?? null,
      chanHmac,
    ],
  );
  return toView(rows[0]!, keyring);
}

/** Look up a patient by phone via its HMAC — never decrypts to search. */
export async function findPatientByPhone(
  tx: ClinicTx,
  keyring: Keyring,
  phone: string,
): Promise<PatientView | null> {
  const phoneHmac = hmacIdentifier(phone, keyring);
  const { rows } = await tx.query<FullRow>(
    `SELECT ${SELECT_COLS} FROM patients WHERE phone_hmac = $1 LIMIT 1`,
    [phoneHmac],
  );
  return rows[0] ? toView(rows[0], keyring) : null;
}

/** Find-or-create by phone (patient auto-create on first inbound). */
export async function upsertPatientByPhone(
  tx: ClinicTx,
  keyring: Keyring,
  p: NewPatient & { phone: string },
): Promise<PatientView> {
  const existing = await findPatientByPhone(tx, keyring, p.phone);
  return existing ?? createPatient(tx, keyring, p);
}

export interface PatientPage {
  data: PatientView[];
  nextCursor: string | null;
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(`${createdAt}|${id}`).toString("base64url");
}
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = Buffer.from(cursor, "base64url").toString().split("|");
    return createdAt && id ? { createdAt, id } : null;
  } catch {
    return null;
  }
}

/**
 * List patients (clinic-scoped via RLS). Optional `q` is an identity search by
 * phone — hashed to its HMAC, never a plaintext/substring match. Keyset paginated.
 */
export async function listPatients(
  tx: ClinicTx,
  keyring: Keyring,
  opts: { q?: string; cursor?: string; limit?: number } = {},
): Promise<PatientPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const params: unknown[] = [];
  const where: string[] = [];

  if (opts.q) {
    params.push(hmacIdentifier(opts.q, keyring));
    where.push(`phone_hmac = $${params.length}`);
  }
  const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
  if (cur) {
    params.push(cur.createdAt, cur.id);
    where.push(`(created_at, id) < ($${params.length - 1}, $${params.length})`);
  }
  params.push(limit + 1);

  const { rows } = await tx.query<FullRow>(
    `SELECT ${SELECT_COLS} FROM patients
     ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC, id DESC
     LIMIT $${params.length}`,
    params,
  );

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).map((r) => toView(r, keyring));
  const last = page.at(-1);
  return {
    data: page,
    nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getPatientById(
  tx: ClinicTx,
  keyring: Keyring,
  id: string,
): Promise<PatientView | null> {
  const { rows } = await tx.query<FullRow>(
    `SELECT ${SELECT_COLS} FROM patients WHERE id = $1`,
    [id],
  );
  return rows[0] ? toView(rows[0], keyring) : null;
}

export async function setTags(tx: ClinicTx, id: string, tags: string[]): Promise<void> {
  await tx.query(`UPDATE patients SET tags = $2 WHERE id = $1`, [id, tags]);
}

export async function addTag(tx: ClinicTx, id: string, tag: string): Promise<void> {
  await tx.query(
    `UPDATE patients SET tags = (
       SELECT array_agg(DISTINCT t) FROM unnest(tags || $2::text[]) AS t
     ) WHERE id = $1`,
    [id, [tag]],
  );
}

export async function setStatus(tx: ClinicTx, id: string, status: string): Promise<void> {
  await tx.query(`UPDATE patients SET status = $2 WHERE id = $1`, [id, status]);
}

/** Set/clear opt-out (decision #5). STOP = all-stop; bot-irreversible. */
export async function setOptOut(
  tx: ClinicTx,
  patientId: string,
  optedOut: boolean,
  scope = "all",
): Promise<void> {
  await tx.query(
    `UPDATE patients
       SET opted_out = $2,
           opted_out_at = CASE WHEN $2 THEN now() ELSE NULL END,
           opted_out_scope = $3
     WHERE id = $1`,
    [patientId, optedOut, scope],
  );
}
