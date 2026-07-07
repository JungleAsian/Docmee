// Screen 2 (AI booking & calendar — Req 9/30): pure free-slot computation for the
// panel's slot picker. Given a doctor's weekly working hours, the requested date,
// the service duration and the times already taken, it produces the bookable start
// times. No DB / no I/O, so it is fully unit-testable and runs identically in tests
// and production. Times are clinic-local wall-clock HH:MM strings throughout — the
// panel works in the clinic's own time and the API echoes the same strings back.

export interface TimeRange {
  start: string // HH:MM (24h)
  end: string // HH:MM (24h), exclusive
}

export interface Slot {
  start: string // HH:MM
  end: string // HH:MM
}

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type Availability = Partial<Record<Weekday, TimeRange[]>>

// Index 0 = Sunday to match JS Date.getUTCDay().
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// Used when a doctor has NO weekly hours configured at all, so staff can still book
// a reasonable default window rather than face an empty picker (Mon–Fri 09:00–17:00).
const DEFAULT_HOURS: TimeRange = { start: '09:00', end: '17:00' }
const DEFAULT_WORKDAYS = new Set<Weekday>(['mon', 'tue', 'wed', 'thu', 'fri'])

function isWeekday(key: string): key is Weekday {
  return (WEEKDAYS as string[]).includes(key)
}

function normalizeRange(value: unknown): TimeRange | null {
  if (!value || typeof value !== 'object') return null
  const { start, end } = value as Record<string, unknown>
  if (typeof start !== 'string' || typeof end !== 'string') return null
  if (!HHMM.test(start) || !HHMM.test(end)) return null
  if (start >= end) return null // drop empty / reversed ranges
  return { start, end }
}

/** Parse a raw (JSONB) `available_days` value into a clean weekly schedule. */
export function normalizeAvailability(input: unknown): Availability {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out: Availability = {}
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isWeekday(key)) continue
    if (!Array.isArray(value)) continue
    const ranges = value.map(normalizeRange).filter((r): r is TimeRange => r !== null)
    if (ranges.length) out[key] = ranges
  }
  return out
}

function hasAnyAvailability(a: Availability): boolean {
  return WEEKDAYS.some((d) => (a[d]?.length ?? 0) > 0)
}

/** The weekday key (`mon`…`sun`) for a `YYYY-MM-DD` date (parsed as UTC midnight). */
export function weekdayOf(date: string): Weekday {
  return WEEKDAY_BY_INDEX[new Date(`${date}T00:00:00Z`).getUTCDay()]!
}

/**
 * The doctor's working ranges for a given date. When the doctor has hours set, an
 * absent weekday means a day off (no ranges). When NO hours are configured at all,
 * the default clinic window applies on weekdays so booking still works.
 */
export function rangesForDate(availability: Availability, date: string): TimeRange[] {
  const day = weekdayOf(date)
  if (!hasAnyAvailability(availability)) {
    return DEFAULT_WORKDAYS.has(day) ? [{ ...DEFAULT_HOURS }] : []
  }
  return availability[day] ?? []
}

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * Bookable start times: each working range is walked in `durationMinutes` steps and
 * a candidate is kept only if it fits inside the range and collides with none of the
 * `busy` intervals (existing, non-cancelled appointments for that doctor/date).
 */
export function computeFreeSlots(
  ranges: TimeRange[],
  durationMinutes: number,
  busy: TimeRange[],
): Slot[] {
  if (durationMinutes <= 0) return []
  const busyMin = busy.map((b) => ({ start: toMin(b.start), end: toMin(b.end) }))
  const slots: Slot[] = []
  for (const range of ranges) {
    const rangeStart = toMin(range.start)
    const rangeEnd = toMin(range.end)
    for (let s = rangeStart; s + durationMinutes <= rangeEnd; s += durationMinutes) {
      const e = s + durationMinutes
      if (busyMin.some((b) => overlaps(s, e, b.start, b.end))) continue
      slots.push({ start: toHHMM(s), end: toHHMM(e) })
    }
  }
  return slots
}
