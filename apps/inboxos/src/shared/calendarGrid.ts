// Screen 2 (AI booking & calendar) — pure helpers that turn a doctor's weekly
// working hours into the day view's time axis. Mirrors the slot math the API uses
// (apps/api/src/lib/slots.ts): clinic-local wall-clock HH:MM strings throughout,
// the same Mon–Fri 09:00–17:00 default when a doctor has no hours configured, and
// split-shift awareness so a lunch gap renders as a "break" band on the grid.
//
// No React / no I/O, so it is fully unit-testable and shared by the grid + the
// doctor-hours strip.

export interface TimeRange {
  start: string // HH:MM (24h)
  end: string // HH:MM (24h), exclusive
}

type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
type Availability = Partial<Record<Weekday, TimeRange[]>>

// Index 0 = Sunday to match JS Date.getUTCDay().
const WEEKDAY_BY_INDEX: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const DEFAULT_HOURS: TimeRange = { start: '09:00', end: '17:00' }
const DEFAULT_WORKDAYS = new Set<Weekday>(['mon', 'tue', 'wed', 'thu', 'fri'])

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const toHHMM = (min: number): string =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function isWeekday(key: string): key is Weekday {
  return (WEEKDAYS as string[]).includes(key)
}

function normalizeRange(value: unknown): TimeRange | null {
  if (!value || typeof value !== 'object') return null
  const { start, end } = value as Record<string, unknown>
  if (typeof start !== 'string' || typeof end !== 'string') return null
  if (!HHMM.test(start) || !HHMM.test(end)) return null
  if (start >= end) return null
  return { start, end }
}

/** Parse a raw (JSONB) `availableDays` value into a clean weekly schedule. */
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
 * The doctor's working ranges for a date. When the doctor has hours set, an absent
 * weekday means a day off (no ranges). When NO hours are configured at all, the
 * default clinic window applies on weekdays so the grid still renders.
 */
export function rangesForDate(availability: Availability, date: string): TimeRange[] {
  const day = weekdayOf(date)
  if (!hasAnyAvailability(availability)) {
    return DEFAULT_WORKDAYS.has(day) ? [{ ...DEFAULT_HOURS }] : []
  }
  return (availability[day] ?? []).slice().sort((a, b) => toMin(a.start) - toMin(b.start))
}

export type AxisRowKind = 'working' | 'break'
export interface AxisRow {
  time: string // HH:MM — the row's start
  kind: AxisRowKind
}

/**
 * The day's time axis: stepped rows from the earliest working start to the latest
 * working end. Each row is `working` (inside a range) or `break` (a split-shift gap
 * between two ranges — e.g. lunch). Returns `[]` for a day off (no ranges).
 */
export function buildDayAxis(ranges: TimeRange[], stepMin = 30): AxisRow[] {
  if (ranges.length === 0 || stepMin <= 0) return []
  const mins = ranges.map((r) => ({ start: toMin(r.start), end: toMin(r.end) }))
  const axisStart = Math.min(...mins.map((r) => r.start))
  const axisEnd = Math.max(...mins.map((r) => r.end))
  const rows: AxisRow[] = []
  for (let t = axisStart; t < axisEnd; t += stepMin) {
    const working = mins.some((r) => t >= r.start && t < r.end)
    rows.push({ time: toHHMM(t), kind: working ? 'working' : 'break' })
  }
  return rows
}

/** Human-readable working-hours summary, e.g. "09:00–13:00, 14:00–17:00". */
export function formatRanges(ranges: TimeRange[]): string {
  return ranges.map((r) => `${r.start}–${r.end}`).join(', ')
}

/** True when the ranges describe more than one block in the day (a split shift). */
export function isSplitShift(ranges: TimeRange[]): boolean {
  return ranges.length > 1
}
