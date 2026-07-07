import type { FastifyPluginAsync } from 'fastify'
import { getOAuth2Client } from '@docmee/agents'
import { createChannelAccountsRepository } from '@docmee/db'
import { hasDatabaseUrl, withDb } from '../lib/db.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

type RecoveryState = 'pass' | 'warning' | 'blocked' | 'action_required' | 'waived'

interface LaunchWaiver {
  reviewer: string
  reason: string
  risk: string
  owner: string
  followUpDate: string
  createdAt: string
}

interface RecoveryAction {
  key: string
  label: string
  owner: 'app' | 'google_console' | 'meta_console' | 'aws' | 'operator'
  state: RecoveryState
  detail: string
  command?: string
  url?: string
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

async function readLaunchWaivers(clinicId: string): Promise<Record<string, LaunchWaiver>> {
  if (!hasDatabaseUrl()) return {}
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
    console.warn('provider_recovery_waiver_read_failed', error)
    return {}
  }
}

async function listWhatsappAccounts(clinicId: string) {
  if (!hasDatabaseUrl()) return []
  try {
    return await withDb(async (sql) => createChannelAccountsRepository(sql).listByClinic(clinicId))
  } catch (error) {
    console.warn('provider_recovery_channels_read_failed', error)
    return []
  }
}

async function probeGoogleOAuth(clinicId: string) {
  const missingEnv = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'].filter((name) => !hasEnv(name))
  const redirectUri = process.env['GOOGLE_REDIRECT_URI']?.trim() || null
  if (missingEnv.length > 0) {
    return {
      state: 'blocked' as RecoveryState,
      redirectUri,
      authUrl: null,
      googleAcceptedRedirect: false,
      error: 'missing_env',
      detail: `Missing ${missingEnv.join(', ')}.`,
      missingEnv,
    }
  }

  try {
    const oauth2Client = await getOAuth2Client(clinicId)
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/spreadsheets'],
      state: clinicId,
      prompt: 'consent',
    })
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    try {
      const response = await fetch(authUrl, { redirect: 'follow', signal: controller.signal })
      const html = await response.text()
      const mismatch = html.includes('redirect_uri_mismatch') || response.url.includes('redirect_uri_mismatch')
      return {
        state: mismatch ? 'blocked' as RecoveryState : 'pass' as RecoveryState,
        redirectUri,
        authUrl,
        googleAcceptedRedirect: !mismatch,
        error: mismatch ? 'redirect_uri_mismatch' : null,
        detail: mismatch
          ? 'Google rejected the live redirect URI. Add the exact redirect URI to the OAuth client in Google Cloud Console.'
          : 'Google accepted the OAuth request URL; complete consent from Studio to store clinic tokens.',
        missingEnv: [],
      }
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    return {
      state: 'warning' as RecoveryState,
      redirectUri,
      authUrl: null,
      googleAcceptedRedirect: false,
      error: error instanceof Error ? error.message : 'google_probe_failed',
      detail: 'The app could not complete the Google OAuth preflight probe. Use the generated redirect URI and retry from Studio.',
      missingEnv,
    }
  }
}

const providerRecoveryRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get<{ Params: { clinicId: string } }>(
    '/clinics/:clinicId/provider-recovery',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.clinicId)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const [google, accounts, waivers] = await Promise.all([
        probeGoogleOAuth(clinicId),
        listWhatsappAccounts(clinicId),
        readLaunchWaivers(clinicId),
      ])
      const whatsappAccounts = accounts.filter((account) => account.channel === 'whatsapp')
      const activeWhatsappAccounts = whatsappAccounts.filter((account) => account.status === 'active')
      const metaAccounts = activeWhatsappAccounts.filter((account) => {
        const settings = isRecord(account.settings) ? account.settings : {}
        return settings['provider'] === 'meta_whatsapp'
      })
      const webhookUrl = `${process.env['PUBLIC_API_URL']?.replace(/\/$/, '') || 'https://docmeedevelopment.dev/api'}/webhook/whatsapp`
      const missingMetaConfig = ['META_APP_ID', 'META_EMBEDDED_SIGNUP_CONFIG_ID', 'META_APP_SECRET'].filter((name) => !hasEnv(name))
      const missingRequiredSecrets = [
        ...missingMetaConfig,
        ...(['RESEND_API_KEY'] as const).filter((name) => !hasEnv(name)),
      ]
      const llmConfigured = hasEnv('OPENAI_API_KEY') || hasEnv('ANTHROPIC_API_KEY')
      const providerEnvWaiver = waivers['provider-env']
      const whatsappWaiver = waivers['whatsapp']
      const whatsappState: RecoveryState =
        missingMetaConfig.length === 0 && metaAccounts.length > 0
          ? 'pass'
          : whatsappWaiver
            ? 'waived'
            : activeWhatsappAccounts.length > 0
              ? 'warning'
              : 'blocked'
      const secretsState: RecoveryState =
        missingRequiredSecrets.length === 0 && llmConfigured
          ? 'pass'
          : providerEnvWaiver
            ? 'waived'
            : 'blocked'
      const waiverState: RecoveryState = Object.keys(waivers).length > 0 ? 'warning' : 'pass'
      const actions: RecoveryAction[] = [
        {
          key: 'google-redirect',
          label: google.error === 'redirect_uri_mismatch' ? 'Add Google OAuth redirect URI' : 'Verify Google OAuth connection',
          owner: google.state === 'pass' ? 'operator' : 'google_console',
          state: google.state,
          detail: google.state === 'pass'
            ? 'Open Studio and finish the consent flow for the selected clinic.'
            : `Google Cloud Console must allow ${google.redirectUri ?? 'the configured GOOGLE_REDIRECT_URI'}.`,
          url: google.authUrl ?? undefined,
        },
        {
          key: 'whatsapp-provider',
          label: 'Complete WhatsApp production provider',
          owner: missingMetaConfig.length > 0 ? 'meta_console' : 'operator',
          state: whatsappState,
          detail: missingMetaConfig.length > 0
            ? `Missing Meta production settings: ${missingMetaConfig.join(', ')}.`
            : metaAccounts.length > 0
              ? `${metaAccounts.length} active Meta WhatsApp account(s) are linked.`
              : 'No active Meta WhatsApp account is linked for this clinic.',
          url: webhookUrl,
        },
        {
          key: 'provider-secrets',
          label: 'Resolve production provider secrets',
          owner: 'aws',
          state: secretsState,
          detail: missingRequiredSecrets.length === 0 && llmConfigured
            ? 'Required production provider secrets are present.'
            : `Missing or unconfirmed provider values: ${[...missingRequiredSecrets, ...(llmConfigured ? [] : ['OPENAI_API_KEY or ANTHROPIC_API_KEY'])].join(', ')}.`,
          command: 'sudo systemctl edit docmee.service && sudo systemctl restart docmee.service',
        },
        {
          key: 'waiver-review',
          label: 'Review launch waivers',
          owner: 'operator',
          state: waiverState,
          detail: Object.keys(waivers).length > 0
            ? `Active waivers: ${Object.keys(waivers).join(', ')}. Confirm owner and follow-up date before launch.`
            : 'No waivers are recorded; unresolved required checks should block launch.',
        },
      ]

      return {
        checkedAt: new Date().toISOString(),
        clinicId,
        overall: actions.some((action) => action.state === 'blocked') ? 'blocked' : actions.some((action) => action.state === 'warning' || action.state === 'waived') ? 'action_required' : 'ready',
        google,
        whatsapp: {
          state: whatsappState,
          webhookUrl,
          activeAccounts: activeWhatsappAccounts.length,
          activeMetaAccounts: metaAccounts.length,
          missingMetaConfig,
          waived: Boolean(whatsappWaiver),
        },
        providerSecrets: {
          state: secretsState,
          missingRequiredSecrets,
          llmConfigured,
          waived: Boolean(providerEnvWaiver),
        },
        waivers,
        actions,
      }
    },
  )
}

export default providerRecoveryRoute
