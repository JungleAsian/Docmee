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
