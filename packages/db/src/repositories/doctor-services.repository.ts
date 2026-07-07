// Req 30 (Multi-doctor): which clinic services each doctor offers.
//
// Drives the service-selection step of the booking flow — the chosen service's
// duration sets the appointment slot length — and the Admin Studio assignment UI/API.
// A doctor with no assignments offers no specific service (booking falls back to
// the clinic default duration).
import type { Sql } from '../client.js'
import type { Service } from '../types/index.js'

export interface DoctorServicesRepository {
  /** The services a doctor offers, as full (active) service rows, ordered by name. */
  listServicesForDoctor(clinicId: string, doctorId: string): Promise<Service[]>
  /** Assign a service to a doctor. Idempotent — re-assigning an existing pair is a no-op. */
  assign(clinicId: string, doctorId: string, serviceId: string): Promise<void>
  /** Remove a service assignment from a doctor (no-op when absent). */
  remove(clinicId: string, doctorId: string, serviceId: string): Promise<void>
}

export function createDoctorServicesRepository(sql: Sql): DoctorServicesRepository {
  return {
    async listServicesForDoctor(clinicId, doctorId) {
      return sql<Service[]>`
        SELECT s.*
        FROM doctor_services ds
        JOIN services s ON s.id = ds.service_id
        WHERE ds.clinic_id = ${clinicId}
          AND ds.doctor_id = ${doctorId}
          AND s.is_active  = TRUE
        ORDER BY s.name
      `
    },

    async assign(clinicId, doctorId, serviceId) {
      await sql`
        INSERT INTO doctor_services (clinic_id, doctor_id, service_id)
        VALUES (${clinicId}, ${doctorId}, ${serviceId})
        ON CONFLICT (doctor_id, service_id) DO NOTHING
      `
    },

    async remove(clinicId, doctorId, serviceId) {
      await sql`
        DELETE FROM doctor_services
        WHERE clinic_id = ${clinicId} AND doctor_id = ${doctorId} AND service_id = ${serviceId}
      `
    },
  }
}
