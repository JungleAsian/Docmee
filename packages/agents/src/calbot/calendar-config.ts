// Consolidated Google Calendar credential resolution: doctor's own calendar,
// falling back to the clinic's shared one. This is the ONE place that should
// decide fallback policy — historically this logic was duplicated 3 times
// across apps/workers and apps/api with 3 different (inconsistent) fallback
// behaviors. New consumers (the calendar-sync-retry background job) should use
// this; migrating the existing duplicated call sites onto it is a separate,
// deliberately deferred follow-up (it also touches a known behavioral
// inconsistency in the WhatsApp booking flow that deserves its own review).
import type { Sql, Doctor, Clinic } from '@docmee/db'
import { createDoctorsRepository, createClinicsRepository } from '@docmee/db'
import { decryptValue, encryptValue } from '@docmee/shared'
import {
  createGoogleCalendarOps,
  type BookingGrid,
  type CalendarOps,
  type GoogleCalendarConfig,
  type RefreshedTokens,
} from './google-calendar-client.js'

export interface ResolvedCalendar {
  doctor: Doctor | null
  config: GoogleCalendarConfig
}

interface RawTokens {
  accessToken: string
  refreshToken: string
  calendarId: string
  expiryDate?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function clinicCalendarTokens(value: unknown): RawTokens | null {
  if (!isRecord(value)) return null
  const accessToken = value['accessToken']
  const refreshToken = value['refreshToken']
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  try {
    return {
      accessToken: decryptValue(accessToken),
      refreshToken: decryptValue(refreshToken),
      calendarId: typeof value['calendarId'] === 'string' ? value['calendarId'] : 'primary',
      ...(typeof value['expiryDate'] === 'number' ? { expiryDate: value['expiryDate'] } : {}),
    }
  } catch {
    // Tokens unreadable (rotated encryption key / corruption) → treat as not connected.
    return null
  }
}

function doctorCalendarTokens(doctor: Doctor): RawTokens | null {
  if (!doctor.googleCalendarAccessTokenEncrypted || !doctor.googleCalendarRefreshTokenEncrypted) return null
  try {
    return {
      accessToken: decryptValue(doctor.googleCalendarAccessTokenEncrypted),
      refreshToken: decryptValue(doctor.googleCalendarRefreshTokenEncrypted),
      calendarId: doctor.googleCalendarId ?? 'primary',
    }
  } catch {
    return null
  }
}

/**
 * Resolves which Google Calendar credentials should be used for a clinic (and
 * optionally a specific doctor) — the doctor's own calendar, falling back to
 * the clinic's shared one — without yet binding a client. Also returns the
 * resolved `doctor` row so callers that need it (e.g. availableDays) don't
 * have to re-fetch it.
 */
export async function resolveCalendarConfig(
  sql: Sql,
  clinic: Clinic,
  doctorId?: string | null,
): Promise<ResolvedCalendar | null> {
  const doctors = createDoctorsRepository(sql)
  const doctor = doctorId ? await doctors.findById(clinic.id, doctorId) : null
  const doctorTokens = doctor ? doctorCalendarTokens(doctor) : null
  const clinicTokens = clinicCalendarTokens(clinic.settings['googleCalendar'])
  const tokens = doctorTokens ?? clinicTokens
  if (!tokens) return null

  const persistTokens = async (refreshed: RefreshedTokens): Promise<void> => {
    if (doctor && doctorTokens) {
      await doctors.update(clinic.id, doctor.id, {
        googleCalendarAccessTokenEncrypted: encryptValue(refreshed.accessToken),
        ...(refreshed.refreshToken
          ? { googleCalendarRefreshTokenEncrypted: encryptValue(refreshed.refreshToken) }
          : {}),
      })
      return
    }
    const latest = await createClinicsRepository(sql).findById(clinic.id)
    if (!latest) return
    const existing = isRecord(latest.settings['googleCalendar'])
      ? (latest.settings['googleCalendar'] as Record<string, unknown>)
      : {}
    await createClinicsRepository(sql).update(clinic.id, {
      settings: {
        ...latest.settings,
        googleCalendar: {
          ...existing,
          accessToken: encryptValue(refreshed.accessToken),
          ...(refreshed.refreshToken ? { refreshToken: encryptValue(refreshed.refreshToken) } : {}),
          ...(typeof refreshed.expiryDate === 'number' ? { expiryDate: refreshed.expiryDate } : {}),
        },
      },
    })
  }

  return { doctor, config: { ...tokens, timezone: clinic.timezone, onTokensRefreshed: persistTokens } }
}

/** Binds a resolved calendar (or `null`, passed through) to a real `CalendarOps` client. */
export function calendarOpsFor(resolved: ResolvedCalendar | null, grid?: BookingGrid): CalendarOps | null {
  return resolved ? createGoogleCalendarOps({ ...resolved.config, ...(grid ? { grid } : {}) }) : null
}
