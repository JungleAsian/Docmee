// Google Calendar OAuth connection routes (Gap #9).
// Tokens are stored encrypted inside clinics.settings.googleCalendar — the
// appointments schema has no dedicated token columns, and settings (jsonb) is
// the established place for per-clinic configuration.
import type { FastifyPluginAsync } from 'fastify'
import { getOAuth2Client } from '@docmee/agents'
import { encryptValue } from '@docmee/shared'
import { createServiceDbClient, createClinicsRepository, createDoctorsRepository } from '@docmee/db'

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

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function googleOAuthSetupPage(params: { redirectUri: string | null; clientId: string | null }) {
  const redirectUri = params.redirectUri || 'GOOGLE_REDIRECT_URI is not configured'
  const clientId = params.clientId || 'GOOGLE_CLIENT_ID is not configured'
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Google Calendar setup instructions</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f6f8fb; color: #14213d; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(860px, calc(100vw - 32px)); background: white; border: 1px solid #d8e0ec; border-radius: 18px; padding: 32px; box-shadow: 0 20px 50px rgba(20, 33, 61, 0.12); }
      h1 { margin: 0 0 12px; font-size: clamp(26px, 4vw, 38px); line-height: 1.15; }
      h2 { margin: 28px 0 12px; font-size: 18px; }
      p, li { color: #4f5f75; font-size: 16px; line-height: 1.6; }
      ol { margin: 12px 0 0; padding-left: 24px; }
      li { margin-bottom: 10px; }
      code { display: block; white-space: normal; overflow-wrap: anywhere; margin: 8px 0 16px; padding: 14px 16px; border-radius: 12px; background: #edf3f8; color: #10243e; font-size: 14px; }
      .label { margin-top: 18px; color: #64748b; font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
      .notice { border-left: 4px solid #165dff; background: #f0f6ff; border-radius: 12px; margin: 20px 0; padding: 14px 16px; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
      a { color: #165dff; font-weight: 700; }
      .button { border-radius: 10px; border: 1px solid #bfd0e8; padding: 10px 14px; text-decoration: none; }
      .primary { background: #165dff; border-color: #165dff; color: white; }
    </style>
  </head>
  <body>
    <main>
      <h1>Finish Google Calendar setup</h1>
      <p>Docmee reached Google successfully, but Google blocked the sign-in because this Docmee callback URL has not been approved inside the Google Cloud OAuth client.</p>
      <div class="notice">
        <p><strong>Who should do this:</strong> the person who manages the Google Cloud project for Docmee. This only needs to be done once for this OAuth client.</p>
      </div>
      <h2>Steps in Google Cloud</h2>
      <ol>
        <li>Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud Console - Credentials</a>.</li>
        <li>Select the Google Cloud project that owns the OAuth client below.</li>
        <li>Under <strong>OAuth 2.0 Client IDs</strong>, open the client whose ID matches the value below.</li>
        <li>Find <strong>Authorized redirect URIs</strong>.</li>
        <li>Click <strong>Add URI</strong>, paste the Docmee callback URL below, then click <strong>Save</strong>.</li>
        <li>Wait one or two minutes for Google to apply the change, then return to Docmee and connect Google Calendar again.</li>
      </ol>
      <div class="label">OAuth client ID to open</div>
      <code>${escapeHtml(clientId)}</code>
      <div class="label">Docmee callback URL to add</div>
      <code>${escapeHtml(redirectUri)}</code>
      <h2>How to confirm it worked</h2>
      <p>After saving the URI in Google Cloud, retry the Google Calendar connection in Docmee. If Google shows the consent screen instead of the redirect URI error, the setup is fixed.</p>
      <div class="actions">
        <a class="button primary" href="/studio/integrations?googleCalendar=error&amp;message=redirect_uri_mismatch">Return to Docmee integrations</a>
        <a class="button" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Open Google credentials</a>
      </div>
    </main>
  </body>
</html>`
}

async function googleRejectsRedirectUri(authUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(authUrl, { redirect: 'follow', signal: controller.signal })
    const html = await response.text()
    return response.url.includes('redirect_uri_mismatch') || html.includes('redirect_uri_mismatch')
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
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
    if (await googleRejectsRedirectUri(url)) {
      return reply
        .code(409)
        .header('content-type', 'text/html; charset=utf-8')
        .send(
          googleOAuthSetupPage({
            redirectUri: process.env['GOOGLE_REDIRECT_URI']?.trim() || null,
            clientId: process.env['GOOGLE_CLIENT_ID']?.trim() || null,
          }),
        )
    }
    return reply.redirect(url)
  })

  // 2. OAuth callback — exchange the code and persist encrypted tokens.
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/clinic/calendar/callback',
    async (request, reply) => {
      const { code, state: clinicId, error } = request.query
      if (error) {
        const target = clinicId ? `/studio/channels?calendar=error&clinic=${encodeURIComponent(clinicId)}&reason=${encodeURIComponent(error)}` : `/studio/channels?calendar=error&reason=${encodeURIComponent(error)}`
        return reply.redirect(target)
      }
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

      return reply.redirect(`/studio/channels?calendar=connected&clinic=${encodeURIComponent(clinicId)}`)
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

  app.get<{ Params: { clinicId: string } }>('/clinic/:clinicId/calendar/health', async (request, reply) => {
    const requiredEnv = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI']
    const missingEnv = requiredEnv.filter((name) => !hasEnv(name))
    const sql = dbClient()
    try {
      const clinics = createClinicsRepository(sql)
      const doctorsRepository = createDoctorsRepository(sql)
      const clinic = await clinics.findById(request.params.clinicId)
      if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
      const calendar = getCalendarSettings(clinic.settings)
      const doctors = await doctorsRepository.listByClinic(request.params.clinicId)
      const connectedDoctors = doctors.filter(
        (doctor) => doctor.googleCalendarAccessTokenEncrypted && doctor.googleCalendarRefreshTokenEncrypted,
      )
      const expiryDate = typeof calendar?.expiryDate === 'number' ? calendar.expiryDate : null
      const tokenExpired = expiryDate !== null ? expiryDate <= Date.now() : false
      const checks = [
        {
          key: 'oauth_env',
          label: 'Google OAuth app',
          state: missingEnv.length === 0 ? 'pass' : 'fail',
          detail:
            missingEnv.length === 0
              ? 'Google OAuth environment values are present.'
              : `Missing ${missingEnv.join(', ')}.`,
          action: 'Set the missing Google OAuth values in the live server environment.',
        },
        {
          key: 'clinic_connection',
          label: 'Clinic calendar connection',
          state: calendar ? 'pass' : 'fail',
          detail: calendar ? `Clinic calendar is connected to ${calendar.calendarId || 'primary'}.` : 'No clinic Google Calendar tokens are stored.',
          action: 'Open Studio > Channels or Integrations and connect Google Calendar.',
        },
        {
          key: 'token_expiry',
          label: 'Token expiry metadata',
          state: calendar && !tokenExpired ? 'pass' : calendar && tokenExpired ? 'warning' : 'fail',
          detail:
            expiryDate === null
              ? 'No token expiry timestamp is stored.'
              : tokenExpired
                ? `Stored access token expiry is in the past: ${new Date(expiryDate).toISOString()}.`
                : `Stored access token expires at ${new Date(expiryDate).toISOString()}.`,
          action: tokenExpired ? 'Reconnect Google Calendar to refresh the token state.' : 'Reconnect once if expiry metadata is missing.',
        },
        {
          key: 'doctor_calendar_coverage',
          label: 'Doctor calendar coverage',
          state: doctors.length > 0 && connectedDoctors.length === doctors.length ? 'pass' : connectedDoctors.length > 0 ? 'warning' : 'fail',
          detail:
            doctors.length === 0
              ? 'No active doctors exist for this clinic.'
              : `${connectedDoctors.length} of ${doctors.length} active doctors have calendar credentials.`,
          action: 'Open Studio > Doctors and connect calendars for every active booking provider.',
        },
        {
          key: 'booking_scope',
          label: 'Booking API scope',
          state: 'pass',
          detail: 'OAuth requests calendar.events and spreadsheets scopes.',
          action: 'Keep the consent screen approved for the requested scopes.',
        },
      ] satisfies Array<{
        key: string
        label: string
        state: 'pass' | 'warning' | 'fail'
        detail: string
        action: string
      }>
      const failed = checks.filter((check) => check.state === 'fail')
      return {
        checkedAt: new Date().toISOString(),
        overall: failed.length === 0 ? 'ready' : calendar ? 'partial' : 'blocked',
        connected: Boolean(calendar),
        calendarId: calendar?.calendarId ?? null,
        expiryDate,
        doctorCoverage: {
          activeDoctors: doctors.length,
          connectedDoctors: connectedDoctors.length,
        },
        checks,
        requiredActions: checks.filter((check) => check.state !== 'pass').map((check) => check.action),
      }
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
