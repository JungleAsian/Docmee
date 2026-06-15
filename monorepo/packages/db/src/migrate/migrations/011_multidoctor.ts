import type { Migration } from "../runner.js";

/**
 * 011 — Multi-doctor (Phase 3A). Activates the doctor seam laid in 001: a
 * per-doctor Google calendar id, and doctor-scoped KB (doctor_id NULL = clinic-wide
 * entry shared by all doctors). Booking already carries doctor_id; routing filters
 * by doctor/specialty.
 */
const sql = /* sql */ `
  ALTER TABLE doctors ADD COLUMN calendar_id text;
  ALTER TABLE kb_entries ADD COLUMN doctor_id uuid REFERENCES doctors(id);
  CREATE INDEX kb_entries_doctor ON kb_entries (clinic_id, doctor_id);
`;

const migration: Migration = { version: 11, name: "multidoctor", sql };
export default migration;
