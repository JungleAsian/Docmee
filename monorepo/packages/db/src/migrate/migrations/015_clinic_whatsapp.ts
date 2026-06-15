import type { Migration } from "../runner.js";

/**
 * 015 — Per-clinic WhatsApp send credentials. The access token is stored
 * app-layer ENCRYPTED (architecture §5: clinic Meta/Google tokens encrypted),
 * keyed like every other secret. phone_number_id already lives on clinics.
 */
const sql = /* sql */ `
  ALTER TABLE clinics ADD COLUMN whatsapp_token_ciphertext  text;
  ALTER TABLE clinics ADD COLUMN whatsapp_token_key_version integer;
`;

const migration: Migration = { version: 15, name: "clinic_whatsapp", sql };
export default migration;
