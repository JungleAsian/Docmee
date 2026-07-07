import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type {
  Appointment,
  AppointmentStatus,
  AppointmentEvent,
  AppointmentEventType,
  Provider,
  Service,
  ProviderAvailability,
} from '../types/index.js'

export interface CreateAppointmentInput {
  clinicId: string
  patientId: string
  /** Legacy provider booking. Omit when booking under a doctor instead. */
  providerId?: string
  /** P18 (Gap #32) — book under a doctor. At least one of provider/doctor is required. */
  doctorId?: string
  serviceId?: string
  conversationId?: string
  startTime: string
  endTime: string
  notes?: string
  metadata?: Record<string, unknown>
}

export interface UpdateAppointmentInput {
  status?: AppointmentStatus
  googleEventId?: string
  startTime?: string
  endTime?: string
  notes?: string
  metadata?: Record<string, unknown>
}

/**
 * An appointment joined with the human-readable names the operational calendar
 * (Screen 2 — Req 9/30) needs to render a row without N+1 lookups: the patient,
 * the doctor, and the service (whose duration sets the slot length).
 */
export interface AppointmentWithNames extends Appointment {
  patientName: string | null
  doctorName: string | null
  serviceName: string | null
  serviceDurationMinutes: number | null
}

export interface ListInRangeOptions {
  from: string
  to: string
  /** Restrict to one doctor (the panel's per-doctor calendar filter). */
  doctorId?: string
}

/**
 * One row of the Screen 2 "AI booking activity" feed: an appointment_event joined
 * with the patient name + the appointment's start time + whether the underlying
 * appointment originated from a conversation (the AI booked it over WhatsApp) or
 * was created by staff. Powers the calendar rail's chronological activity log.
 */
export interface AppointmentEventFeedItem {
  id: string
  appointmentId: string
  eventType: AppointmentEventType
  createdAt: string
  patientName: string | null
  startTime: string
  /** True when the appointment carries a conversation_id (AI-booked over a channel). */
  aiSourced: boolean
}

export interface CreateProviderInput {
  clinicId: string
  fullName: string
  email?: string
  specialty?: string
  googleCalendarId?: string
  metadata?: Record<string, unknown>
}

export interface CreateServiceInput {
  clinicId: string
  name: string
  description?: string
  durationMinutes?: number
  price?: number
  currency?: string
  metadata?: Record<string, unknown>
}

export interface AppointmentsRepository {
  findById(clinicId: string, id: string): Promise<Appointment | null>
  listByClinic(clinicId: string, status?: AppointmentStatus): Promise<Appointment[]>
  /**
   * Appointments whose start_time falls in [from, to), optionally for a single
   * doctor, joined with patient/doctor/service names. Powers the panel calendar
   * (Screen 2) and its per-doctor free-slot computation.
   */
  listInRange(clinicId: string, options: ListInRangeOptions): Promise<AppointmentWithNames[]>
  /**
   * The day's appointment events (newest first), joined with patient name + the
   * appointment start time + AI-vs-staff source — the calendar's activity feed.
   * Scoped to appointments whose start_time falls in [from, to), optional doctor.
   */
  listEventsInRange(clinicId: string, options: ListInRangeOptions): Promise<AppointmentEventFeedItem[]>
  listByPatient(clinicId: string, patientId: string): Promise<Appointment[]>
  listByProvider(clinicId: string, providerId: string, from: string, to: string): Promise<Appointment[]>
  /** Completed appointments whose end_time falls in [from, to] — drives review requests (P18). */
  listCompletedForReview(clinicId: string, from: string, to: string): Promise<Appointment[]>
  /** Count appointments created in [from, to] — powers the automatic reports (P18). */
  countCreatedBetween(clinicId: string, from: string, to: string): Promise<number>
  create(data: CreateAppointmentInput): Promise<Appointment>
  update(clinicId: string, id: string, data: UpdateAppointmentInput): Promise<Appointment>
  addEvent(clinicId: string, appointmentId: string, eventType: AppointmentEventType, actorId?: string): Promise<AppointmentEvent>
  listEvents(clinicId: string, appointmentId: string): Promise<AppointmentEvent[]>

  listProviders(clinicId: string): Promise<Provider[]>
  createProvider(data: CreateProviderInput): Promise<Provider>
  listAvailability(clinicId: string, providerId: string): Promise<ProviderAvailability[]>

  listServices(clinicId: string): Promise<Service[]>
  createService(data: CreateServiceInput): Promise<Service>
}

export function createAppointmentsRepository(sql: Sql): AppointmentsRepository {
  return {
    async findById(clinicId, id) {
      const rows = await sql<Appointment[]>`
        SELECT * FROM appointments WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async listByClinic(clinicId, status) {
      if (status) {
        return sql<Appointment[]>`
          SELECT * FROM appointments WHERE clinic_id = ${clinicId} AND status = ${status}
          ORDER BY start_time
        `
      }
      return sql<Appointment[]>`
        SELECT * FROM appointments WHERE clinic_id = ${clinicId} ORDER BY start_time
      `
    },

    async listInRange(clinicId, { from, to, doctorId }) {
      const doctorFilter = doctorId ? sql`AND a.doctor_id = ${doctorId}` : sql``
      return sql<AppointmentWithNames[]>`
        SELECT
          a.*,
          p.full_name       AS patient_name,
          d.name            AS doctor_name,
          s.name            AS service_name,
          s.duration_minutes AS service_duration_minutes
        FROM appointments a
        LEFT JOIN patients p ON p.id = a.patient_id
        LEFT JOIN doctors  d ON d.id = a.doctor_id
        LEFT JOIN services s ON s.id = a.service_id
        WHERE a.clinic_id  = ${clinicId}
          AND a.start_time >= ${from}::timestamptz
          AND a.start_time <  ${to}::timestamptz
          ${doctorFilter}
        ORDER BY a.start_time
      `
    },

    async listEventsInRange(clinicId, { from, to, doctorId }) {
      const doctorFilter = doctorId ? sql`AND a.doctor_id = ${doctorId}` : sql``
      return sql<AppointmentEventFeedItem[]>`
        -- appt:eventsInRange
        SELECT
          e.id,
          e.appointment_id           AS appointment_id,
          e.event_type               AS event_type,
          e.created_at               AS created_at,
          p.full_name                AS patient_name,
          a.start_time               AS start_time,
          (a.conversation_id IS NOT NULL) AS ai_sourced
        FROM appointment_events e
        JOIN appointments a ON a.id = e.appointment_id
        LEFT JOIN patients p ON p.id = a.patient_id
        WHERE e.clinic_id  = ${clinicId}
          AND a.start_time >= ${from}::timestamptz
          AND a.start_time <  ${to}::timestamptz
          ${doctorFilter}
        ORDER BY e.created_at DESC
        LIMIT 40
      `
    },

    async listByPatient(clinicId, patientId) {
      return sql<Appointment[]>`
        SELECT * FROM appointments WHERE clinic_id = ${clinicId} AND patient_id = ${patientId}
        ORDER BY start_time DESC
      `
    },

    async listByProvider(clinicId, providerId, from, to) {
      return sql<Appointment[]>`
        SELECT * FROM appointments
        WHERE clinic_id   = ${clinicId}
          AND provider_id = ${providerId}
          AND start_time >= ${from}::timestamptz
          AND end_time   <= ${to}::timestamptz
        ORDER BY start_time
      `
    },

    async listCompletedForReview(clinicId, from, to) {
      return sql<Appointment[]>`
        SELECT * FROM appointments
        WHERE clinic_id = ${clinicId}
          AND status    = 'completed'
          AND end_time >= ${from}::timestamptz
          AND end_time <= ${to}::timestamptz
        ORDER BY end_time
      `
    },

    async countCreatedBetween(clinicId, from, to) {
      const rows = await sql<[{ count: string }]>`
        SELECT COUNT(*) AS count FROM appointments
        WHERE clinic_id = ${clinicId}
          AND created_at >= ${from}::timestamptz
          AND created_at <= ${to}::timestamptz
      `
      return parseInt(rows[0]?.count ?? '0', 10)
    },

    async create(data) {
      const rows = await sql<Appointment[]>`
        INSERT INTO appointments
          (clinic_id, patient_id, provider_id, doctor_id, service_id, conversation_id, start_time, end_time, notes, metadata)
        VALUES (
          ${data.clinicId},
          ${data.patientId},
          ${data.providerId     ?? null},
          ${data.doctorId       ?? null},
          ${data.serviceId      ?? null},
          ${data.conversationId ?? null},
          ${data.startTime}::timestamptz,
          ${data.endTime}::timestamptz,
          ${data.notes          ?? null},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      const appt = rows[0]!
      await this.addEvent(data.clinicId, appt.id, 'created')
      return appt
    },

    async update(clinicId, id, data) {
      const rows = await sql<Appointment[]>`
        UPDATE appointments SET
          status          = COALESCE(${data.status          ?? null}, status),
          google_event_id = COALESCE(${data.googleEventId  ?? null}, google_event_id),
          start_time      = COALESCE(${data.startTime      ?? null}::timestamptz, start_time),
          end_time        = COALESCE(${data.endTime        ?? null}::timestamptz, end_time),
          notes           = COALESCE(${data.notes          ?? null}, notes),
          metadata        = CASE WHEN ${data.metadata !== undefined} THEN ${sql.json(toJson(data.metadata ?? {}))} ELSE metadata END
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`Appointment not found: ${id}`)
      return rows[0]
    },

    async addEvent(clinicId, appointmentId, eventType, actorId) {
      const rows = await sql<AppointmentEvent[]>`
        INSERT INTO appointment_events (appointment_id, clinic_id, event_type, actor_id)
        VALUES (${appointmentId}, ${clinicId}, ${eventType}, ${actorId ?? null})
        RETURNING *
      `
      return rows[0]!
    },

    async listEvents(clinicId, appointmentId) {
      return sql<AppointmentEvent[]>`
        SELECT * FROM appointment_events
        WHERE clinic_id = ${clinicId} AND appointment_id = ${appointmentId}
        ORDER BY created_at
      `
    },

    async listProviders(clinicId) {
      return sql<Provider[]>`
        SELECT * FROM providers WHERE clinic_id = ${clinicId} AND is_active = TRUE ORDER BY full_name
      `
    },

    async createProvider(data) {
      const rows = await sql<Provider[]>`
        INSERT INTO providers (clinic_id, full_name, email, specialty, google_calendar_id, metadata)
        VALUES (
          ${data.clinicId},
          ${data.fullName},
          ${data.email            ?? null},
          ${data.specialty        ?? null},
          ${data.googleCalendarId ?? null},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async listAvailability(clinicId, providerId) {
      return sql<ProviderAvailability[]>`
        SELECT * FROM provider_availability
        WHERE clinic_id = ${clinicId} AND provider_id = ${providerId} AND is_active = TRUE
        ORDER BY day_of_week, start_time
      `
    },

    async listServices(clinicId) {
      return sql<Service[]>`
        SELECT * FROM services WHERE clinic_id = ${clinicId} AND is_active = TRUE ORDER BY name
      `
    },

    async createService(data) {
      const rows = await sql<Service[]>`
        INSERT INTO services (clinic_id, name, description, duration_minutes, price, currency, metadata)
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${data.description     ?? null},
          ${data.durationMinutes ?? 30},
          ${data.price           ?? null},
          ${data.currency        ?? 'GTQ'},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },
  }
}
