// Consumes: sheets-sync queue (Gap #35 — Google Sheets export).
//
// An hourly tick syncs each configured clinic's conversations to its Google Sheet
// at local midnight. Auth reuses the clinic's Google Calendar OAuth tokens (same
// OAuth app); the target spreadsheet id lives in clinic.settings.googleSheets.
import { decryptValue } from '@docmee/shared'
import { createGoogleSheetsOps } from '@docmee/agents'
import {
  createServiceDbClient,
  createClinicsRepository,
  createAnalyticsRepository,
  type Clinic,
} from '@docmee/db'
import { type Job } from '@docmee/queue'
import { localTimeIn } from './reports.worker.js'

const SYNC_HOUR = 0 // local midnight
const EXPORT_WINDOW_DAYS = 30

interface SheetsConnection {
  accessToken: string
  refreshToken: string
  spreadsheetId: string
}

/** Resolve a clinic's Sheets connection (Calendar OAuth tokens + spreadsheet id). */
export function getSheetsConnection(clinic: Clinic): SheetsConnection | null {
  const settings = clinic.settings as {
    googleCalendar?: { accessToken?: unknown; refreshToken?: unknown }
    googleSheets?: { spreadsheetId?: unknown }
  }
  const spreadsheetId = settings.googleSheets?.spreadsheetId
  const accessToken = settings.googleCalendar?.accessToken
  const refreshToken = settings.googleCalendar?.refreshToken
  if (typeof spreadsheetId !== 'string' || !spreadsheetId) return null
  if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') return null
  try {
    return {
      accessToken: decryptValue(accessToken),
      refreshToken: decryptValue(refreshToken),
      spreadsheetId,
    }
  } catch {
    return null
  }
}

export async function processSheetsSyncJob(_job: Job): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  const now = new Date()

  try {
    const clinics = createClinicsRepository(sql)
    const analytics = createAnalyticsRepository(sql)

    for (const clinic of await clinics.list()) {
      if (clinic.status !== 'active') continue
      if (localTimeIn(clinic.timezone, now).hour !== SYNC_HOUR) continue

      const connection = getSheetsConnection(clinic)
      if (!connection) continue

      const rows = await analytics.conversationExport(clinic.id, EXPORT_WINDOW_DAYS, clinic.timezone)
      const sheets = createGoogleSheetsOps(connection)
      try {
        await sheets.syncConversations(rows)
      } catch (err) {
        console.error(`[sheets-sync] failed for clinic ${clinic.id}:`, err)
      }
    }
  } finally {
    await sql.end()
  }
}
