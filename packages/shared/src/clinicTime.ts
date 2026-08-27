/** Calendar helpers shared by the API and workers. They convert a clinic-local
 * wall clock into a real instant without relying on the host process timezone. */
export function formattedClinicParts(
  instant: Date,
  timezone: string,
): [number, number, number, number, number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone || 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return [get('year'), get('month'), get('day'), get('hour'), get('minute'), get('second')]
}

/** Convert `YYYY-MM-DDTHH:mm[:ss]` in an IANA timezone to an instant.
 * Returns null for malformed values and local times that do not exist at a DST
 * transition. */
export function clinicLocalInstant(value: string, timezone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const desired = [
    Number(match[1]), Number(match[2]), Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] ?? 0),
  ] as [number, number, number, number, number, number]
  const desiredWallMs = Date.UTC(
    desired[0], desired[1] - 1, desired[2], desired[3], desired[4], desired[5],
  )
  let instantMs = desiredWallMs
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      const actual = formattedClinicParts(new Date(instantMs), timezone)
      const actualWallMs = Date.UTC(
        actual[0], actual[1] - 1, actual[2], actual[3], actual[4], actual[5],
      )
      instantMs += desiredWallMs - actualWallMs
    }
    const instant = new Date(instantMs)
    return formattedClinicParts(instant, timezone).every((part, index) => part === desired[index])
      ? instant
      : null
  } catch {
    return null
  }
}

export function addClinicLocalMinutes(date: string, time: string, minutes: number): string {
  const wallClock = new Date(`${date}T${time}:00Z`)
  wallClock.setUTCMinutes(wallClock.getUTCMinutes() + minutes)
  return wallClock.toISOString().slice(0, 19)
}

export function clinicInstantRange(
  date: string,
  time: string,
  durationMinutes: number,
  timezone: string,
): { startTime: string; endTime: string } | null {
  const start = clinicLocalInstant(`${date}T${time}:00`, timezone)
  const end = clinicLocalInstant(addClinicLocalMinutes(date, time, durationMinutes), timezone)
  if (!start || !end) return null
  return { startTime: start.toISOString(), endTime: end.toISOString() }
}

export function clinicDate(instant: string | Date, timezone: string): string {
  const value = instant instanceof Date ? instant : new Date(instant)
  const [year, month, day] = formattedClinicParts(value, timezone)
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
