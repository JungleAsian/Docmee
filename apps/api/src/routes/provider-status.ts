import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { hasDatabaseUrl, withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

type ProviderState = 'ready' | 'missing' | 'fallback' | 'waived'
type ProviderSeverity = 'required' | 'recommended'

interface LaunchWaiver {
  reviewer: string
  reason: string
  risk: string
  owner: string
  followUpDate: string
  createdAt: string
}

interface ProviderCheck {
  key: 'meta' | 'google' | 'email' | 'openai' | 'anthropic'
  label: string
  state: ProviderState
  configured: boolean
  required: boolean
  severity: ProviderSeverity
  missing: string[]
  action: string
  waiver?: LaunchWaiver
}

function hasEnv(name: string): boolean {
  return Boolean(process.env[name]?.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeWaivers(value: unknown): Record<string, LaunchWaiver> {
  if (!isRecord(value)) return {}
  const waivers: Record<string, LaunchWaiver> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!isRecord(item)) continue
    const waiver = {
      reviewer: item['reviewer'],
      reason: item['reason'],
      risk: item['risk'],
      owner: item['owner'],
      followUpDate: item['followUpDate'],
      createdAt: item['createdAt'],
    }
    if (Object.values(waiver).every((field) => typeof field === 'string')) {
      waivers[key] = waiver as LaunchWaiver
    }
  }
  return waivers
}

function providerWaiver(key: ProviderCheck['key'], waivers: Record<string, LaunchWaiver>): LaunchWaiver | undefined {
  if (waivers[key]) return waivers[key]
  if (key === 'meta') return waivers['whatsapp']
  if (key === 'email' || key === 'openai' || key === 'anthropic') return waivers['provider-env']
  return undefined
}

async function readWaivers(clinicId: string | null): Promise<Record<string, LaunchWaiver>> {
  if (!clinicId || !hasDatabaseUrl()) return {}
  try {
    return await withDb(async (sql) => {
      const rows = await sql<Array<{ waivers: unknown }>>`
        SELECT waivers
        FROM clinic_launch_readiness
        WHERE clinic_id = ${clinicId}
        LIMIT 1
      `
      return normalizeWaivers(rows[0]?.waivers)
    })
  } catch (error) {
    console.warn('provider_status_waiver_read_failed', error)
    return {}
  }
}

function check({
  key,
  label,
  names,
  action,
  waivers,
  required = true,
  fallback = false,
}: {
  key: ProviderCheck['key']
  label: string
  names: string[]
  action: string
  waivers: Record<string, LaunchWaiver>
  required?: boolean
  fallback?: boolean
}): ProviderCheck {
  const missing = names.filter((name) => !hasEnv(name))
  const waiver = missing.length > 0 ? providerWaiver(key, waivers) : undefined
  return {
    key,
    label,
    state: fallback ? 'fallback' : missing.length === 0 ? 'ready' : waiver ? 'waived' : 'missing',
    configured: missing.length === 0,
    required,
    severity: required ? 'required' : 'recommended',
    missing,
    action: waiver ? `Waived until ${waiver.followUpDate}: ${waiver.reason}` : action,
    ...(waiver ? { waiver } : {}),
  }
}

const providerStatusRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get(
    '/provider-status',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request: FastifyRequest) => {
      const clinicId = resolveClinicScope(request)
      const waivers = await readWaivers(clinicId)
      const llmStub = /^(1|true|yes|on)$/i.test((process.env['LLM_STUB'] ?? '').trim())
      const providers = [
        check({
          key: 'meta',
          label: 'Meta webhook security',
          names: ['META_APP_SECRET'],
          action: 'Add META_APP_SECRET from the production Meta app so webhook signatures can be validated.',
          waivers,
        }),
        check({
          key: 'google',
          label: 'Google Calendar OAuth',
          names: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'],
          action: 'Add the Google OAuth client ID, secret, and redirect URI used by the live calendar integration.',
          waivers,
        }),
        check({
          key: 'email',
          label: 'Transactional email',
          names: ['RESEND_API_KEY'],
          action: 'Add RESEND_API_KEY and send a production smoke-test email before launch.',
          waivers,
        }),
        check({
          key: 'openai',
          label: 'OpenAI fallback LLM',
          names: ['OPENAI_API_KEY'],
          action: 'Add OPENAI_API_KEY or keep a documented waiver if Anthropic is the only approved production LLM.',
          required: false,
          fallback: llmStub,
          waivers,
        }),
        check({
          key: 'anthropic',
          label: 'Anthropic primary LLM',
          names: ['ANTHROPIC_API_KEY'],
          action: 'Add ANTHROPIC_API_KEY or keep a documented waiver if OpenAI is the only approved production LLM.',
          required: false,
          fallback: llmStub,
          waivers,
        }),
      ]
      const unwaivedRequiredMissing = providers.filter(
        (provider) => provider.required && provider.state === 'missing',
      )
      const requiredMissing = providers.filter(
        (provider) => provider.required && (provider.state === 'missing' || provider.state === 'waived'),
      )
      const llmReady = providers.some(
        (provider) => (provider.key === 'openai' || provider.key === 'anthropic') && provider.configured,
      )
      const llmWaived = providers.some(
        (provider) => (provider.key === 'openai' || provider.key === 'anthropic') && provider.state === 'waived',
      )
      const missingVars = providers
        .filter((provider) => provider.state !== 'waived')
        .flatMap((provider) => provider.missing)
      return {
        checkedAt: new Date().toISOString(),
        clinicId,
        overall:
          unwaivedRequiredMissing.length === 0 && (llmReady || llmWaived)
            ? 'ready'
            : unwaivedRequiredMissing.length === 0
              ? 'needs_llm'
              : 'missing_required',
        summary: {
          requiredMissing: requiredMissing.map((provider) => provider.key),
          unwaivedRequiredMissing: unwaivedRequiredMissing.map((provider) => provider.key),
          waivedProviders: providers.filter((provider) => provider.state === 'waived').map((provider) => provider.key),
          llmReady,
          llmWaived,
          missingVars,
        },
        providers,
      }
    },
  )
}

export default providerStatusRoute
