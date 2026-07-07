// Google Calendar OAuth connection routes (Gap #9).
// Tokens are stored encrypted inside clinics.settings.googleCalendar — the
// appointments schema has no dedicated token columns, and settings (jsonb) is
// the established place for per-clinic configuration.
import type { FastifyPluginAsync } from 'fastify'
import { getOAuth2Client } from '@docmee/agents'
import { encryptValue } from '@docmee/shared'
import { createServiceDbClient, createClinicsRepository } from '@docmee/db'

interface GoogleCalendarSettings {
  accessToken: string
  refreshToken: string
  calendarId: string
  /** Unix epoch ms the access token expires; lets the worker refresh proactively. */
  expiryDate?: number
}

function getCalendarSettings(settings: Record<string, unknown>): GoogleCalendarSettings | null {
  const gc = settings['googleCalendar']
  if (gc && typeof gc === 'object' && 'accessToken' in gc && 'refreshToken' in gc) {
    return gc as GoogleCalendarSettings
  }
  return null
}

function dbClient() {
  return createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
}

const calendarRoute: FastifyPluginAsync = async (app) => {
  // 1. Begin OAuth — redirect the clinic admin to Google's consent screen.
  app.get<{ Params: { clinicId: string } }>('/clinic/:clinicId/calendar/auth', async (request, reply) => {
    const oauth2Client = await getOAuth2Client(request.params.clinicId)
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      // One unified Google connection per clinic: calendar.events powers booking
      // (Req 9), spreadsheets powers the CRM / Google Sheets export (Req 31) which
      // reuses these same tokens.
      scope: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/spreadsheets',
      ],
      state: request.params.clinicId,
      prompt: 'consent',
    })
    return reply.redirect(url)
  })

  // 2. OAuth callback — exchange the code and persist encrypted tokens.
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/clinic/calendar/callback',
    async (request, reply) => {
      const { code, state: clinicId } = request.query
      if (!code || !clinicId) {
        return reply.code(400).send({ error: 'Missing code or state' })
      }
      const oauth2Client = await getOAuth2Client(clinicId)
      const { tokens } = await oauth2Client.getToken(code)
      if (!tokens.access_token || !tokens.refresh_token) {
        return reply.code(400).send({ error: 'Google did not return both tokens; re-consent required' })
      }

      const sql = dbClient()
      try {
        const clinics = createClinicsRepository(sql)
        const clinic = await clinics.findById(clinicId)
        if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })

        const existing = getCalendarSettings(clinic.settings)
        await clinics.update(clinicId, {
          settings: {
            ...clinic.settings,
            googleCalendar: {
              accessToken: encryptValue(tokens.access_token),
              refreshToken: encryptValue(tokens.refresh_token),
              calendarId: existing?.calendarId ?? 'primary',
              // Stored unencrypted (not a secret); lets the scheduling worker know
              // when to refresh instead of waiting for a 401.
              ...(typeof tokens.expiry_date === 'number' ? { expiryDate: tokens.expiry_date } : {}),
            },
          },
        })
      } finally {
        await sql.end()
      }

      return reply.redirect(`/admin/clinics/${clinicId}?calendar=connected`)
    },
  )

  // 3. Connection status (no decryption — only presence is reported).
  app.get<{ Params: { clinicId: string } }>('/clinic/:clinicId/calendar/status', async (request, reply) => {
    const sql = dbClient()
    try {
      const clinics = createClinicsRepository(sql)
      const clinic = await clinics.findById(request.params.clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      return { connected: getCalendarSettings(clinic.settings) !== null }
    } finally {
      await sql.end()
    }
  })

  // 4. Disconnect — drop the stored tokens.
  app.delete<{ Params: { clinicId: string } }>('/clinic/:clinicId/calendar/disconnect', async (request, reply) => {
    const sql = dbClient()
    try {
      const clinics = createClinicsRepository(sql)
      const clinic = await clinics.findById(request.params.clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })

      const nextSettings = { ...clinic.settings }
      delete nextSettings['googleCalendar']
      await clinics.update(request.params.clinicId, { settings: nextSettings })
      return reply.code(200).send({ disconnected: true })
    } finally {
      await sql.end()
    }
  })
}

export default calendarRoute
