// Per-clinic AI provider credentials (Claude / OpenAI "Codex").
// "Login to the service": a clinic admin connects that clinic's own provider API key,
// we validate it live against the provider, then store it ENCRYPTED inside
// clinics.settings.integrations.<provider> (jsonb — the established place for
// per-clinic secrets, same as calendar/googleCalendar). The key is write-only:
// it is never echoed back to the panel, and clinics.ts redacts it on read.
// Docmee requires a clinic-owned key. There is no shared server fallback for clinic AI.
//
// OAuth note: Anthropic, OpenAI, and Gemini do not offer a third-party OAuth flow
// that grants API access to Docmee here. The login path opens the provider's API
// console so an admin can sign in, create/copy a key, then paste it into Docmee.
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { normalizeNotificationPrefs } from '@docmee/notifications'
import { encryptValue } from '@docmee/shared'
import { createServiceDbClient, createClinicsRepository, createUsersRepository } from '@docmee/db'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

type AiProvider = 'claude' | 'openai' | 'gemini' | 'custom'
const PROVIDERS: AiProvider[] = ['claude', 'openai', 'gemini', 'custom']
const JZEL_CONFIGURATION_LOCKED = {
  error: 'jzel_configuration_locked',
  message: 'Docmee is hidden for this user. Docmee and AI service configuration is locked.',
}

interface StoredAiCredential {
  apiKeyEnc: string
  last4: string
  validatedAt: string
}

const connectSchema = z.object({
  apiKey: z.string().min(8),
  baseURL: z.string().url().optional(),
})
const providerSchema = z.enum(['claude', 'openai', 'gemini', 'custom'])

const PROVIDER_CONSOLES: Record<Exclude<AiProvider, 'custom'>, string> = {
  claude: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
}

function dbClient() {
  return createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
}

function getIntegrations(settings: Record<string, unknown>): Record<string, unknown> {
  const existing = settings['integrations']
  return existing && typeof existing === 'object' ? { ...(existing as Record<string, unknown>) } : {}
}

function getStored(settings: Record<string, unknown>, provider: AiProvider): StoredAiCredential | null {
  const entry = getIntegrations(settings)[provider]
  if (entry && typeof entry === 'object' && 'apiKeyEnc' in entry) return entry as StoredAiCredential
  return null
}

async function isDocmeeConfigurationLocked(
  sql: Parameters<typeof createUsersRepository>[0],
  clinicId: string,
  userId: string,
): Promise<boolean> {
  const prefs = await createUsersRepository(sql).getNotificationPrefs(clinicId, userId)
  return normalizeNotificationPrefs(prefs ?? {}).jzelEnabled === false
}

/**
 * Validate an API key by hitting the provider's models endpoint — a cheap,
 * read-only call that bills no tokens. 200 = valid; 401/403 = bad key. We avoid
 * importing the provider SDKs here so this route adds no new package dependency
 * (the SDKs are confined to packages/llm).
 */
async function validateKey(provider: AiProvider, apiKey: string, baseURL?: string): Promise<boolean> {
  try {
    let res: Response
    if (provider === 'custom') {
      if (!baseURL) return false
      const root = baseURL.replace(/\/+$/, '')
      res = await fetch(`${root}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    } else if (provider === 'claude') {
      res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
    } else if (provider === 'gemini') {
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
      )
    } else {
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${apiKey}` },
      })
    }
    return res.ok
  } catch {
    return false
  }
}

const aiCredentialsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  // ── Status — per-provider connection state for this clinic only.
  // Never decrypts or returns the key; only presence + a masked last4.
  app.get<{ Params: { clinicId: string } }>(
    '/clinic/:clinicId/ai/status',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.clinicId)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const sql = dbClient()
      try {
        const clinic = await createClinicsRepository(sql).findById(clinicId)
        if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
        const settings = (clinic.settings as Record<string, unknown> | null) ?? {}
        const providers = PROVIDERS.map((provider) => {
          const stored = getStored(settings, provider)
          if (stored) {
            return { provider, connected: true, source: 'clinic' as const, last4: stored.last4, validatedAt: stored.validatedAt }
          }
          return { provider, connected: false, source: 'none' as const, last4: null, validatedAt: null }
        })
        return { providers }
      } finally {
        await sql.end()
      }
    },
  )

  // ── Connect — validate the key live, then persist it encrypted.
  app.post<{ Params: { clinicId: string; provider: string } }>(
    '/clinic/:clinicId/ai/:provider/connect',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.clinicId)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const providerParsed = providerSchema.safeParse(request.params.provider)
      if (!providerParsed.success) return reply.code(404).send({ error: 'Unknown provider' })
      const provider = providerParsed.data
      const parsed = validate(connectSchema, request.body, reply)
      if (!parsed.ok) return
      const apiKey = parsed.data.apiKey.trim()
      const baseURL = parsed.data.baseURL?.trim()

      const valid = await validateKey(provider, apiKey, baseURL)
      if (!valid) {
        return reply
          .code(400)
          .send({ error: provider === 'custom' ? 'The custom endpoint rejected this key or URL. Check the endpoint URL, model, and key.' : 'The provider rejected this API key. Double-check the key and try again.' })
      }

      const validatedAt = new Date().toISOString()
      const last4 = apiKey.slice(-4)
      const sql = dbClient()
      try {
        if (
          request.user?.userId &&
          (await isDocmeeConfigurationLocked(sql, clinicId, request.user.userId))
        ) {
          return reply.code(403).send(JZEL_CONFIGURATION_LOCKED)
        }
        const clinics = createClinicsRepository(sql)
        const clinic = await clinics.findById(clinicId)
        if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
        const settings = (clinic.settings as Record<string, unknown> | null) ?? {}
        const integrations = getIntegrations(settings)
        integrations[provider] = { apiKeyEnc: encryptValue(apiKey), last4, validatedAt }
        await clinics.update(clinicId, { settings: { ...settings, integrations } })
        return { connected: true, provider, last4, validatedAt }
      } finally {
        await sql.end()
      }
    },
  )

  // ── Disconnect — drop this clinic's stored key. Docmee stays disconnected until
  // a new clinic-owned provider key is connected.
  app.delete<{ Params: { clinicId: string; provider: string } }>(
    '/clinic/:clinicId/ai/:provider/disconnect',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.clinicId)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const providerParsed = providerSchema.safeParse(request.params.provider)
      if (!providerParsed.success) return reply.code(404).send({ error: 'Unknown provider' })
      const provider = providerParsed.data
      const sql = dbClient()
      try {
        if (
          request.user?.userId &&
          (await isDocmeeConfigurationLocked(sql, clinicId, request.user.userId))
        ) {
          return reply.code(403).send(JZEL_CONFIGURATION_LOCKED)
        }
        const clinics = createClinicsRepository(sql)
        const clinic = await clinics.findById(clinicId)
        if (!clinic) return reply.code(404).send({ error: 'Clinic not found' })
        const settings = (clinic.settings as Record<string, unknown> | null) ?? {}
        const integrations = getIntegrations(settings)
        delete integrations[provider]
        await clinics.update(clinicId, { settings: { ...settings, integrations } })
        return reply.code(200).send({ disconnected: true, provider })
      } finally {
        await sql.end()
      }
    },
  )

  // ── Login helper — opens the provider's own API console. Admins still paste
  // the generated key into Docmee, because providers do not grant Docmee API
  // credentials through consumer OAuth.
  app.get<{ Params: { clinicId: string; provider: string } }>(
    '/clinic/:clinicId/ai/:provider/auth',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.clinicId)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const providerParsed = providerSchema.safeParse(request.params.provider)
      if (!providerParsed.success) return reply.code(404).send({ error: 'Unknown provider' })
      const provider = providerParsed.data
      const sql = dbClient()
      try {
        if (
          request.user?.userId &&
          (await isDocmeeConfigurationLocked(sql, clinicId, request.user.userId))
        ) {
          return reply.code(403).send(JZEL_CONFIGURATION_LOCKED)
        }
      } finally {
        await sql.end()
      }
      if (provider === 'custom') {
        return reply.code(400).send({ error: 'Custom providers do not have a shared login page. Open your provider dashboard, create an API key, then paste it here.' })
      }
      return reply.redirect(PROVIDER_CONSOLES[provider])
    },
  )
  app.get<{ Params: { provider: string } }>(
    '/clinic/ai/:provider/callback',
    async (_request, reply) =>
      reply.code(200).send({ ok: true, message: 'Return to Docmee and paste the API key from your provider console.' }),
  )
}

export default aiCredentialsRoute
