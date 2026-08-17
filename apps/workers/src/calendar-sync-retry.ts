// Background Google Calendar sync retry. The Docmee `appointments` row is
// always the source of truth (booking/reschedule/cancel-flow, the workflow
// runner's booking node, and the Studio manual-booking API route all now save
// the row unconditionally and only flag `calendar_sync_pending` when the
// Calendar side-effect didn't land). This sweep finds those flagged rows and
// retries the owed Calendar operation, so a clinic that doesn't use Google
// Calendar at all — or one whose connection was temporarily broken — never
// loses a booking, and catches up automatically once Calendar is available.
//
// Runs on its own interval from index.ts (not nested in timeout-monitor.ts,
// since it has a different natural cadence and does real external API calls).
// Mirrors stalled-conversation.ts's shape: a pure decision function plus an
// impure per-row runner with a per-row try/catch so one bad row never aborts
// the tick.
import {
  createAppointmentsRepository,
  createClinicsRepository,
  type Appointment,
  type AppointmentWithNames,
  type Clinic,
  type Sql,
} from '@docmee/db'
import { resolveCalendarConfig, calendarOpsFor, type CalendarOps } from '@docmee/agents'

const BATCH_SIZE = 50
const MAX_AGE_DAYS = 30

export type CalendarSyncAction = 'create' | 'update' | 'delete' | 'none'

/**
 * What Calendar operation a row owes, derived purely from its current state:
 * cancelled + still has an event → delete it; otherwise no event yet →
 * create one; otherwise → the event exists but may be stale → update it.
 */
export function decideCalendarSyncAction(appt: Pick<Appointment, 'status' | 'googleEventId'>): CalendarSyncAction {
  if (appt.status === 'cancelled') return appt.googleEventId ? 'delete' : 'none'
  return appt.googleEventId ? 'update' : 'create'
}

function eventTitle(appt: AppointmentWithNames): string {
  const doctor = appt.doctorName ? ` con ${appt.doctorName}` : ''
  return appt.patientName ? `Cita: ${appt.patientName}${doctor}` : `Cita${doctor}`
}

function durationMinutes(appt: Pick<Appointment, 'startTime' | 'endTime'>): number {
  const ms = new Date(appt.endTime).getTime() - new Date(appt.startTime).getTime()
  return Math.max(5, Math.round(ms / 60_000))
}

export async function runCalendarSyncRetry(sql: Sql): Promise<void> {
  const appointments = createAppointmentsRepository(sql)
  const clinics = createClinicsRepository(sql)

  const clinicCache = new Map<string, Clinic | null>()
  const calendarCache = new Map<string, CalendarOps | null>()

  const candidates = await appointments.listCalendarSyncCandidates(BATCH_SIZE, MAX_AGE_DAYS)

  for (const appt of candidates) {
    try {
      const action = decideCalendarSyncAction(appt)
      if (action === 'none') {
        await appointments.update(appt.clinicId, appt.id, { calendarSyncPending: false, calendarSyncError: null })
        continue
      }

      if (!clinicCache.has(appt.clinicId)) {
        clinicCache.set(appt.clinicId, await clinics.findById(appt.clinicId))
      }
      const clinic = clinicCache.get(appt.clinicId) ?? null
      if (!clinic) continue // clinic gone — nothing to sync, leave pending

      const calendarKey = `${appt.clinicId}:${appt.doctorId ?? ''}`
      if (!calendarCache.has(calendarKey)) {
        const resolved = await resolveCalendarConfig(sql, clinic, appt.doctorId)
        calendarCache.set(calendarKey, calendarOpsFor(resolved))
      }
      const calendar = calendarCache.get(calendarKey) ?? null
      if (!calendar) continue // still no calendar connected — harmless, retried next tick

      if (action === 'create') {
        const eventId = await calendar.createEvent({
          title: eventTitle(appt),
          date: appt.startTime.slice(0, 10),
          time: appt.startTime.slice(11, 16),
          durationMinutes: durationMinutes(appt),
        })
        await appointments.update(appt.clinicId, appt.id, { googleEventId: eventId, calendarSyncPending: false, calendarSyncError: null })
      } else if (action === 'update') {
        await calendar.updateEvent({
          eventId: appt.googleEventId!,
          title: eventTitle(appt),
          date: appt.startTime.slice(0, 10),
          time: appt.startTime.slice(11, 16),
          durationMinutes: durationMinutes(appt),
        })
        await appointments.update(appt.clinicId, appt.id, { calendarSyncPending: false, calendarSyncError: null })
      } else {
        await calendar.deleteEvent(appt.googleEventId!)
        await appointments.update(appt.clinicId, appt.id, { googleEventId: null, calendarSyncPending: false, calendarSyncError: null })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[calendar-sync-retry] sync failed for appointment ${appt.id}:`, message)
      await appointments
        .update(appt.clinicId, appt.id, { calendarSyncError: message, calendarSyncAttempts: appt.calendarSyncAttempts + 1 })
        .catch((updateErr) => console.error('[calendar-sync-retry] failed to record sync error:', updateErr))
    }
  }
}
