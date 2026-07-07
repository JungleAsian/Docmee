// Only file permitted to import googleapis (enforced by the no-direct-googleapis
// convention). Everything else in the codebase talks to Google Calendar through
// the CalendarOps interface so the flows stay pure and testable.
import type { Auth, calendar_v3 } from 'googleapis'
import type { CalendarClient, AppointmentData } from '../index.js'

// googleapis is a heavy module; import it lazily so merely loading the agents
// barrel (router, botbase, calbot flows) stays fast. Only the calendar I/O paths
// pay the load cost, and only once.
type GoogleApi = (typeof import('googleapis'))['google']
let googlePromise: Promise<GoogleApi> | null = null
function loadGoogle(): Promise<GoogleApi> {
  if (!googlePromise) googlePromise = import('googleapis').then((m) => m.google)
  return googlePromise
}

const SLOT_MINUTES = 30
const DAY_START_HOUR = 9 // 09:00
const DAY_END_HOUR = 18 // 18:00

const pad = (n: number): string => String(n).padStart(2, '0')

function addLocalMinutes(date: string, time: string, durationMinutes: number): { start: string; end: string } {
  const startMinutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  const endMinutes = startMinutes + durationMinutes
  const start = `${date}T${time}:00`
  const dayOffset = Math.floor(endMinutes / (24 * 60))
  const endDate = new Date(`${date}T00:00:00Z`)
  endDate.setUTCDate(endDate.getUTCDate() + dayOffset)
  const minuteOfDay = ((endMinutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const end = `${endDate.toISOString().slice(0, 10)}T${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}:00`
  return { start, end }
}

export interface TimeSlot {
  start: string // `YYYY-MM-DDTHH:MM:SS` (clinic-local, naive)
  end: string
}

export interface CreateEventParams {
  accessToken: string
  refreshToken: string
  calendarId: string
  title: string
  date: string // YYYY-MM-DD
  time: string // HH:MM
  durationMinutes: number
  timezone: string
  description?: string
}

/**
 * Build an OAuth2 client for a clinic's Google Calendar connection. The clinicId
 * is accepted for symmetry / future per-clinic credentials, but the OAuth app
 * itself is shared (one Google Cloud project for the SaaS).
 */
export async function getOAuth2Client(_clinicId: string): Promise<Auth.OAuth2Client> {
  const google = await loadGoogle()
  return new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI'],
  )
}

async function authedCalendar(accessToken: string, refreshToken: string) {
  const google = await loadGoogle()
  const auth = await getOAuth2Client('')
  auth.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth })
}

/** Access token (plus rotation/expiry) emitted by googleapis after a refresh. */
export interface RefreshedTokens {
  accessToken: string
  /** Present only when Google rotates the refresh token. */
  refreshToken?: string
  /** Unix epoch ms the new access token expires. */
  expiryDate?: number
}

/**
 * Build a Calendar client whose OAuth2 credentials carry an expiry so googleapis
 * proactively refreshes the access token before it 401s. When the expiry is
 * unknown (older connections persisted before we stored it), we set it in the
 * past to force a refresh on first use — correctness over an extra round-trip.
 * The `tokens` event forwards any refreshed token to {@link GoogleCalendarConfig.onTokensRefreshed}
 * so the caller can persist it and avoid refreshing on every job.
 */
async function buildAuthedCalendar(config: GoogleCalendarConfig): Promise<calendar_v3.Calendar> {
  const google = await loadGoogle()
  const auth = await getOAuth2Client('')
  auth.setCredentials({
    access_token: config.accessToken,
    refresh_token: config.refreshToken,
    expiry_date: config.expiryDate ?? 1,
  })
  const onRefresh = config.onTokensRefreshed
  if (onRefresh) {
    auth.on('tokens', (tokens) => {
      if (!tokens.access_token) return
      Promise.resolve(
        onRefresh({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? undefined,
          expiryDate: tokens.expiry_date ?? undefined,
        }),
      ).catch((e) => console.error('[calendar] failed to persist refreshed tokens', e))
    })
  }
  return google.calendar({ version: 'v3', auth })
}

async function slotsFromClient(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  date: string,
  timezone: string,
  grid?: BookingGrid,
): Promise<TimeSlot[]> {
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59`)
  const { data } = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })
  return computeFreeSlots(data.items ?? [], date, timezone, grid)
}

/** Free 30-min slots between 09:00–18:00 on `date`, minus anything already booked. */
export async function listAvailableSlots(
  accessToken: string,
  refreshToken: string,
  calendarId: string,
  date: string,
  timezone: string,
  grid?: BookingGrid,
): Promise<TimeSlot[]> {
  const calendar = await authedCalendar(accessToken, refreshToken)
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(`${date}T23:59:59`)

  const { data } = await calendar.events.list({
    calendarId,
    timeMin: dayStart.toISOString(),
    timeMax: dayEnd.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
  })

  return computeFreeSlots(data.items ?? [], date, timezone, grid)
}

/** Create a calendar event; returns the Google event id. */
export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  const calendar = await authedCalendar(params.accessToken, params.refreshToken)
  const range = addLocalMinutes(params.date, params.time, params.durationMinutes)

  const { data } = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.title,
      description: params.description,
      start: { dateTime: range.start, timeZone: params.timezone },
      end: { dateTime: range.end, timeZone: params.timezone },
    },
  })

  if (!data.id) throw new Error('Google Calendar did not return an event id')
  return data.id
}

/** Move an existing event to a new date/time (reschedule). */
export async function updateCalendarEvent(params: CreateEventParams & { eventId: string }): Promise<void> {
  const calendar = await authedCalendar(params.accessToken, params.refreshToken)
  const range = addLocalMinutes(params.date, params.time, params.durationMinutes)

  await calendar.events.patch({
    calendarId: params.calendarId,
    eventId: params.eventId,
    requestBody: {
      start: { dateTime: range.start, timeZone: params.timezone },
      end: { dateTime: range.end, timeZone: params.timezone },
    },
  })
}

export async function deleteCalendarEvent(
  accessToken: string,
  refreshToken: string,
  calendarId: string,
  eventId: string,
): Promise<void> {
  const calendar = await authedCalendar(accessToken, refreshToken)
  await calendar.events.delete({ calendarId, eventId })
}

interface RawEvent {
  start?: { dateTime?: string | null } | null
  end?: { dateTime?: string | null } | null
}

/**
 * Generate 30-min slots from 09:00 to 18:00 on `date` and drop any that overlap an
 * existing event. Pure: exported so the slot maths can be unit-tested without Google.
 */
/** CRE-47: per-clinic bookable grid. Defaults to 09:00–18:00 in 30-min slots. */
export interface BookingGrid {
  startHour: number // inclusive, 0–23
  endHour: number // exclusive
  slotMinutes: number
}

export const DEFAULT_BOOKING_GRID: BookingGrid = {
  startHour: DAY_START_HOUR,
  endHour: DAY_END_HOUR,
  slotMinutes: SLOT_MINUTES,
}

export function computeFreeSlots(
  events: RawEvent[],
  date: string,
  _timezone: string,
  grid: BookingGrid = DEFAULT_BOOKING_GRID,
): TimeSlot[] {
  const slots: TimeSlot[] = []
  const pad = (n: number) => String(n).padStart(2, '0')

  const dayStart = grid.startHour * 60
  const dayEnd = grid.endHour * 60
  const step = grid.slotMinutes > 0 ? grid.slotMinutes : SLOT_MINUTES

  for (let startMin = dayStart; startMin + step <= dayEnd; startMin += step) {
    const endMin = startMin + step
    const start = `${date}T${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}:00`
    const end = `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`

    const conflict = events.some((ev) => {
      const evStart = ev.start?.dateTime
      const evEnd = ev.end?.dateTime
      if (!evStart || !evEnd) return false
      return new Date(evStart) < new Date(end) && new Date(evEnd) > new Date(start)
    })

    if (!conflict) slots.push({ start, end })
  }
  return slots
}

/**
 * CalendarOps is the narrow surface the booking/reschedule/cancel flows depend on.
 * The worker binds the real Google implementation; tests bind an in-memory stub.
 */
export interface CalendarOps {
  listSlots(date: string): Promise<TimeSlot[]>
  createEvent(params: { title: string; date: string; time: string; durationMinutes: number; description?: string }): Promise<string>
  updateEvent(params: { eventId: string; title: string; date: string; time: string; durationMinutes: number }): Promise<void>
  deleteEvent(eventId: string): Promise<void>
}

export interface GoogleCalendarConfig {
  accessToken: string
  refreshToken: string
  calendarId: string
  timezone: string
  /** Unix epoch ms the access token expires; enables proactive refresh. */
  expiryDate?: number
  /** Persist refreshed tokens (access/expiry, and refresh if rotated). */
  onTokensRefreshed?: (tokens: RefreshedTokens) => void | Promise<void>
  /** CRE-47: per-clinic bookable grid (hours + slot length). Defaults to 09:00–18:00 / 30-min. */
  grid?: BookingGrid
}

/**
 * Bind {@link CalendarOps} to a clinic's Google credentials. A single
 * refresh-aware Calendar client is built once and shared across every op so the
 * access token is refreshed (and the `tokens` event fires) at most once per
 * binding rather than per call.
 */
export function createGoogleCalendarOps(config: GoogleCalendarConfig): CalendarOps {
  let clientPromise: Promise<calendar_v3.Calendar> | null = null
  const client = () => (clientPromise ??= buildAuthedCalendar(config))

  return {
    listSlots: async (date) => slotsFromClient(await client(), config.calendarId, date, config.timezone, config.grid),
    createEvent: async (p) => {
      const calendar = await client()
      const range = addLocalMinutes(p.date, p.time, p.durationMinutes)
      const { data } = await calendar.events.insert({
        calendarId: config.calendarId,
        requestBody: {
          summary: p.title,
          description: p.description,
          start: { dateTime: range.start, timeZone: config.timezone },
          end: { dateTime: range.end, timeZone: config.timezone },
        },
      })
      if (!data.id) throw new Error('Google Calendar did not return an event id')
      return data.id
    },
    updateEvent: async (p) => {
      const calendar = await client()
      const range = addLocalMinutes(p.date, p.time, p.durationMinutes)
      await calendar.events.patch({
        calendarId: config.calendarId,
        eventId: p.eventId,
        requestBody: {
          start: { dateTime: range.start, timeZone: config.timezone },
          end: { dateTime: range.end, timeZone: config.timezone },
        },
      })
    },
    deleteEvent: async (eventId) => {
      const calendar = await client()
      await calendar.events.delete({ calendarId: config.calendarId, eventId })
    },
  }
}

/**
 * Adapter to the legacy CalendarClient interface (kept for back-compat with the
 * P03 agents barrel). New code should prefer {@link createGoogleCalendarOps}.
 */
export function createGoogleCalendarClient(config: GoogleCalendarConfig): CalendarClient {
  const ops = createGoogleCalendarOps(config)
  return {
    async listSlots(_doctorId, date) {
      return (await ops.listSlots(date)).map((s) => s.start)
    },
    async bookAppointment(data: AppointmentData) {
      return ops.createEvent({
        title: data.patientName ? `Cita: ${data.patientName}` : 'Cita',
        date: data.date,
        time: data.time,
        durationMinutes: SLOT_MINUTES,
      })
    },
    async cancelAppointment(appointmentId) {
      await ops.deleteEvent(appointmentId)
    },
    async rescheduleAppointment(appointmentId, newData) {
      await ops.updateEvent({
        eventId: appointmentId,
        title: newData.patientName ? `Cita: ${newData.patientName}` : 'Cita',
        date: newData.date,
        time: newData.time,
        durationMinutes: SLOT_MINUTES,
      })
      return appointmentId
    },
  }
}
