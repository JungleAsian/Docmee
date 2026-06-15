import type { ClinicTx } from "../types.js";
import type { Keyring } from "../crypto/keyring.js";
import { encrypt } from "../crypto/encryption.js";
import { hmacIdentifier } from "../crypto/hmac.js";
import { createPatient, getPatientById, type PatientView } from "./patients.js";
import { writeAudit } from "./audit.js";

export type Channel = "whatsapp" | "messenger" | "instagram";

/**
 * Find-or-create a patient by their identity on a specific channel (Phase 2B).
 * Each (clinic, channel, identity) maps to one patient; a patient can have several
 * channel identities. WhatsApp also stores the phone on the patient for CRM search.
 */
export async function upsertPatientByChannelIdentity(
  tx: ClinicTx,
  keyring: Keyring,
  p: { channel: Channel; identity: string; phone?: string; name?: string },
): Promise<PatientView> {
  const idHmac = hmacIdentifier(p.identity, keyring);
  const existing = await tx.query<{ patient_id: string }>(
    `SELECT patient_id FROM patient_channel_identities
     WHERE channel = $1 AND identity_hmac = $2 LIMIT 1`,
    [p.channel, idHmac],
  );
  if (existing.rows[0]) {
    const patient = await getPatientById(tx, keyring, existing.rows[0].patient_id);
    if (patient) return patient;
  }

  const patient = await createPatient(tx, keyring, {
    name: p.name,
    phone: p.channel === "whatsapp" ? p.identity : undefined,
    channelId: p.identity,
  });
  const enc = encrypt(p.identity, keyring);
  await tx.query(
    `INSERT INTO patient_channel_identities
       (clinic_id, patient_id, channel, identity_ciphertext, identity_key_version, identity_hmac)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (clinic_id, channel, identity_hmac) DO NOTHING`,
    [tx.clinicId, patient.id, p.channel, enc.ciphertext, enc.keyVersion, idHmac],
  );
  return patient;
}

export interface ChannelIdentityRow {
  id: string;
  channel: Channel;
  patient_id: string;
}

export async function listChannelIdentities(
  tx: ClinicTx,
  patientId: string,
): Promise<ChannelIdentityRow[]> {
  const { rows } = await tx.query<ChannelIdentityRow>(
    `SELECT id, channel, patient_id FROM patient_channel_identities WHERE patient_id = $1`,
    [patientId],
  );
  return rows;
}

/**
 * Manual cross-channel merge (G31): fold the secondary patient's conversations,
 * appointments, notes, and channel identities into the primary. The secondary is
 * marked 'merged' (never hard-deleted — communication records are append-only).
 */
export async function mergePatients(
  tx: ClinicTx,
  primaryId: string,
  secondaryId: string,
): Promise<void> {
  if (primaryId === secondaryId) return;
  for (const table of [
    "conversations",
    "appointments",
    "patient_notes",
    "patient_channel_identities",
  ]) {
    await tx.query(
      `UPDATE ${table} SET patient_id = $1 WHERE patient_id = $2`,
      [primaryId, secondaryId],
    );
  }
  await tx.query(`UPDATE patients SET status = 'merged' WHERE id = $1`, [secondaryId]);
  await writeAudit(tx, {
    action: "patient.merge",
    target: primaryId,
    detail: { mergedFrom: secondaryId },
  });
}
