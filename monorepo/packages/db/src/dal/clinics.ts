import type { ClinicTx } from "../types.js";
import type { Keyring } from "../crypto/keyring.js";
import { encrypt, decrypt } from "../crypto/encryption.js";

export interface WhatsappCreds {
  phoneNumberId: string;
  token: string;
}

/** Set the clinic's WhatsApp Cloud credentials (token encrypted at rest). */
export async function setWhatsappCreds(
  tx: ClinicTx,
  keyring: Keyring,
  creds: WhatsappCreds,
): Promise<void> {
  const enc = encrypt(creds.token, keyring);
  await tx.query(
    `UPDATE clinics
       SET whatsapp_phone_number_id = $2,
           whatsapp_token_ciphertext = $3,
           whatsapp_token_key_version = $4
     WHERE id = $1`,
    [tx.clinicId, creds.phoneNumberId, enc.ciphertext, enc.keyVersion],
  );
}

/** Read + decrypt the clinic's WhatsApp credentials, or null if unconfigured. */
export async function getWhatsappCreds(
  tx: ClinicTx,
  keyring: Keyring,
): Promise<WhatsappCreds | null> {
  const { rows } = await tx.query<{
    whatsapp_phone_number_id: string | null;
    whatsapp_token_ciphertext: string | null;
    whatsapp_token_key_version: number | null;
  }>(
    `SELECT whatsapp_phone_number_id, whatsapp_token_ciphertext, whatsapp_token_key_version
     FROM clinics WHERE id = $1`,
    [tx.clinicId],
  );
  const row = rows[0];
  if (!row?.whatsapp_phone_number_id || !row.whatsapp_token_ciphertext || row.whatsapp_token_key_version == null) {
    return null;
  }
  return {
    phoneNumberId: row.whatsapp_phone_number_id,
    token: decrypt(row.whatsapp_token_ciphertext, row.whatsapp_token_key_version, keyring),
  };
}
