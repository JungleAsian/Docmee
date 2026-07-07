// P18 (Gap #32): Multi-doctor support. A clinic's doctors, each with their own
// Google Calendar (encrypted tokens) and weekly availability.
import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type { Doctor } from '../types/index.js'

export interface CreateDoctorInput {
  clinicId: string
  name: string
  specialty?: string
  googleCalendarId?: string
  /** Already-encrypted token (use @docmee/shared encryptValue before passing). */
  googleCalendarAccessTokenEncrypted?: string
  googleCalendarRefreshTokenEncrypted?: string
  availableDays?: Record<string, unknown>
}

export interface UpdateDoctorInput {
  name?: string
  specialty?: string
  googleCalendarId?: string
  googleCalendarAccessTokenEncrypted?: string
  googleCalendarRefreshTokenEncrypted?: string
  availableDays?: Record<string, unknown>
  isActive?: boolean
}

export interface DoctorsRepository {
  listByClinic(clinicId: string): Promise<Doctor[]>
  findById(clinicId: string, id: string): Promise<Doctor | null>
  create(data: CreateDoctorInput): Promise<Doctor>
  update(clinicId: string, id: string, data: UpdateDoctorInput): Promise<Doctor>
  delete(clinicId: string, id: string): Promise<void>
}

export function createDoctorsRepository(sql: Sql): DoctorsRepository {
  return {
    async listByClinic(clinicId) {
      return sql<Doctor[]>`
        SELECT * FROM doctors WHERE clinic_id = ${clinicId} AND is_active = TRUE ORDER BY name
      `
    },

    async findById(clinicId, id) {
      const rows = await sql<Doctor[]>`
        SELECT * FROM doctors WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async create(data) {
      const rows = await sql<Doctor[]>`
        INSERT INTO doctors (
          clinic_id, name, specialty, google_calendar_id,
          google_calendar_access_token_encrypted, google_calendar_refresh_token_encrypted,
          available_days
        )
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${data.specialty                            ?? null},
          ${data.googleCalendarId                     ?? null},
          ${data.googleCalendarAccessTokenEncrypted   ?? null},
          ${data.googleCalendarRefreshTokenEncrypted  ?? null},
          ${sql.json(toJson(data.availableDays ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async update(clinicId, id, data) {
      const rows = await sql<Doctor[]>`
        UPDATE doctors SET
          name                                    = COALESCE(${data.name       ?? null}, name),
          specialty                               = COALESCE(${data.specialty  ?? null}, specialty),
          google_calendar_id                      = COALESCE(${data.googleCalendarId ?? null}, google_calendar_id),
          google_calendar_access_token_encrypted  = COALESCE(${data.googleCalendarAccessTokenEncrypted  ?? null}, google_calendar_access_token_encrypted),
          google_calendar_refresh_token_encrypted = COALESCE(${data.googleCalendarRefreshTokenEncrypted ?? null}, google_calendar_refresh_token_encrypted),
          available_days                          = CASE WHEN ${data.availableDays !== undefined} THEN ${sql.json(toJson(data.availableDays ?? {}))} ELSE available_days END,
          is_active                               = COALESCE(${data.isActive   ?? null}, is_active)
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Doctor not found: ${id}`)
      return rows[0]
    },

    async delete(clinicId, id) {
      await sql`DELETE FROM doctors WHERE clinic_id = ${clinicId} AND id = ${id}`
    },
  }
}
