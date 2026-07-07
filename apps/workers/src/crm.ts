// Req 31 (CRM / Google Sheets Integration): resolve a clinic's CRM export target
// and build the exporter. The export reuses the clinic's unified Google OAuth
// tokens (same OAuth app as Calendar; the connect flow also requests the
// spreadsheets scope) and appends appointment/contact rows to the spreadsheet
// configured in clinics.settings.googleSheets. Pure resolution is exported so it
// is unit-testable without a DB or Google.
import { decryptValue } from '@docmee/shared'
import { createGoogleCrmExporter, type CrmExporter, type RefreshedTokens } from '@docmee/agents'
import type { Clinic, Patient } from '@docmee/db'

export interface CrmSettings {
  spreadsheetId: string
  sheetName?: string
}

/**
 * Read the clinic's CRM export config from settings.googleSheets. Returns null
 * unless the export is explicitly enabled AND a spreadsheet id is configured —
 * CRM export is opt-in per clinic, so an unset/disabled clinic never exports.
 */
export function getCrmSettings(clinic: Clinic): CrmSettings | null {
  const gs = (clinic.settings as { googleSheets?: unknown }).googleSheets
  if (!gs || typeof gs !== 'object') return null
  const { spreadsheetId, sheetName, enabled } = gs as Record<string, unknown>
  if (enabled !== true) return null
  if (typeof spreadsheetId !== 'string' || !spreadsheetId) return null
  return {
    spreadsheetId,
    ...(typeof sheetName === 'string' && sheetName ? { sheetName } : {}),
  }
}

interface GoogleTokens {
  accessToken: string
  refreshToken: string
  expiryDate?: number
}

// The Sheets export rides the clinic's Google Calendar OAuth tokens (same OAuth
// app + connection). Unreadable tokens (rotated key / corruption) → not connected.
function getGoogleTokens(clinic: Clinic): GoogleTokens | null {
  const gc = (clinic.settings as { googleCalendar?: unknown }).googleCalendar
  if (!gc || typeof gc !== 'object') return null
  const { accessToken, refreshToken, expiryDate } = gc as Record<string, unknown>
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  try {
    return {
      accessToken: decryptValue(accessToken),
      refreshToken: decryptValue(refreshToken),
      ...(typeof expiryDate === 'number' ? { expiryDate } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Build a CRM exporter bound to the clinic's Sheets target + Google tokens, or
 * null when CRM export is disabled, unconfigured, or the clinic has no usable
 * Google connection. The optional onTokensRefreshed lets the caller persist a
 * refreshed access token (the scheduling worker reuses its calendar persister).
 */
export function createClinicCrmExporter(
  clinic: Clinic,
  onTokensRefreshed?: (t: RefreshedTokens) => void | Promise<void>,
): CrmExporter | null {
  const crm = getCrmSettings(clinic)
  if (!crm) return null
  const tokens = getGoogleTokens(clinic)
  if (!tokens) return null
  return createGoogleCrmExporter({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    spreadsheetId: crm.spreadsheetId,
    ...(crm.sheetName ? { sheetName: crm.sheetName } : {}),
    ...(tokens.expiryDate !== undefined ? { expiryDate: tokens.expiryDate } : {}),
    ...(onTokensRefreshed ? { onTokensRefreshed } : {}),
  })
}

/** Best phone for a patient: the captured intake phone, else the contact handle. */
export function patientPhone(patient: Patient | null, fallback = ''): string {
  if (!patient) return fallback
  const md = patient.metadata as { phone?: unknown; contactHandle?: unknown }
  if (typeof md.phone === 'string' && md.phone) return md.phone
  if (typeof md.contactHandle === 'string' && md.contactHandle) return md.contactHandle
  return fallback
}
