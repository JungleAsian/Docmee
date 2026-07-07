// Req 30 (Multi-Doctor Clinics): per-doctor working hours.
//
// A doctor's `available_days` JSONB (doctors table) is parsed here into a clean,
// validated weekly schedule and used to RESTRICT the free slots the booking flow
// offers — so a patient can only book a doctor on days/times that doctor actually
// works. Pure: no DB / no I/O, so it is fully unit-testable and runs identically
// under LLM_STUB and in production.
//
// Shape (as stored / accepted by the API):
//   { "mon": [{ "start": "09:00", "end": "13:00" }, { "start": "15:00", "end": "18:00" }],
//     "fri": [{ "start": "09:00", "end": "14:00" }] }
// A weekday absent from the map (when ANY day is configured) means the doctor does
// NOT work that day. An entirely empty map means "no per-doctor restriction" — the
// clinic's default hours apply, preserving behaviour for doctors with no schedule set.
import type { TimeSlot } from './google-calendar-client.js'

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TimeRange {
  start: string // HH:MM (24h)
  end: string // HH:MM (24h), exclusive
}

export type DoctorAvailability = Partial<Record<Weekday, TimeRange[]>>

// Index 0 = Sunday to match JS Date.getUTCDay().
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function isWeekday(key: string): key is Weekday {
  return (WEEKDAYS as string[]).includes(key)
}

function normalizeRange(value: unknown): TimeRange | null {
  if (!value || typeof value !== 'object') return null
  const { start, end } = value as Record<string, unknown>
  if (typeof start !== 'string' || typeof end !== 'string') return null
  if (!HHMM.test(start) || !HHMM.test(end)) return null
  // A range must be non-empty and ordered; drop "13:00–13:00" or reversed ranges.
  if (start >= end) return null
  return { start, end }
}

/**
 * Parse a raw `available_days` value (possibly malformed — it comes from JSONB)
 * into a clean {@link DoctorAvailability}: only known weekdays, only valid ordered
 * HH:MM ranges, days with no valid ranges dropped. Returns `{}` for junk input.
 */
export function normalizeAvailability(input: unknown): DoctorAvailability {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: DoctorAvailability = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isWeekday(key)) continue
    if (!Array.isArray(value)) continue
    const ranges = value.map(normalizeRange).filter((r): r is TimeRange => r !== null)
    if (ranges.length) out[key] = ranges
  }
  return out
}

/** Whether any per-doctor working hours are configured (i.e. a restriction applies). */
export function hasAvailability(availability: DoctorAvailability): boolean {
  return WEEKDAYS.some((d) => (availability[d]?.length ?? 0) > 0)
}

/** The weekday key (`mon`…`sun`) for a `YYYY-MM-DD` date. */
export function weekdayOf(date: string): Weekday {
  // Parse as UTC midnight so the weekday is stable regardless of the host TZ; the
  // date string is already clinic-local and carries no time component.
  const d = new Date(`${date}T00:00:00Z`)
  return WEEKDAY_BY_INDEX[d.getUTCDay()]!
}

/** Whether the doctor works at all on `date` (false = day off when hours are set). */
export function worksOnDay(availability: DoctorAvailability, date: string): boolean {
  if (!hasAvailability(availability)) return true
  return (availability[weekdayOf(date)]?.length ?? 0) > 0
}

/** Whether `time` (HH:MM) falls inside one of the doctor's ranges for `date`. */
export function isWithinAvailability(availability: DoctorAvailability, date: string, time: string): boolean {
  if (!hasAvailability(availability)) return true
  const ranges = availability[weekdayOf(date)]
  if (!ranges?.length) return false
  return ranges.some((r) => time >= r.start && time < r.end)
}

/**
 * Drop any free slot whose start time is outside the doctor's working hours for
 * `date`. A no-op when no per-doctor hours are configured (clinic default applies).
 */
export function filterSlotsByAvailability(
  slots: TimeSlot[],
  date: string,
  availability: DoctorAvailability,
): TimeSlot[] {
  if (!hasAvailability(availability)) return slots
  const ranges = availability[weekdayOf(date)]
  if (!ranges?.length) return [] // day off → no bookable slots
  return slots.filter((s) => {
    const time = s.start.slice(11, 16) // HH:MM out of YYYY-MM-DDTHH:MM:SS
    return ranges.some((r) => time >= r.start && time < r.end)
  })
}
