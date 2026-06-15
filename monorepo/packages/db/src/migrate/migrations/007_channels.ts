import type { Migration } from "../runner.js";

/**
 * 007 — Channel expansion (Phase 2B). Messenger + Instagram routing keys on
 * clinics, and a multi-channel patient identity table so one patient can be
 * reached on several channels (encrypted identifier + HMAC for lookup). Enables
 * the unified cross-channel inbox and manual cross-channel merge.
 */
const sql = /* sql */ `
  ALTER TABLE clinics ADD COLUMN messenger_page_id     text UNIQUE;
  ALTER TABLE clinics ADD COLUMN instagram_account_id  text UNIQUE;

  CREATE TABLE patient_channel_identities (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id              uuid NOT NULL REFERENCES clinics(id),
    patient_id             uuid NOT NULL REFERENCES patients(id),
    channel                text NOT NULL
                             CHECK (channel IN ('whatsapp','messenger','instagram')),
    identity_ciphertext    text NOT NULL,
    identity_key_version   integer NOT NULL,
    identity_hmac          text NOT NULL,
    created_at             timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX pci_clinic_channel_hmac
    ON patient_channel_identities (clinic_id, channel, identity_hmac);
  CREATE INDEX pci_patient ON patient_channel_identities (clinic_id, patient_id);

  ALTER TABLE patient_channel_identities ENABLE ROW LEVEL SECURITY;
  ALTER TABLE patient_channel_identities FORCE ROW LEVEL SECURITY;
  CREATE POLICY clinic_scope ON patient_channel_identities
    USING (clinic_id = current_clinic_id()) WITH CHECK (clinic_id = current_clinic_id());
  GRANT SELECT, INSERT, UPDATE, DELETE ON patient_channel_identities TO docmee_app;
`;

const migration: Migration = { version: 7, name: "channels", sql };
export default migration;
