import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { Patient, PatientContact, PatientStatus, Channel } from '../types/index.js'

export interface CreatePatientInput {
  clinicId: string
  fullName?: string
  status?: PatientStatus
  notes?: string
  metadata?: Record<string, unknown>
}

export interface UpdatePatientInput {
  fullName?: string
  status?: PatientStatus
  notes?: string
  metadata?: Record<string, unknown>
}

export interface CreatePatientContactInput {
  patientId: string
  clinicId: string
  channel: Channel
  contactHandle: string
  isPrimary?: boolean
}

export interface PatientsRepository {
  findById(clinicId: string, id: string): Promise<Patient | null>
  findByContact(clinicId: string, channel: Channel, contactHandle: string): Promise<Patient | null>
  list(clinicId: string): Promise<Patient[]>
  create(data: CreatePatientInput): Promise<Patient>
  update(clinicId: string, id: string, data: UpdatePatientInput): Promise<Patient>
  addContact(data: CreatePatientContactInput): Promise<PatientContact>
  listContacts(clinicId: string, patientId: string): Promise<PatientContact[]>
}

export function createPatientsRepository(sql: Sql): PatientsRepository {
  return {
    async findById(clinicId, id) {
      const rows = await sql<Patient[]>`
        SELECT * FROM patients WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async findByContact(clinicId, channel, contactHandle) {
      const rows = await sql<Patient[]>`
        SELECT p.* FROM patients p
        JOIN patient_contacts pc ON pc.patient_id = p.id
        WHERE pc.clinic_id = ${clinicId}
          AND pc.channel = ${channel}
          AND pc.contact_handle = ${contactHandle}
        LIMIT 1
      `
      return rows[0] ?? null
    },

    async list(clinicId) {
      return sql<Patient[]>`
        SELECT * FROM patients WHERE clinic_id = ${clinicId} ORDER BY created_at DESC
      `
    },

    async create(data) {
      const rows = await sql<Patient[]>`
        INSERT INTO patients (clinic_id, full_name, status, notes, metadata)
        VALUES (
          ${data.clinicId},
          ${data.fullName ?? null},
          ${data.status ?? 'new'},
          ${data.notes ?? null},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<Patient[]>`
        UPDATE patients SET
          full_name = COALESCE(${data.fullName ?? null}, full_name),
          status    = COALESCE(${data.status   ?? null}, status),
          notes     = COALESCE(${data.notes    ?? null}, notes),
          metadata  = CASE WHEN ${data.metadata !== undefined} THEN ${sql.json(toJson(data.metadata ?? {}))} ELSE metadata END
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Patient not found: ${id}`)
      return rows[0]
    },

    async addContact(data) {
      const rows = await sql<PatientContact[]>`
        INSERT INTO patient_contacts (patient_id, clinic_id, channel, contact_handle, is_primary)
        VALUES (${data.patientId}, ${data.clinicId}, ${data.channel}, ${data.contactHandle}, ${data.isPrimary ?? false})
        ON CONFLICT (clinic_id, channel, contact_handle) DO UPDATE
          SET patient_id = EXCLUDED.patient_id,
              is_primary = EXCLUDED.is_primary
        RETURNING *
      `
      return rows[0]!
    },

    async listContacts(clinicId, patientId) {
      return sql<PatientContact[]>`
        SELECT * FROM patient_contacts
        WHERE clinic_id = ${clinicId} AND patient_id = ${patientId}
        ORDER BY is_primary DESC, created_at
      `
    },
  }
}
