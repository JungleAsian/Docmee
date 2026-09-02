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
// NOTE (timezone): the panel submits clinic-local wall-clock values, but every
// appointment is persisted as the corresponding instant. This matches automated
// booking and lets the database capacity check compare all booking origins safely.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import {
  createAppointmentsRepository,
  createClinicsRepository,
  createDoctorsRepository,
  createPatientsRepository,
  type AppointmentStatus,
  type AppointmentEventType,
} from '@docmee/db'
import { createGoogleCalendarOps, type CalendarOps, type RefreshedTokens } from '@docmee/agents'
import {
  clinicInstantRange,
  clinicLocalInstant,
  decryptValue,
  encryptValue,
  formattedClinicParts as formattedParts,
} from '@docmee/shared'
import { notificationQueue } from '@docmee/queue'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth } from '../middleware/auth.js'
import { isDocmeeExpansionFeatureEnabled } from '../lib/features.js'
import { computeFreeSlots, normalizeAvailability, rangesForDate } from '../lib/slots.js'

const DEFAULT_DURATION_MIN = 30
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM')

function appointmentBookingSource(appointment: {
  bookingOrigin?: string | null
  conversationId?: string | null
  actorId?: string | null
  metadata?: Record<string, unknown> | null
}): 'ai' | 'secretary' | 'unknown' {
  const source = typeof appointment.metadata?.source === 'string'
    ? appointment.metadata.source.trim().toLowerCase()
    : ''
  if (
    appointment.bookingOrigin === 'docmee' ||
    appointment.bookingOrigin === 'workflow' ||
    Boolean(appointment.conversationId) ||
    source === 'docmee' ||
    source === 'workflow'
  ) return 'ai'
  if (appointment.bookingOrigin === 'manual' && (Boolean(appointment.actorId) || ['manual', 'secretary', 'staff'].includes(source))) {
    return 'secretary'
  }
  return 'unknown'
}

const listQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  doctorId: z.string().min(1).optional(),
})

const slotsQuerySchema = z.object({
  doctorId: z.string().min(1),
  date: isoDate,
  serviceId: z.string().min(1).optional(),
  // Staff can ask for occupied working slots so the secretary can deliberately
  // add a parallel appointment. The default remains free-only for AI booking.
  includeBooked: z.coerce.boolean().optional(),
})

// Staff can either pick an existing patient (patientId) or type a brand-new
// patient's name inline (patientName) — exactly one of the two, never both/neither.
const bookSchema = z
  .object({
    patientId: z.string().min(1).optional(),
    patientName: z.string().min(1).max(200).optional(),
    doctorId: z.string().min(1),
    serviceId: z.string().min(1).optional(),
    date: isoDate,
    start: hhmm,
    notes: z.string().max(2000).optional(),
    // Screen 2: flag a booking urgent (drives the red card + "Urgent" tag). Stored
    // on metadata so no schema migration is needed.
    urgent: z.boolean().optional(),
    overbook: z.boolean().optional(),
    overbookingReason: z.string().max(500).optional(),
  })
  .refine((data) => Boolean(data.patientId) !== Boolean(data.patientName), {
    message: 'Provide exactly one of patientId or patientName',
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
/** HH:MM in the clinic timezone for a stored appointment instant. */
const timeOf = (iso: string | Date, timezone?: string): string => {
  const value = iso instanceof Date ? iso.toISOString() : String(iso)
  if (!timezone || !/(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return value.slice(11, 16)
  const parts = formattedParts(new Date(value), timezone)
  return `${String(parts[3]).padStart(2, '0')}:${String(parts[4]).padStart(2, '0')}`
}
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

interface GoogleCalendarSettings {
  accessToken: string
  refreshToken: string
  calendarId: string
  expiryDate?: number
}

function getCalendarSettings(settings: Record<string, unknown>): GoogleCalendarSettings | null {
  const gc = settings['googleCalendar']
  if (gc && typeof gc === 'object' && 'accessToken' in gc && 'refreshToken' in gc) {
    return gc as GoogleCalendarSettings
  }
  return null
}

function durationMinutes(startTime: string | Date, endTime: string | Date): number {
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  const diff = Number.isFinite(start) && Number.isFinite(end)
    ? Math.round((end - start) / 60_000)
    : toMin(timeOf(endTime)) - toMin(timeOf(startTime))
  return Math.max(diff, DEFAULT_DURATION_MIN)
}

function eventTitle(patientName: string | null): string {
  return patientName ? `Cita: ${patientName}` : 'Cita'
}

async function clinicCalendar(sql: Parameters<typeof createClinicsRepository>[0], clinicId: string): Promise<CalendarOps | null> {
  const clinics = createClinicsRepository(sql)
  const clinic = await clinics.findById(clinicId)
  if (!clinic) return null
  const settings = getCalendarSettings(clinic.settings)
  if (!settings) return null
  return createGoogleCalendarOps({
    accessToken: decryptValue(settings.accessToken),
    refreshToken: decryptValue(settings.refreshToken),
    calendarId: settings.calendarId || 'primary',
    timezone: clinic.timezone || 'America/Guatemala',
    expiryDate: settings.expiryDate,
    onTokensRefreshed: async (tokens: RefreshedTokens) => {
      const latest = await clinics.findById(clinicId)
      if (!latest) return
      const latestCalendar = getCalendarSettings(latest.settings) ?? settings
      await clinics.update(clinicId, {
        settings: {
          ...latest.settings,
          googleCalendar: {
            ...latestCalendar,
            accessToken: encryptValue(tokens.accessToken),
            refreshToken: tokens.refreshToken ? encryptValue(tokens.refreshToken) : latestCalendar.refreshToken,
            calendarId: latestCalendar.calendarId || 'primary',
            ...(typeof tokens.expiryDate === 'number' ? { expiryDate: tokens.expiryDate } : {}),
          },
        },
      })
    },
  })
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

      const appointments = await withDb(async (sql) => {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        const timezone = clinic?.timezone || 'America/Guatemala'
        const localBound = (value: string): string => {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
          const instant = clinicLocalInstant(`${value}T00:00:00`, timezone)
          if (!instant) throw new Error(`Invalid calendar date in clinic timezone: ${value}`)
          return instant.toISOString()
        }
        return createAppointmentsRepository(sql).listInRange(clinicId, {
          from: localBound(parsed.data.from),
          to: localBound(parsed.data.to),
          doctorId: parsed.data.doctorId,
        })
      })
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
      const canSeeBookedSlots = Boolean(parsed.data.includeBooked) &&
        ['secretary', 'clinic_admin', 'ia_studio_admin'].includes(request.user?.role ?? '')

      const result = await withDb(async (sql) => {
        const doctor = await createDoctorsRepository(sql).findById(clinicId, doctorId)
        if (!doctor) return null
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        const appts = createAppointmentsRepository(sql)
        const duration =
          (serviceId
            ? (await appts.listServices(clinicId)).find((s) => s.id === serviceId)?.durationMinutes
            : undefined) ?? DEFAULT_DURATION_MIN
        const timezone = clinic?.timezone || 'America/Guatemala'
        const dayStart = clinicLocalInstant(`${date}T00:00:00`, timezone)
        const dayEnd = clinicLocalInstant(`${nextDay(date)}T00:00:00`, timezone)
        const dayAppts = await appts.listInRange(clinicId, {
          from: dayStart?.toISOString() ?? `${date}T00:00:00`,
          to: dayEnd?.toISOString() ?? `${nextDay(date)}T00:00:00`,
          doctorId,
        })
        const ranges = rangesForDate(normalizeAvailability(doctor.availableDays), date)
        const configuredCadence = Number((clinic?.settings ?? {})['bookingCadenceMinutes'] ?? (clinic?.settings ?? {})['slotMinutes'])
        const cadence = Number.isFinite(configuredCadence) && configuredCadence > 0 ? configuredCadence : duration
        // Mirror routes/doctors.ts redactDoctor: "connected" = both tokens present.
        const calendarConnected = Boolean(
          doctor.googleCalendarAccessTokenEncrypted && doctor.googleCalendarRefreshTokenEncrypted,
        )
        const candidates = computeFreeSlots(ranges, duration, [], cadence)
        const capacity = Math.max(1, Number(doctor.manualOverbookingCapacity ?? 2))
        const slotRows = candidates.map((candidate) => {
          const overlappingAppointments = dayAppts.filter((appointment) => {
            const start = toMin(candidate.start)
            const end = toMin(candidate.end)
            return appointment.status !== 'cancelled' &&
              start < toMin(timeOf(appointment.endTime, timezone)) &&
              toMin(timeOf(appointment.startTime, timezone)) < end
          })
          const bookedCount = overlappingAppointments.length
          return {
            ...candidate,
            bookedCount,
            bookedByAiCount: overlappingAppointments.filter((appointment) => appointmentBookingSource(appointment) === 'ai').length,
            bookedBySecretaryCount: overlappingAppointments.filter((appointment) => appointmentBookingSource(appointment) === 'secretary').length,
            overbookingCapacity: capacity,
            parallelAvailable: bookedCount > 0 && bookedCount < capacity,
          }
        })
        return {
          date,
          doctorId,
          durationMinutes: duration,
          calendarConnected,
          working: ranges.length > 0,
          slots: canSeeBookedSlots
            ? slotRows
            : slotRows.filter((slot) => slot.bookedCount === 0).map(({ start, end }) => ({ start, end })),
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
    const { patientId, patientName, doctorId, serviceId, date, start, notes, urgent, overbook, overbookingReason } = parsed.data
    if (overbook && !(await isDocmeeExpansionFeatureEnabled('calendarPolicyV2', clinicId))) {
      return reply.code(404).send({ error: 'Not found' })
    }
    // Explicit capacity override is a manual operator action. AI/doctor callers
    // can create an ordinary booking, but cannot request an overbooked slot.
    if (overbook && !['secretary', 'clinic_admin', 'ia_studio_admin'].includes(request.user?.role ?? '')) {
      return reply.code(403).send({ error: 'Only secretary or admin operators may overbook a slot' })
    }

    const result = await withDb(async (sql) => {
      const doctor = await createDoctorsRepository(sql).findById(clinicId, doctorId)
      if (!doctor) return { error: 'doctor' as const }
      const appts = createAppointmentsRepository(sql)
      const clinic = await createClinicsRepository(sql).findById(clinicId)
      const duration =
        (serviceId
          ? (await appts.listServices(clinicId)).find((s) => s.id === serviceId)?.durationMinutes
          : undefined) ?? DEFAULT_DURATION_MIN
      const timezone = clinic?.timezone || 'America/Guatemala'
      const instantRange = clinicInstantRange(date, start, duration, timezone)
      if (!instantRange) return { error: 'invalid_time' as const }
      if (new Date(instantRange.startTime).getTime() <= Date.now()) return { error: 'past' as const }

      const patients = createPatientsRepository(sql)
      const patient = patientName
        ? await patients.create({ clinicId, fullName: patientName })
        : await patients.findById(clinicId, patientId!)
      if (!patient) return { error: 'patient' as const }

      const capacity = Math.max(1, Number(doctor.manualOverbookingCapacity ?? 2))
      const booking = await appts.saveWithinCapacity({
        mode: 'create',
        clinicId,
        // Always the resolved patient's id — patientId (the raw request param)
        // is undefined on the patientName/walk-in branch, which would silently
        // create the patient row but never link it to this appointment.
        patientId: patient.id,
        doctorId,
        serviceId,
        startTime: instantRange.startTime,
        endTime: instantRange.endTime,
        notes,
        bookingOrigin: 'manual',
        actorId: request.user?.userId,
        capacity,
        allowOverbooking: overbook === true,
        overbookingReason: overbookingReason?.trim(),
        // A panel booking has no conversation_id (→ "Booked by staff"); the urgent
        // flag lives on metadata so the calendar can colour the card red.
        metadata: urgent ? { urgent: true } : undefined,
      })
      if (!booking.ok) return { error: booking.reason }
      const appointment = booking.appointment
      // The Docmee appointment above is always saved — Google Calendar sync is a
      // best-effort attachment, not a precondition. A clinic with no Calendar
      // connected, or a live API failure, must never lose the booking; the row is
      // flagged pending and picked up by the background calendar-sync-retry job.
      const calendar = await clinicCalendar(sql, clinicId)
      let syncedAppointment = appointment
      if (calendar) {
        try {
          const googleEventId = await calendar.createEvent({
            title: eventTitle(patient.fullName),
            date,
            time: start,
            durationMinutes: duration,
            description: notes,
          })
          syncedAppointment = await appts.update(clinicId, appointment.id, {
            googleEventId,
            calendarSyncPending: false,
            calendarSyncError: null,
          })
        } catch (error) {
          request.log.error({ err: error }, 'manual booking Google Calendar create failed')
          const message = error instanceof Error ? error.message : String(error)
          syncedAppointment = await appts.update(clinicId, appointment.id, {
            calendarSyncPending: true,
            calendarSyncError: message,
          })
        }
      }
      // No calendar configured at all → the row already has calendar_sync_pending
      // = TRUE from creation; nothing more to do here, the retry sweep picks it up
      // automatically once a calendar is connected.
      await appts.addEvent(clinicId, syncedAppointment.id, 'confirmed', request.user?.userId)
      // Item 4 of the 25-item batch: secretary alert on a new confirmed booking.
      // Best-effort — a queue failure never breaks the booking itself.
      try {
        await notificationQueue.add('notify', {
          clinicId,
          type: 'booking_confirmed',
          idempotencyKey: `booking_confirmed:${syncedAppointment.id}`,
        })
      } catch (error) {
        request.log.error({ err: error }, 'failed to enqueue booking_confirmed notification')
      }
      return { appointment: syncedAppointment }
    })

    if ('error' in result) {
      if (result.error === 'clash') return reply.code(409).send({ error: 'Slot no longer available' })
      if (result.error === 'past') return reply.code(422).send({ error: 'Cannot book a past date' })
      if (result.error === 'invalid_time') return reply.code(422).send({ error: 'Invalid time in clinic timezone' })
      if (result.error === 'overbooking_reason') return reply.code(422).send({ error: 'overbookingReason is required' })
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

      const result = await withDb(async (sql) => {
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
          const duration = durationMinutes(existing.startTime, existing.endTime)
          const clinic = await createClinicsRepository(sql).findById(clinicId)
          const instantRange = clinicInstantRange(
            date,
            start,
            duration,
            clinic?.timezone || 'America/Guatemala',
          )
          if (!instantRange) return { error: 'invalid_time' as const }
          if (new Date(instantRange.startTime).getTime() <= Date.now()) return { error: 'past' as const }
          patch.startTime = instantRange.startTime
          patch.endTime = instantRange.endTime
        }

        let updated
        if (date !== undefined && start !== undefined) {
          const atomicUpdate = { ...patch }
          delete atomicUpdate.startTime
          delete atomicUpdate.endTime
          const moved = await appts.saveWithinCapacity({
            mode: 'reschedule',
            clinicId,
            appointmentId: request.params.apptId,
            startTime: patch.startTime!,
            endTime: patch.endTime!,
            update: atomicUpdate,
            actorId: request.user?.userId,
          })
          if (!moved.ok) return { error: moved.reason }
          updated = moved.appointment
        } else {
          updated = await appts.update(clinicId, request.params.apptId, patch)
        }
        // Item 4 of the 25-item batch: secretary alert on a reschedule / cancellation.
        // Best-effort — a queue failure never breaks the change itself.
        if (date !== undefined && start !== undefined) {
          try {
            await notificationQueue.add('notify', {
              clinicId,
              type: 'booking_rescheduled',
              idempotencyKey: `booking_rescheduled:${updated.id}:${updated.startTime}`,
            })
          } catch (error) {
            request.log.error({ err: error }, 'failed to enqueue booking_rescheduled notification')
          }
        }
        if (status !== undefined && STATUS_EVENT[status]) {
          await appts.addEvent(clinicId, updated.id, STATUS_EVENT[status]!, request.user?.userId)
          if (status === 'cancelled') {
            try {
              await notificationQueue.add('notify', {
                clinicId,
                type: 'booking_cancelled',
                idempotencyKey: `booking_cancelled:${updated.id}`,
              })
            } catch (error) {
              request.log.error({ err: error }, 'failed to enqueue booking_cancelled notification')
            }
          }
        }
        // Cancellation is a staff-facing lifecycle action and should feel instant
        // in the Calendar UI. The Docmee row is the source of truth, so when a
        // Google event exists we flag the owed delete for the background retry
        // worker instead of making the PATCH wait on a slow external API call.
        if (status === 'cancelled' && existing.googleEventId) {
          return appts.update(clinicId, updated.id, { calendarSyncPending: true, calendarSyncError: null })
        }
        // The Docmee-side reschedule above always applies. Google Calendar is a
        // best-effort attachment: if it's not connected or the call fails, the row
        // is flagged for the background calendar-sync-retry job instead of the
        // whole request failing — the reschedule already happened in Docmee.
        if (date !== undefined && start !== undefined && updated.googleEventId) {
          const calendar = await clinicCalendar(sql, clinicId)
          if (!calendar) {
            return appts.update(clinicId, updated.id, { calendarSyncPending: true })
          }
          try {
            await calendar.updateEvent({
              eventId: updated.googleEventId,
              title: eventTitle(null),
              date,
              time: start,
              durationMinutes: durationMinutes(updated.startTime, updated.endTime),
            })
            return appts.update(clinicId, updated.id, { calendarSyncPending: false, calendarSyncError: null })
          } catch (error) {
            request.log.error({ err: error }, 'manual booking Google Calendar update failed')
            const message = error instanceof Error ? error.message : String(error)
            return appts.update(clinicId, updated.id, { calendarSyncPending: true, calendarSyncError: message })
          }
        }
        return updated
      })

      if (!result) return reply.code(404).send({ error: 'Appointment not found' })
      if ('error' in result) {
        if (result.error === 'clash') return reply.code(409).send({ error: 'Slot no longer available' })
        if (result.error === 'past') return reply.code(422).send({ error: 'Cannot reschedule to a past date' })
        if (result.error === 'invalid_time') return reply.code(422).send({ error: 'Invalid time in clinic timezone' })
        return reply.code(404).send({ error: 'Appointment not found' })
      }
      return { appointment: result }
    },
  )
}

export default appointmentsRoute
