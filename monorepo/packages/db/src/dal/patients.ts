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
  optedOut: boolean;
  createdAt: string;
}

interface FullRow extends PatientRow {
  phone_ciphertext: string | null;
  phone_key_version: number | null;
}

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
     RETURNING id, clinic_id, name, status, opted_out, created_at,
               phone_ciphertext, phone_key_version`,
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
    `SELECT id, clinic_id, name, status, opted_out, created_at,
            phone_ciphertext, phone_key_version
     FROM patients WHERE phone_hmac = $1 LIMIT 1`,
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
