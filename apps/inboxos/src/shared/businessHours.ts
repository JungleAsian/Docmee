// Business-hours helpers for the Admin Studio bot config. The shape mirrors
// @docmee/agents' BusinessHours (lowercase weekday → { open, close, closed }).
import type { BusinessHours, DayHours } from './types'

/** Monday-first weekday order used by the visual picker. */
export const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

export type Weekday = (typeof WEEKDAYS)[number]

export const DEFAULT_DAY: DayHours = { open: '09:00', close: '17:00', closed: false }

/** Normalise a (possibly partial) settings value into a full 7-day map. */
export function toBusinessHours(value: unknown): BusinessHours {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const out: BusinessHours = {}
  for (const day of WEEKDAYS) {
    const raw = source[day]
    if (raw && typeof raw === 'object') {
      const d = raw as Partial<DayHours>
      out[day] = {
        open: typeof d.open === 'string' ? d.open : DEFAULT_DAY.open,
        close: typeof d.close === 'string' ? d.close : DEFAULT_DAY.close,
        closed: Boolean(d.closed),
      }
    } else {
      out[day] = { ...DEFAULT_DAY }
    }
  }
  return out
}
