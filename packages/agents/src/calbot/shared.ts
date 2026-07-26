// Shared helpers for the calbot scheduling flows (book / reschedule / cancel /
// status). Parsing is deterministic so every flow advances identically under
// LLM_STUB and in tests — no model call is needed to fill a date or a time.
import type { Language } from '../botbase/language-detector.js'
import type { DoctorAvailability } from './doctor-availability.js'

export type { Language }

export interface ClinicInfo {
  name: string
  timezone: string
}

/** A clinic service a doctor offers (Req 30). Its duration sets the slot length. */
export interface ServiceRef {
  id: string
  name: string
  durationMinutes: number
}

export interface ProviderRef {
  id: string
  fullName: string
  /** Doctor/provider specialty, captured into the patient intake on booking (Req 10). */
  specialty?: string | null
  /** Per-doctor working hours (Req 30); when set, restricts the bookable slots. */
  availability?: DoctorAvailability
  /** Services this doctor offers (Req 30); when set, the patient picks one and its
   *  duration determines the appointment length. */
  services?: ServiceRef[]
}

/** A patient's existing upcoming appointment, as the flows need to see it. */
export interface UpcomingAppointment {
  id: string
  providerId: string
  providerName: string
  date: string // YYYY-MM-DD (clinic-local)
  time: string // HH:MM
  googleEventId: string | null
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Date helpers for natural-language parsing (CRE-46). Arithmetic runs on the
 * clinic-local `YYYY-MM-DD` string via UTC math so it is timezone-stable and
 * fully deterministic in tests.
 */
const WEEKDAYS: Record<string, number> = {
  domingo: 0, sunday: 0, sun: 0,
  lunes: 1, monday: 1, mon: 1,
  martes: 2, tuesday: 2, tue: 2, tues: 2,
  miercoles: 3, wednesday: 3, wed: 3,
  jueves: 4, thursday: 4, thu: 4, thurs: 4,
  viernes: 5, friday: 5, fri: 5,
  sabado: 6, saturday: 6, sat: 6,
}

/** Strip diacritics so "miercoles"/"manana" match the ASCII weekday keys. */
function deburr(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function isoToUtc(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

function utcToIso(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`
}

export function addDays(iso: string, days: number): string {
  const dt = isoToUtc(iso)
  dt.setUTCDate(dt.getUTCDate() + days)
  return utcToIso(dt)
}

/** Today as `YYYY-MM-DD` in the clinic timezone, anchoring relative dates. */
export function clinicToday(timezone: string): string {
  try {
    // 'en-CA' renders as YYYY-MM-DD.
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return utcToIso(new Date())
  }
}

/**
 * Extract a `YYYY-MM-DD` date from free text. Understands explicit dates
 * (`YYYY-MM-DD`, `DD/MM[/YYYY]`) and natural language relative to `refToday`
 * (clinic-local today): today/hoy, tomorrow/manana, day-after-tomorrow/
 * "pasado manana", and weekday names (monday/lunes, "next Monday"/"el lunes que
 * viene") resolving to the next future occurrence. Accent-insensitive. Returns
 * null when nothing date-like is present. Deterministic so it runs identically
 * under LLM_STUB and in tests.
 */
export function parseDate(text: string, refToday?: string): string | null {
  const today =
    refToday && /^\d{4}-\d{2}-\d{2}$/.test(refToday) ? refToday : utcToIso(new Date())

  // Explicit ISO date.
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`

  // DD/MM or DD/MM/YYYY.
  const dmy = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)
  if (dmy) {
    const day = Number(dmy[1])
    const month = Number(dmy[2])
    let y = dmy[3] ? Number(dmy[3]) : Number(today.slice(0, 4))
    if (y < 100) y += 2000
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${y}-${pad(month)}-${pad(day)}`
    }
  }

  // Natural language (accent-insensitive).
  const flat = deburr(text.toLowerCase())
  if (/\bpasado\s+manana\b/.test(flat) || /\bday\s+after\s+tomorrow\b/.test(flat)) {
    return addDays(today, 2)
  }
  const toks = flat.split(/[^a-z]+/).filter(Boolean)
  if (toks.includes('hoy') || toks.includes('today')) return today
  if (toks.includes('manana') || toks.includes('tomorrow')) return addDays(today, 1)
  for (const tok of toks) {
    const wd = WEEKDAYS[tok]
    if (wd === undefined) continue
    const todayWd = isoToUtc(today).getUTCDay()
    let delta = (wd - todayWd + 7) % 7
    if (delta === 0) delta = 7 // a bare weekday meaning "today" is ambiguous -> next week
    return addDays(today, delta)
  }

  return null
}

/**
 * Extract a 24h `HH:MM` time from free text. Understands `15:00`, `3pm`,
 * `3 pm`, `3:30pm`. Returns null when no time is present.
 */
export function parseTime(text: string): string | null {
  const lower = text.toLowerCase()
  const m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  const meridiem = m[3]
  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  // A bare number with no colon and no am/pm that looks like a date fragment is
  // still treated as an hour — callers ask for a time only when they expect one.
  return `${pad(hour)}:${pad(minute)}`
}

// Token-based matching — `\b` is ASCII-only and breaks on accented words like
// "sí", so we split on any non-letter and compare whole tokens instead.
// NOTE: 'cancelar' is deliberately NOT a negative word — in the cancel flow it is
// the affirmative action ("sí, cancelar"). Negation here means *declining* the
// prompt (keep things as they are / pick a different time).
const AFFIRMATIVE_WORDS = new Set([
  'sí', 'si', 'yes', 'yeah', 'yep', 'ok', 'okay', 'vale', 'dale', 'claro',
  'confirmo', 'confirmar', 'confirm', 'confirmada', 'confirmado', 'correcto',
  'perfecto', 'proceda', 'adelante',
])
const NEGATIVE_WORDS = new Set([
  'no', 'nope', 'cambiar', 'change', 'distinto', 'distinta', 'different',
  'déjala', 'dejala', 'déjalo', 'dejalo', 'negativo',
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-záéíóúñü]+/i)
    .filter(Boolean)
}

export function isAffirmative(text: string): boolean {
  return words(text).some((w) => AFFIRMATIVE_WORDS.has(w))
}

export function isNegative(text: string): boolean {
  return words(text).some((w) => NEGATIVE_WORDS.has(w))
}

/**
 * Match a provider from a numbered/named menu. The patient may reply with the
 * list position ("2") or a (partial, case-insensitive) name.
 */
export function matchProvider(text: string, providers: ProviderRef[]): ProviderRef | null {
  const lower = text.toLowerCase().trim()
  const num = lower.match(/\b(\d{1,2})\b/)
  if (num) {
    const idx = Number(num[1]) - 1
    if (idx >= 0 && idx < providers.length) return providers[idx]!
  }
  for (const p of providers) {
    const name = p.fullName.toLowerCase()
    if (lower.includes(name)) return p
    // Also match on any single name token (e.g. "García") of length 3+.
    if (name.split(/\s+/).some((part) => part.length >= 3 && lower.includes(part))) return p
  }
  return null
}

/**
 * Match a service from a numbered/named menu (Req 30). The patient may reply with
 * the list position ("2") or a (partial, case-insensitive) name ("limpieza").
 * Returns null when nothing matches so the caller can re-prompt.
 */
export function matchService(text: string, services: ServiceRef[]): ServiceRef | null {
  const lower = text.toLowerCase().trim()
  const num = lower.match(/\b(\d{1,2})\b/)
  if (num) {
    const idx = Number(num[1]) - 1
    if (idx >= 0 && idx < services.length) return services[idx]!
  }
  for (const s of services) {
    const name = s.name.toLowerCase()
    if (lower.includes(name)) return s
    if (name.split(/\s+/).some((part) => part.length >= 3 && lower.includes(part))) return s
  }
  return null
}

/** Format a slot's start as a human `YYYY-MM-DD HH:MM` for confirmation text. */
export function formatSlotLabel(date: string, time: string): string {
  return `${date} ${time}`
}

export function pick(language: Language, es: string, en: string): string {
  return language === 'en' ? en : es
}
