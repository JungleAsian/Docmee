// P18 (Gap #35): Google Sheets export.
//
// Exports a clinic's conversations to a Google Sheet (one sheet per clinic). Uses
// the SAME Google OAuth app as Calendar (see calbot/google-calendar-client). The
// worker binds a clinic's encrypted tokens; pure row-building is exported for tests.
//
// googleapis is heavy, so it's imported lazily — only the sync path pays the cost.
import type { Auth } from 'googleapis'
import type { RefreshedTokens } from '../calbot/google-calendar-client.js'

type GoogleApi = (typeof import('googleapis'))['google']
let googlePromise: Promise<GoogleApi> | null = null
function loadGoogle(): Promise<GoogleApi> {
  if (!googlePromise) googlePromise = import('googleapis').then((m) => m.google)
  return googlePromise
}

export interface GoogleSheetsConfig {
  accessToken: string
  refreshToken: string
  /** The target spreadsheet id (clinic.settings.googleSheets.spreadsheetId). */
  spreadsheetId: string
  /** Tab/sheet name within the spreadsheet (default "Conversations"). */
  sheetName?: string
  /** Unix epoch ms the access token expires; enables proactive refresh. */
  expiryDate?: number
  /** Persist refreshed tokens (access/expiry, and refresh if rotated). */
  onTokensRefreshed?: (tokens: RefreshedTokens) => void | Promise<void>
}

/** One exported conversation, in column order. */
export interface ConversationExportRow {
  date: string
  patientName: string
  intent: string
  resolved: boolean
  appointmentBooked: boolean
}

const HEADER = ['Date', 'Patient name', 'Intent', 'Resolved', 'Appointment booked']

/** Turn export rows into the raw value matrix written to the sheet (header + data). */
export function buildValueMatrix(rows: ConversationExportRow[]): string[][] {
  return [
    HEADER,
    ...rows.map((r) => [
      r.date,
      r.patientName,
      r.intent,
      r.resolved ? 'yes' : 'no',
      r.appointmentBooked ? 'yes' : 'no',
    ]),
  ]
}

interface AuthOptions {
  accessToken: string
  refreshToken: string
  expiryDate?: number
  onTokensRefreshed?: (tokens: RefreshedTokens) => void | Promise<void>
}

// Build a Sheets client whose OAuth2 credentials carry an expiry so googleapis
// refreshes the access token before it 401s (the same pattern the Calendar client
// uses — Req 9). When the expiry is unknown we set it in the past to force a
// refresh on first use. The `tokens` event forwards any refreshed token to the
// caller so it can be persisted instead of refreshing on every export.
async function authedSheets(opts: AuthOptions) {
  const google = await loadGoogle()
  const auth: Auth.OAuth2Client = new google.auth.OAuth2(
    process.env['GOOGLE_CLIENT_ID'],
    process.env['GOOGLE_CLIENT_SECRET'],
    process.env['GOOGLE_REDIRECT_URI'],
  )
  auth.setCredentials({
    access_token: opts.accessToken,
    refresh_token: opts.refreshToken,
    expiry_date: opts.expiryDate ?? 1,
  })
  const onRefresh = opts.onTokensRefreshed
  if (onRefresh) {
    auth.on('tokens', (tokens) => {
      if (!tokens.access_token) return
      Promise.resolve(
        onRefresh({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? undefined,
          expiryDate: tokens.expiry_date ?? undefined,
        }),
      ).catch((e) => console.error('[sheets] failed to persist refreshed tokens', e))
    })
  }
  return google.sheets({ version: 'v4', auth })
}

export interface SheetsOps {
  /** Overwrite the sheet with the current conversation export (header + rows). */
  syncConversations(rows: ConversationExportRow[]): Promise<void>
}

/** Bind {@link SheetsOps} to a clinic's Google credentials + spreadsheet. */
export function createGoogleSheetsOps(config: GoogleSheetsConfig): SheetsOps {
  const sheetName = config.sheetName ?? 'Conversations'
  return {
    async syncConversations(rows) {
      const sheets = await authedSheets(config)
      const values = buildValueMatrix(rows)
      // Clear stale rows first so deletions are reflected, then write the full export.
      await sheets.spreadsheets.values.clear({
        spreadsheetId: config.spreadsheetId,
        range: sheetName,
      })
      await sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values },
      })
    },
  }
}

// ── CRM export (Req 31) ───────────────────────────────────────────────────────
//
// A row-per-record CRM export: every booked appointment and every new contact is
// APPENDED as a row to a clinic's Google Sheet (a "CRM" tab, separate from the
// hourly conversation sync's "Conversations" tab so the two never collide). Each
// row carries the patient, the originating source channel, the record status, a
// "scheduled" flag and the clinic scoping the requirement calls for. Auth reuses
// the clinic's unified Google OAuth tokens (the connect flow requests both the
// calendar.events and spreadsheets scopes).

/** Whether a CRM row describes a booked appointment or a captured contact/lead. */
export type CrmRecordType = 'appointment' | 'contact'

/** One CRM record, in column order (see {@link CRM_HEADER}). */
export interface CrmExportRow {
  recordType: CrmRecordType
  /** ISO timestamp the row was written. */
  timestamp: string
  clinicId: string
  clinicName: string
  patientName: string
  phone: string
  /** Originating channel: whatsapp / messenger / instagram. */
  source: string
  doctorName: string
  specialty: string
  reason: string
  /** Booked date (YYYY-MM-DD); empty for a contact row. */
  appointmentDate: string
  /** Booked time (HH:MM); empty for a contact row. */
  appointmentTime: string
  /** Record status: 'confirmed' for an appointment, 'new' for a contact. */
  status: string
  /** Whether an appointment has been scheduled for this record. */
  scheduled: boolean
}

export const CRM_HEADER = [
  'Timestamp',
  'Record type',
  'Clinic ID',
  'Clinic name',
  'Patient name',
  'Phone',
  'Source',
  'Doctor',
  'Specialty',
  'Reason',
  'Appointment date',
  'Appointment time',
  'Status',
  'Scheduled',
]

/** Render a CRM record as the raw cell values written to the sheet (pure; tested). */
export function buildCrmRowValues(row: CrmExportRow): string[] {
  return [
    row.timestamp,
    row.recordType,
    row.clinicId,
    row.clinicName,
    row.patientName,
    row.phone,
    row.source,
    row.doctorName,
    row.specialty,
    row.reason,
    row.appointmentDate,
    row.appointmentTime,
    row.status,
    row.scheduled ? 'yes' : 'no',
  ]
}

export interface GoogleCrmConfig {
  accessToken: string
  refreshToken: string
  /** The target spreadsheet id (clinic.settings.googleSheets.spreadsheetId). */
  spreadsheetId: string
  /** Tab/sheet name within the spreadsheet (default "CRM"). */
  sheetName?: string
  /** Unix epoch ms the access token expires; enables proactive refresh. */
  expiryDate?: number
  /** Persist refreshed tokens (access/expiry, and refresh if rotated). */
  onTokensRefreshed?: (tokens: RefreshedTokens) => void | Promise<void>
}

export interface CrmExporter {
  /** Append a single CRM record to the clinic's sheet, writing the header first. */
  appendRow(row: CrmExportRow): Promise<void>
}

type SheetsClient = Awaited<ReturnType<typeof authedSheets>>

// Write the header row once if the target tab is empty, so a fresh sheet is
// self-describing. Best-effort: if reading the first row fails we skip it rather
// than block the append (the append still lands; only the header is missing).
async function ensureCrmHeader(
  sheets: SheetsClient,
  spreadsheetId: string,
  sheetName: string,
): Promise<void> {
  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!1:1`,
  })
  const values = existing.data.values
  if (Array.isArray(values) && values.length > 0) return
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [CRM_HEADER] },
  })
}

/**
 * Bind a {@link CrmExporter} to a clinic's Google credentials + spreadsheet. The
 * Sheets client (refresh-aware) is built once and reused across appends. Offline
 * and in tests (LLM_STUB defaulting on) appendRow is a no-op so nothing touches
 * the network — the real append only runs with LLM_STUB=false.
 */
export function createGoogleCrmExporter(config: GoogleCrmConfig): CrmExporter {
  const sheetName = config.sheetName ?? 'CRM'
  let clientPromise: Promise<SheetsClient> | null = null
  const client = () => (clientPromise ??= authedSheets(config))
  let headerEnsured = false

  return {
    async appendRow(row) {
      // Offline / tests: never touch the network. The pure buildCrmRowValues is
      // what unit tests exercise; real appends only happen with LLM_STUB=false.
      if (process.env['LLM_STUB'] !== 'false') return
      const sheets = await client()
      if (!headerEnsured) {
        await ensureCrmHeader(sheets, config.spreadsheetId, sheetName)
        headerEnsured = true
      }
      await sheets.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range: sheetName,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [buildCrmRowValues(row)] },
      })
    },
  }
}
