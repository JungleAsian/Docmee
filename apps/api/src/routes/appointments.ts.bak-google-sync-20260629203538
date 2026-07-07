// Screen 2 — AI booking & calendar (Req 9 calendar booking, Req 30 multi-doctor).
//
// The operational, human-facing calendar the panel uses to read and manage the
// appointments the AI books (and to book/reschedule/cancel by hand). Accessible to
// every clinic role — secretaries run the bookings day to day — and always scoped
// to the caller's own clinic.
//
//   GET    /clinics/:id/appointments?from&to&doctorId   list a date range (enriched)
//   GET    /clinics/:id/appointments/slots?doctorId&date&serviceId   free slots
//   GET    /clinics/:id/appointments/patients            minimal patient picker list
//   POST   /clinics/:id/appointments                     book
//   PATCH  /clinics/:id/appointments/:apptId             reschedule / change status
//
// NOTE (timezone): slot math is done in clinic-local wall-clock HH:MM and the API
// stores/echoes the same strings, so the panel and tests stay consistent. Mapping
// those to the clinic's IANA timezone for the timestamptz column (and reconciling
// with Google Calendar busy times) is tracked as a follow-up — booked DB rows here
// are the panel's own source of truth for collisions.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  createAppointmentsRepository,
  createDoctorsRepository,
  createPatientsRepository,
  type AppointmentStatus,
  type AppointmentEventType,
} from '@docmee/db'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth } from '../middleware/auth.js'
import { computeFreeSlots, normalizeAvailability, rangesForDate, type TimeRange } from '../lib/slots.js'

const DEFAULT_DURATION_MIN = 30
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

const listQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  doctorId: z.string().min(1).optional(),
})

const slotsQuerySchema = z.object({
  doctorId: z.string().min(1),
  date: isoDate,
  serviceId: z.string().min(1).optional(),
})

const bookSchema = z.object({
  patientId: z.string().min(1),
  doctorId: z.string().min(1),
  serviceId: z.string().min(1).optional(),
  date: isoDate,
  start: hhmm,
  notes: z.string().max(2000).optional(),
  // Screen 2: flag a booking urgent (drives the red card + "Urgent" tag). Stored
  // on metadata so no schema migration is needed.
  urgent: z.boolean().optional(),
})

// Either reschedule (date + start), change status, or toggle urgency — at least one
// actionable field is required.
const patchSchema = z
  .object({
    date: isoDate.optional(),
    start: hhmm.optional(),
    status: z
      .enum(['pending', 'confirmed', 'arrived', 'in_progress', 'cancelled', 'completed', 'no_show'])
      .optional(),
    notes: z.string().max(2000).optional(),
    urgent: z.boolean().optional(),
  })
  .refine(
    (b) =>
      b.status !== undefined ||
      b.urgent !== undefined ||
      (b.date !== undefined && b.start !== undefined),
    { message: 'provide a status, urgent flag, or both date and start to reschedule' },
  )

const toMin = (t: string): number => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const toHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** HH:MM portion of an ISO timestamp ("2026-06-22T09:30:00…" → "09:30"). */
const timeOf = (iso: string): string => iso.slice(11, 16)
/** The date that follows `YYYY-MM-DD`, for an exclusive end-of-day range bound. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

const STATUS_EVENT: Record<AppointmentStatus, AppointmentEventType | null> = {
  pending: null,
  confirmed: 'confirmed',
  arrived: 'arrived',
  in_progress: 'in_progress',
  cancelled: 'cancelled',
  completed: 'completed',
  no_show: 'no_show',
}

const appointmentsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ── List a date range (the calendar grid) ──────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/clinics/:id/appointments',
    async (request, reply) => {
      const parsed = validate(listQuerySchema, request.query, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const appointments = await withDb(async (sql) =>
        createAppointmentsRepository(sql).listInRange(clinicId, {
          from: parsed.data.from,
          to: parsed.data.to,
          doctorId: parsed.data.doctorId,
        }),
      )
      return { appointments }
    },
  )

  // ── Minimal patient list for the booking picker (any clinic role) ──────────
  app.get<{ Params: { id: string } }>('/clinics/:id/appointments/patients', async (request, reply) => {
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const patients = await withDb(async (sql) => createPatientsRepository(sql).list(clinicId))
    return { patients: patients.map((p) => ({ id: p.id, fullName: p.fullName })) }
  })

  // ── AI booking activity feed (the calendar rail) ───────────────────────────
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/clinics/:id/appointments/events',
    async (request, reply) => {
      const parsed = validate(listQuerySchema, request.query, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const events = await withDb(async (sql) =>
        createAppointmentsRepository(sql).listEventsInRange(clinicId, {
          from: parsed.data.from,
          to: parsed.data.to,
          doctorId: parsed.data.doctorId,
        }),
      )
      return { events }
    },
  )

  // ── Free slots for a doctor on a date ──────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: Record<string, string> }>(
    '/clinics/:id/appointments/slots',
    async (request, reply) => {
      const parsed = validate(slotsQuerySchema, request.query, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const { doctorId, date, serviceId } = parsed.data

      const result = await withDb(async (sql) => {
        const doctor = await createDoctorsRepository(sql).findById(clinicId, doctorId)
        if (!doctor) return null
        const appts = createAppointmentsRepository(sql)
        const duration =
          (serviceId
            ? (await appts.listServices(clinicId)).find((s) => s.id === serviceId)?.durationMinutes
            : undefined) ?? DEFAULT_DURATION_MIN
        const dayAppts = await appts.listInRange(clinicId, {
          from: `${date}T00:00:00`,
          to: `${nextDay(date)}T00:00:00`,
          doctorId,
        })
        const busy: TimeRange[] = dayAppts
          .filter((a) => a.status !== 'cancelled')
          .map((a) => ({ start: timeOf(a.startTime), end: timeOf(a.endTime) }))
        const ranges = rangesForDate(normalizeAvailability(doctor.availableDays), date)
        // Mirror routes/doctors.ts redactDoctor: "connected" = both tokens present.
        const calendarConnected = Boolean(
          doctor.googleCalendarAccessTokenEncrypted && doctor.googleCalendarRefreshTokenEncrypted,
        )
        return {
          date,
          doctorId,
          durationMinutes: duration,
          calendarConnected,
          working: ranges.length > 0,
          slots: computeFreeSlots(ranges, duration, busy),
        }
      })
      if (result === null) return reply.code(404).send({ error: 'Doctor not found' })
      return result
    },
  )

  // ── Book ───────────────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>('/clinics/:id/appointments', async (request, reply) => {
    const parsed = validate(bookSchema, request.body, reply)
    if (!parsed.ok) return
    const clinicId = resolveClinicScope(request, request.params.id)
    if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
    const { patientId, doctorId, serviceId, date, start, notes, urgent } = parsed.data

    const result = await withDb(async (sql) => {
      const doctor = await createDoctorsRepository(sql).findById(clinicId, doctorId)
      if (!doctor) return { error: 'doctor' as const }
      const patient = await createPatientsRepository(sql).findById(clinicId, patientId)
      if (!patient) return { error: 'patient' as const }

      const appts = createAppointmentsRepository(sql)
      const duration =
        (serviceId
          ? (await appts.listServices(clinicId)).find((s) => s.id === serviceId)?.durationMinutes
          : undefined) ?? DEFAULT_DURATION_MIN
      const startMin = toMin(start)
      const endMin = startMin + duration

      // Reject a slot that collides with one of the doctor's existing bookings.
      const dayAppts = await appts.listInRange(clinicId, {
        from: `${date}T00:00:00`,
        to: `${nextDay(date)}T00:00:00`,
        doctorId,
      })
      const clash = dayAppts.some((a) => {
        if (a.status === 'cancelled') return false
        const bs = toMin(timeOf(a.startTime))
        const be = toMin(timeOf(a.endTime))
        return startMin < be && bs < endMin
      })
      if (clash) return { error: 'clash' as const }

      const appointment = await appts.create({
        clinicId,
        patientId,
        doctorId,
        serviceId,
        startTime: `${date}T${start}:00`,
        endTime: `${date}T${toHHMM(endMin)}:00`,
        notes,
        // A panel booking has no conversation_id (→ "Booked by staff"); the urgent
        // flag lives on metadata so the calendar can colour the card red.
        metadata: urgent ? { urgent: true } : undefined,
      })
      return { appointment }
    })

    if ('error' in result) {
      if (result.error === 'clash') return reply.code(409).send({ error: 'Slot no longer available' })
      return reply
        .code(404)
        .send({ error: result.error === 'doctor' ? 'Doctor not found' : 'Patient not found' })
    }
    return reply.code(201).send(result)
  })

  // ── Reschedule / change status ──────────────────────────────────────────────
  app.patch<{ Params: { id: string; apptId: string } }>(
    '/clinics/:id/appointments/:apptId',
    async (request, reply) => {
      const parsed = validate(patchSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const { date, start, status, notes, urgent } = parsed.data

      const appointment = await withDb(async (sql) => {
        const appts = createAppointmentsRepository(sql)
        const existing = await appts.findById(clinicId, request.params.apptId)
        if (!existing) return null

        const patch: Parameters<typeof appts.update>[2] = {}
        if (notes !== undefined) patch.notes = notes
        if (status !== undefined) patch.status = status
        if (urgent !== undefined) {
          // Merge the urgent flag into the existing metadata blob (don't clobber it).
          patch.metadata = { ...(existing.metadata ?? {}), urgent }
        }
        if (date !== undefined && start !== undefined) {
          // Preserve the original duration when moving the appointment.
          const duration = toMin(timeOf(existing.endTime)) - toMin(timeOf(existing.startTime))
          patch.startTime = `${date}T${start}:00`
          patch.endTime = `${date}T${toHHMM(toMin(start) + Math.max(duration, DEFAULT_DURATION_MIN))}:00`
        }

        const updated = await appts.update(clinicId, request.params.apptId, patch)
        if (date !== undefined && start !== undefined) {
          await appts.addEvent(clinicId, updated.id, 'rescheduled', request.user?.userId)
        }
        if (status !== undefined && STATUS_EVENT[status]) {
          await appts.addEvent(clinicId, updated.id, STATUS_EVENT[status]!, request.user?.userId)
        }
        return updated
      })

      if (!appointment) return reply.code(404).send({ error: 'Appointment not found' })
      return { appointment }
    },
  )
}

export default appointmentsRoute
