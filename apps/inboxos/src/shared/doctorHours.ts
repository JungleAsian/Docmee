// Req 30 (Multi-Doctor Clinics): pure helpers for editing a doctor's weekly
// working hours in Admin Studio. The data model already supports SPLIT SHIFTS — a
// list of ranges per day, e.g. 09:00–13:00 + 15:00–18:00 for a clinic that
// closes for lunch — and the API/engine honour every range. These helpers let
// the WeeklyHoursEditor add / remove / update individual shifts immutably, so
// the component stays a thin render layer. No React, no I/O — unit-testable.
import type { DoctorAvailability, TimeRange, Weekday } from './types'

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// Defaults used when the user enables a day or splits in a second shift.
const DEFAULT_SHIFT: TimeRange = { start: '09:00', end: '17:00' }
const DEFAULT_SECOND_SHIFT: TimeRange = { start: '15:00', end: '18:00' }

/** Whether the doctor works at all on `day` (has ≥1 shift configured). */
export function isDayEnabled(value: DoctorAvailability, day: Weekday): boolean {
  return (value[day]?.length ?? 0) > 0
}

/** Enable a day with one default shift, or disable it (remove every shift). */
export function setDayEnabled(
  value: DoctorAvailability,
  day: Weekday,
  enabled: boolean,
): DoctorAvailability {
  const next = cloneWithout(value, day)
  if (enabled) next[day] = [{ ...DEFAULT_SHIFT }]
  return next
}

/**
 * Append another shift to a day (split shift). Enables the day if it was off;
 * a second shift defaults to an afternoon block so it does not overlap the first.
 */
export function addShift(value: DoctorAvailability, day: Weekday): DoctorAvailability {
  const existing = value[day] ?? []
  const shift = existing.length ? { ...DEFAULT_SECOND_SHIFT } : { ...DEFAULT_SHIFT }
  return { ...value, [day]: [...existing, shift] }
}

/** Remove the shift at `index`; if it was the last one, the day becomes a day off. */
export function removeShift(
  value: DoctorAvailability,
  day: Weekday,
  index: number,
): DoctorAvailability {
  const existing = value[day] ?? []
  const remaining = existing.filter((_, i) => i !== index)
  if (remaining.length === 0) return cloneWithout(value, day)
  return { ...value, [day]: remaining }
}

/** Patch one endpoint (start and/or end) of a single shift. */
export function setShift(
  value: DoctorAvailability,
  day: Weekday,
  index: number,
  patch: Partial<TimeRange>,
): DoctorAvailability {
  const existing = value[day] ?? []
  const updated = existing.map((r, i) => (i === index ? { ...r, ...patch } : r))
  return { ...value, [day]: updated }
}

function cloneWithout(value: DoctorAvailability, day: Weekday): DoctorAvailability {
  const next = { ...value }
  delete next[day]
  return next
}
