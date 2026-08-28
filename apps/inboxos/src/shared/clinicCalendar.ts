/** Return the YYYY-MM-DD seen by the clinic, never the browser/UTC date. */
export function clinicDateKey(instant: string | Date, timezone: string): string {
  const date = instant instanceof Date ? instant : new Date(instant)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function appointmentsForClinicDate<
  T extends { startTime: string; status?: string },
>(appointments: T[], date: string, timezone: string): T[] {
  return appointments
    .filter((appointment) => appointment.status !== 'cancelled' && clinicDateKey(appointment.startTime, timezone) === date)
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
}

export function activeAppointmentsByClinicDate<
  T extends { startTime: string; status?: string },
>(appointments: T[], timezone: string): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue
    const key = clinicDateKey(appointment.startTime, timezone)
    grouped.set(key, [...(grouped.get(key) ?? []), appointment])
  }
  return grouped
}
