// Business-hours check for the clinic bot (Decision 1: outside-hours routing).
// Pure: takes the clinic's configured hours + timezone, no I/O.

export interface DayHours {
  open: string // 'HH:mm'
  close: string // 'HH:mm'
  closed?: boolean
}

/** Map of lowercase full weekday name ('monday' … 'sunday') → hours. */
export type BusinessHours = Record<string, DayHours>

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/**
 * True when `now` (evaluated in `timezone`) falls inside the configured open
 * window for the current weekday. A clinic with no configured hours is treated
 * as always open so the bot still answers — outside-hours silence is opt-in.
 */
export function isInsideBusinessHours(
  businessHours: BusinessHours | null | undefined,
  timezone: string,
): boolean {
  if (!businessHours || Object.keys(businessHours).length === 0) return true

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = formatter.formatToParts(new Date())
  const weekday = parts.find((p) => p.type === 'weekday')?.value?.toLowerCase()
  // Intl can emit '24' for midnight under hour12:false — normalise to 0.
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10) % 24
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)

  if (!weekday) return true
  const hours = businessHours[weekday]
  if (!hours || hours.closed) return false

  const current = hour * 60 + minute
  return current >= toMinutes(hours.open) && current < toMinutes(hours.close)
}
