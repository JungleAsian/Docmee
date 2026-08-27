import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, parse } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { createChannelAccountsRepository } from '@docmee/db'
import { decryptValue, encryptValue } from '@docmee/shared'
import { withDb } from '../lib/db.js'
import { validate } from '../lib/validate.js'
import { resolveClinicScope } from '../lib/scope.js'
import { requireAuth, requireRole } from '../middleware/auth.js'

const whatsappSchema = z.object({
  provider: z.literal('meta_whatsapp').optional(),
  // Meta Graph phone-number IDs are numeric identifiers, never phone numbers or
  // email addresses. Reject invalid values before they can be persisted.
  accountId: z.string().regex(/^\d{8,25}$/, 'Meta phone-number ID must contain 8 to 25 digits'),
  displayName: z.string().trim().max(120).optional(),
  wabaId: z.string().regex(/^\d{8,25}$/, 'Meta WABA ID must contain 8 to 25 digits').optional(),
  accessToken: z.string().trim().min(1).max(8192).optional(),
  webhookVerifyToken: z.string().trim().max(256).optional(),
  setupMode: z.enum(['new-number', 'migrate-business-app', 'existing-cloud-api']).optional(),
  status: z.enum(['active', 'inactive', 'error']).optional(),
  tokenExpiresAt: z.string().nullable().optional(),
})

const embeddedSignupSchema = z.object({
  code: z.string().min(1),
  phoneNumberId: z.string().regex(/^\d{8,25}$/, 'Meta phone-number ID must contain 8 to 25 digits'),
  wabaId: z.string().regex(/^\d{8,25}$/, 'Meta WABA ID must contain 8 to 25 digits'),
  setupMode: z.enum(['new-number', 'migrate-business-app', 'existing-cloud-api']).optional(),
  displayName: z.string().optional(),
  webhookVerifyToken: z.string().optional(),
})

const whatsappValidationSchema = z.object({
  accountId: z.string().regex(/^\d{8,25}$/, 'Meta phone-number ID must contain 8 to 25 digits'),
  wabaId: z.string().regex(/^\d{8,25}$/, 'Meta WABA ID must contain 8 to 25 digits'),
  accessToken: z.string().trim().min(1).max(8192).optional(),
})

const phoneRegistrationSchema = z.object({
  // Meta requires the two-step verification PIN as exactly six decimal digits.
  // Keep this as a string so leading zeroes survive validation and transport.
  pin: z.string().regex(/^\d{6}$/, 'PIN must contain exactly six digits'),
})

const GRAPH_API_VERSION = process.env['META_GRAPH_API_VERSION'] || 'v24.0'

const META_ENV_ITEMS = [
  {
    key: 'META_APP_ID',
    label: 'Meta app ID',
    detail: 'App ID from the production Meta Developer app that owns WhatsApp Business Platform access.',
  },
  {
    key: 'META_EMBEDDED_SIGNUP_CONFIG_ID',
    label: 'Embedded Signup configuration ID',
    detail: 'Facebook Login for Business configuration ID used by the WhatsApp Embedded Signup flow.',
  },
  {
    key: 'META_APP_SECRET',
    label: 'Meta app secret',
    detail: 'Required for exchanging Embedded Signup codes and validating signed webhook POST requests.',
  },
] as const

function metaEmbeddedSignupConfig() {
  const appId = process.env['META_APP_ID'] || process.env['NEXT_PUBLIC_META_APP_ID'] || ''
  const configId =
    process.env['META_EMBEDDED_SIGNUP_CONFIG_ID'] ||
    process.env['META_LOGIN_CONFIG_ID'] ||
    process.env['NEXT_PUBLIC_META_EMBEDDED_SIGNUP_CONFIG_ID'] ||
    ''
  const appSecretConfigured = Boolean(process.env['META_APP_SECRET'])
  return {
    appId,
    configId,
    graphApiVersion: GRAPH_API_VERSION,
    appSecretConfigured,
    webhookUrl: publicWebhookUrl('/webhook/whatsapp'),
    isConfigured: Boolean(appId && configId && appSecretConfigured),
    missing: [
      !appId ? 'META_APP_ID' : null,
      !configId ? 'META_EMBEDDED_SIGNUP_CONFIG_ID' : null,
      !appSecretConfigured ? 'META_APP_SECRET' : null,
    ].filter(Boolean),
    checklist: META_ENV_ITEMS.map((item) => ({
      ...item,
      configured:
        item.key === 'META_APP_ID'
          ? Boolean(appId)
          : item.key === 'META_EMBEDDED_SIGNUP_CONFIG_ID'
            ? Boolean(configId)
            : appSecretConfigured,
    })),
  }
}

async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const { appId } = metaEmbeddedSignupConfig()
  const appSecret = process.env['META_APP_SECRET'] ?? ''
  if (!appId || !appSecret) throw new Error('Meta app credentials are not configured')

  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/oauth/access_token`)
  url.searchParams.set('client_id', appId)
  url.searchParams.set('client_secret', appSecret)
  url.searchParams.set('code', code)

  const res = await fetch(url)
  const body = (await res.json().catch(() => null)) as { access_token?: string; error?: { message?: string } } | null
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.error?.message ?? `Meta token exchange failed with ${res.status}`)
  }
  return body.access_token
}

async function graphRequest<T>(
  path: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const url = new URL(`https://graph.facebook.com/${GRAPH_API_VERSION}/${path.replace(/^\//, '')}`)
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  const res = await fetch(url, { ...init, headers })
  const data = (await res.json().catch(() => null)) as (T & { error?: { message?: string } }) | null
  if (!res.ok) return { ok: false, error: data?.error?.message ?? `Graph API request failed with ${res.status}` }
  return { ok: true, data: data as T }
}

type MetaPhoneRegistrationResult =
  | { ok: true }
  | { ok: false; status: number; error: string; code?: number; subcode?: number }

export async function registerMetaPhoneNumber(
  phoneNumberId: string,
  accessToken: string,
  pin: string,
): Promise<MetaPhoneRegistrationResult> {
  const url = new URL(
    `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(phoneNumberId)}/register`,
  )
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  })
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
  const body = (await response.json().catch(() => null)) as
    | {
        success?: boolean
        error?: { message?: string; code?: number; error_subcode?: number }
      }
    | null

  if (!response.ok || body?.success !== true) {
    return {
      ok: false,
      status: response.status,
      error: body?.error?.message ?? `Meta phone registration failed with ${response.status}`,
      ...(typeof body?.error?.code === 'number' ? { code: body.error.code } : {}),
      ...(typeof body?.error?.error_subcode === 'number' ? { subcode: body.error.error_subcode } : {}),
    }
  }
  return { ok: true }
}

async function subscribeWabaToApp(wabaId: string | undefined, accessToken: string): Promise<{ subscribed: boolean; error?: string }> {
  if (!wabaId) return { subscribed: false, error: 'Embedded Signup did not return a WABA ID.' }
  const result = await graphRequest<{ success?: boolean }>(`${wabaId}/subscribed_apps`, accessToken, { method: 'POST' })
  if (!result.ok) return { subscribed: false, error: result.error }
  return { subscribed: true }
}

function publicWebhookUrl(path: string) {
  const appUrl = (process.env['APP_URL'] || process.env['PUBLIC_APP_URL'] || process.env['WEBHOOK_BASE_URL'] || '').replace(/\/$/, '')
  return `${appUrl || 'https://docmeedevelopment.dev'}/api${path}`
}

function readEncryptionKeyFromLocalEnv(startDir: string) {
  let currentDir = startDir
  const root = parse(currentDir).root
  while (true) {
    const envPath = join(currentDir, '.env')
    if (existsSync(envPath)) {
      const line = readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .find((item) => item.trim().startsWith('ENCRYPTION_KEY='))
      const separatorIndex = line?.indexOf('=') ?? -1
      const value = separatorIndex >= 0 ? line?.slice(separatorIndex + 1).trim() : ''
      if (value) return value.replace(/^['"]|['"]$/g, '')
    }
    const keyPath = join(currentDir, 'ENCRYPTION_KEY.txt')
    if (existsSync(keyPath)) {
      const value = readFileSync(keyPath, 'utf8').trim()
      if (value) return value.replace(/^['"]|['"]$/g, '')
    }
    if (currentDir === root) return ''
    currentDir = dirname(currentDir)
  }
}

function resolveEncryptionKey() {
  const existing = process.env['ENCRYPTION_KEY']?.trim()
  if (existing) return existing
  const local =
    readEncryptionKeyFromLocalEnv(process.cwd()) ||
    readEncryptionKeyFromLocalEnv(dirname(fileURLToPath(import.meta.url)))
  if (local) process.env['ENCRYPTION_KEY'] = local
  return local
}

function encryptChannelSecret(value: string) {
  if (!resolveEncryptionKey()) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Set ENCRYPTION_KEY to a stable secret before saving WhatsApp tokens.',
    )
  }
  return encryptValue(value)
}

function isEncryptionConfigError(error: unknown) {
  return error instanceof Error && error.message.includes('ENCRYPTION_KEY')
}

async function fetchPhoneNumberInfo(phoneNumberId: string, accessToken: string) {
  const result = await graphRequest<{
    id?: string
    display_phone_number?: string
    verified_name?: string
    quality_rating?: string
    code_verification_status?: string
    name_status?: string
    platform_type?: string
    status?: string
    throughput?: { level?: string }
  }>(
    `${phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,status,throughput`,
    accessToken,
  )
  if (!result.ok) return { phoneInfo: null, phoneInfoError: result.error }
  return { phoneInfo: result.data, phoneInfoError: undefined }
}

async function fetchWabaPhoneNumbers(wabaId: string | undefined, accessToken: string) {
  if (!wabaId) return { phones: [], error: 'No WABA ID is stored for this WhatsApp account.' }
  const result = await graphRequest<{
    data?: Array<{
      id?: string
      display_phone_number?: string
      verified_name?: string
      platform_type?: string
      status?: string
      code_verification_status?: string
    }>
  }>(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,platform_type,status,code_verification_status`,
    accessToken,
  )
  if (!result.ok) return { phones: [], error: result.error }
  return { phones: result.data.data ?? [], error: undefined }
}

async function validateWhatsAppCredentials(phoneNumberId: string, wabaId: string, accessToken: string) {
  const [phoneLookup, wabaLookup] = await Promise.all([
    fetchPhoneNumberInfo(phoneNumberId, accessToken),
    fetchWabaPhoneNumbers(wabaId, accessToken),
  ])
  const belongsToWaba = wabaLookup.phones.some((phone) => phone.id === phoneNumberId)
  const checks = [
    {
      key: 'access',
      state: phoneLookup.phoneInfoError || wabaLookup.error ? 'fail' : 'pass',
      label: 'Meta API access',
      detail: phoneLookup.phoneInfoError ?? wabaLookup.error ?? 'The token can read the phone and WABA.',
    },
    {
      key: 'membership',
      state: belongsToWaba ? 'pass' : 'fail',
      label: 'WABA ownership',
      detail: belongsToWaba
        ? 'The phone number belongs to the selected WABA.'
        : 'The phone number was not found under the selected WABA.',
    },
  ] as const
  return {
    valid: checks.every((check) => check.state === 'pass'),
    phone: phoneLookup.phoneInfo
      ? {
          id: phoneNumberId,
          displayPhoneNumber: phoneLookup.phoneInfo.display_phone_number ?? null,
          verifiedName: phoneLookup.phoneInfo.verified_name ?? null,
          platform: phoneLookup.phoneInfo.platform_type ?? null,
          status: phoneLookup.phoneInfo.status ?? null,
          codeVerification: phoneLookup.phoneInfo.code_verification_status ?? null,
          quality: phoneLookup.phoneInfo.quality_rating ?? null,
        }
      : null,
    waba: {
      id: wabaId,
      phoneCount: wabaLookup.phones.length,
      containsPhone: belongsToWaba,
    },
    checks,
  }
}

function readMetaToken(stored: string | null | undefined): string | null {
  if (!stored) return null
  if (stored.split(':').length !== 3) return stored
  try {
    return decryptValue(stored)
  } catch {
    return null
  }
}

function redactAccount(account: {
  id: string
  clinicId: string
  channel: string
  accountId: string
  displayName: string | null
  status: string
  accessTokenEnc: string | null
  webhookVerifyToken: string | null
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}) {
  return {
    id: account.id,
    clinicId: account.clinicId,
    channel: account.channel,
    accountId: account.accountId,
    displayName: account.displayName,
    status: account.status,
    provider:
      account.settings?.provider === 'meta_whatsapp' || !account.settings?.provider
        ? 'meta_whatsapp'
        : 'unsupported',
    setupMode:
      account.settings?.setupMode === 'new-number' ||
      account.settings?.setupMode === 'migrate-business-app' ||
      account.settings?.setupMode === 'existing-cloud-api'
        ? account.settings.setupMode
        : null,
    wabaId: typeof account.settings?.wabaId === 'string' ? account.settings.wabaId : null,
    source: typeof account.settings?.source === 'string' ? account.settings.source : null,
    embeddedSignupVersion:
      typeof account.settings?.embeddedSignupVersion === 'string'
        ? account.settings.embeddedSignupVersion
        : null,
    hasAccessToken: Boolean(account.accessTokenEnc),
    hasWebhookVerifyToken: Boolean(account.webhookVerifyToken),
    tokenExpiresAt:
      typeof account.settings?.tokenExpiresAt === 'string' ? account.settings.tokenExpiresAt : null,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

type ChannelAccountRecord = {
  id: string
  clinicId: string
  channel: string
  accountId: string
  displayName: string | null
  status: string
  accessTokenEnc: string | null
  webhookVerifyToken: string | null
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

type RedactedChannelAccount = ReturnType<typeof redactAccount>
type WhatsAppHealthState = 'pass' | 'warning' | 'fail'

function buildWhatsAppHealth(accounts: RedactedChannelAccount[]) {
  const config = metaEmbeddedSignupConfig()
  const whatsappAccounts = accounts.filter((account) => account.channel === 'whatsapp')
  const metaAccounts = whatsappAccounts.filter((account) => account.provider === 'meta_whatsapp')
  const activeMetaAccounts = metaAccounts.filter((account) => account.status === 'active')
  const hasProductionCredentials = activeMetaAccounts.some((account) => account.hasAccessToken)
  const hasWebhookVerifyToken = activeMetaAccounts.some((account) => account.hasWebhookVerifyToken)
  const hasWabaId = activeMetaAccounts.some((account) => Boolean(account.wabaId?.trim()))
  const hasValidPhoneNumberId = activeMetaAccounts.some((account) => /^\d{8,25}$/.test(account.accountId))
  const productionReady =
    activeMetaAccounts.length > 0 &&
    hasProductionCredentials &&
    hasWebhookVerifyToken &&
    hasWabaId &&
    hasValidPhoneNumberId
  const checks = [
    {
      key: 'meta_app',
      label: 'Meta embedded signup app',
      state: config.isConfigured ? 'pass' : 'fail',
      detail: config.isConfigured
        ? 'Meta app, signup configuration, and app secret are configured.'
        : `Missing ${config.missing.join(', ')}.`,
      action: 'Set the missing Meta app values on the live server before production onboarding.',
    },
    {
      key: 'production_account',
      label: 'Production WhatsApp account',
      state: activeMetaAccounts.length > 0 ? 'pass' : 'fail',
      detail:
        activeMetaAccounts.length > 0
          ? `${activeMetaAccounts.length} Meta WhatsApp Business account(s) are active.`
          : 'No Meta WhatsApp Business account is active.',
      action: 'Connect Meta WhatsApp Business Cloud API for the clinic.',
    },
    {
      key: 'provider_credentials',
      label: 'Provider credentials',
      state: hasProductionCredentials ? 'pass' : 'fail',
      detail: hasProductionCredentials
        ? 'A Meta WhatsApp Business access token is stored.'
        : 'No Meta WhatsApp Business access token is stored.',
      action: 'Save a production Meta WhatsApp Business access token.',
    },
    {
      key: 'waba_id',
      label: 'WABA ID',
      state: hasWabaId ? 'pass' : 'fail',
      detail: hasWabaId
        ? 'A WABA ID is stored for an active Meta WhatsApp Business account.'
        : 'No WABA ID is stored for an active Meta WhatsApp Business account.',
      action: 'Complete Embedded Signup or save the WABA ID that owns this phone number.',
    },
    {
      key: 'phone_number_id',
      label: 'Meta phone-number ID',
      state: hasValidPhoneNumberId ? 'pass' : 'fail',
      detail: hasValidPhoneNumberId
        ? 'An active account has a numeric Meta phone-number ID.'
        : 'An active account has no valid numeric Meta phone-number ID.',
      action: 'Replace the account ID with the numeric phone-number ID from WhatsApp Manager.',
    },
    {
      key: 'webhook_verify_token',
      label: 'Webhook verify token',
      state: hasWebhookVerifyToken ? 'pass' : 'fail',
      detail: hasWebhookVerifyToken
        ? 'A webhook verify token is stored for Meta WhatsApp Business.'
        : 'No production webhook verify token is stored.',
      action: 'Generate and save the verify token, then paste it into Meta webhook settings.',
    },
    {
      key: 'live_webhook_urls',
      label: 'Live webhook URLs',
      state: 'pass',
      detail: publicWebhookUrl('/webhook/whatsapp'),
      action: 'Use this URL in Meta and confirm one inbound plus one outbound message.',
    },
  ] satisfies Array<{
    key: string
    label: string
    state: WhatsAppHealthState
    detail: string
    action: string
  }>
  const failedRequired = checks.filter((check) => check.state === 'fail')
  const overall = productionReady && failedRequired.length === 0 ? 'ready' : 'blocked'
  return {
    checkedAt: new Date().toISOString(),
    overall,
    productionReady,
    providerSummary: {
      metaConfigured: config.isConfigured,
      missingMetaConfig: config.missing,
      activeProductionAccounts: activeMetaAccounts.length,
      activeMetaAccounts: activeMetaAccounts.length,
    },
    checks,
    requiredActions: checks.filter((check) => check.state === 'fail').map((check) => check.action),
  }
}

async function buildWhatsAppCoexistenceReadiness(accounts: ChannelAccountRecord[], selectedAccountId?: string) {
  const config = metaEmbeddedSignupConfig()
  const metaAccounts = accounts
    .filter((account) => account.channel === 'whatsapp')
    .filter((account) => account.settings?.provider === 'meta_whatsapp' || !account.settings?.provider)
  const selected = selectedAccountId
    ? metaAccounts.find((account) => account.id === selectedAccountId)
    : null
  const active = selected ?? metaAccounts.find((account) => account.status === 'active') ?? metaAccounts[0] ?? null
  const token = readMetaToken(active?.accessTokenEnc)
  const wabaId = typeof active?.settings?.wabaId === 'string' ? active.settings.wabaId : undefined
  const setupMode = typeof active?.settings?.setupMode === 'string' ? active.settings.setupMode : null
  const isCoexistenceIntent = setupMode === 'migrate-business-app'
  const phoneLookup = active && token ? await fetchPhoneNumberInfo(active.accountId, token) : null
  const phoneInfo = phoneLookup?.phoneInfo ?? null
  const wabaLookup = token ? await fetchWabaPhoneNumbers(wabaId, token) : null
  const targetInWaba = Boolean(wabaLookup?.phones.some((phone) => phone.id === active?.accountId))
  const platform = phoneInfo?.platform_type ?? null
  const status = phoneInfo?.status ?? null
  const codeVerification = phoneInfo?.code_verification_status ?? null
  const cloudReady = platform === 'CLOUD_API' && status === 'CONNECTED'
  const oldSetupDetected = platform === 'ON_PREMISE' || status === 'DISCONNECTED'
  const checks = [
    {
      key: 'meta_app',
      label: 'Meta app configuration',
      state: config.isConfigured ? 'pass' : 'fail',
      detail: config.isConfigured
        ? 'Embedded Signup app values are configured on Docmee.'
        : `Missing ${config.missing.join(', ')}.`,
      action: 'Set the missing Meta app values before using the co-existence wizard.',
    },
    {
      key: 'docmee_account',
      label: 'Docmee WhatsApp account',
      state: active ? 'pass' : 'fail',
      detail: active
        ? `${active.displayName ?? 'WhatsApp'} is saved in Docmee for phone ID ${active.accountId}.`
        : 'No Meta WhatsApp account is saved for this clinic.',
      action: 'Connect the clinic WhatsApp number through Embedded Signup or manual Cloud API setup.',
    },
    {
      key: 'access_token',
      label: 'Meta access token',
      state: token ? 'pass' : 'fail',
      detail: token ? 'Docmee can query Meta Graph for this clinic.' : 'No usable Meta access token is stored.',
      action: 'Save a valid Meta system-user or Embedded Signup token.',
    },
    {
      key: 'waba_membership',
      label: 'WABA membership',
      state: !active || !wabaId ? 'warning' : targetInWaba ? 'pass' : 'fail',
      detail: !active
        ? 'No phone number is selected yet.'
        : !wabaId
          ? 'No WABA ID is stored for this account.'
          : targetInWaba
            ? 'The saved phone number belongs to the stored WABA.'
            : 'The saved phone number was not found under the stored WABA.',
      action: 'Finish Embedded Signup so Docmee stores the correct WABA ID and phone number ID together.',
    },
    {
      key: 'phone_platform',
      label: 'Phone platform',
      state: !phoneInfo ? 'warning' : cloudReady ? 'pass' : oldSetupDetected ? 'fail' : 'warning',
      detail: !phoneInfo
        ? phoneLookup?.phoneInfoError ?? 'Phone metadata is not available yet.'
        : `Meta reports ${phoneInfo.display_phone_number ?? active?.accountId} as ${platform ?? 'unknown'} / ${status ?? 'unknown'}.`,
      action: oldSetupDetected
        ? 'Release or migrate the old On-Premise/BSP setup, then retry co-existence or Cloud API onboarding.'
        : 'Complete Meta verification and webhook subscription for this number.',
    },
    {
      key: 'verification',
      label: 'Phone verification',
      state: codeVerification === 'VERIFIED' || cloudReady ? 'pass' : codeVerification ? 'warning' : 'warning',
      detail: codeVerification
        ? `Meta code verification status is ${codeVerification}.`
        : 'Verification status is not available.',
      action: 'Use the code or QR shown by Meta during Embedded Signup to finish ownership verification.',
    },
    {
      key: 'webhook',
      label: 'Docmee webhook',
      state: active?.webhookVerifyToken ? 'pass' : 'warning',
      detail: active?.webhookVerifyToken
        ? `Use ${publicWebhookUrl('/webhook/whatsapp')} in Meta webhooks.`
        : 'No webhook verify token is saved for this clinic.',
      action: 'Save a webhook verify token in Docmee and paste the same value in Meta.',
    },
  ] satisfies Array<{
    key: string
    label: string
    state: WhatsAppHealthState
    detail: string
    action: string
  }>

  return {
    checkedAt: new Date().toISOString(),
    mode: isCoexistenceIntent ? 'coexistence' : setupMode ?? 'unknown',
    overall: checks.some((check) => check.state === 'fail') ? 'blocked' : cloudReady ? 'ready' : 'needs_review',
    account: active ? redactAccount(active) : null,
    meta: {
      webhookUrl: publicWebhookUrl('/webhook/whatsapp'),
      graphApiVersion: GRAPH_API_VERSION,
      wabaId: wabaId ?? null,
      phone: phoneInfo
        ? {
            id: active?.accountId ?? null,
            number: phoneInfo.display_phone_number ?? null,
            name: phoneInfo.verified_name ?? null,
            platform: platform,
            status: status,
            codeVerification: codeVerification,
            quality: phoneInfo.quality_rating ?? null,
            nameStatus: phoneInfo.name_status ?? null,
            throughput: phoneInfo.throughput?.level ?? null,
          }
        : null,
      wabaPhoneCount: wabaLookup?.phones.length ?? 0,
      wabaError: wabaLookup?.error ?? null,
    },
    limitations: [
      'Co-existence uses one Business Platform connection at a time.',
      'Keep the WhatsApp Business App opened at least once every 14 days after connection.',
      'Co-existence phone numbers may be limited to 20 messages per second.',
      'Groups, calls, broadcast lists, status, catalog tools, disappearing messages, view-once, and live location remain WhatsApp Business App features, not Docmee automation features.',
    ],
    recommendedDocmeeScope: [
      'Appointment confirmations, reminders, reschedules, cancellations, and follow-up templates.',
      'Shared inbox, AI triage, human handoff, and staff replies.',
      'Clinic-safe patient segments based on booking state and opt-in, not generic marketing blasts.',
    ],
    checks,
    requiredActions: checks.filter((check) => check.state === 'fail').map((check) => check.action),
  }
}

const channelsRoute: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAuth)

  app.get(
    '/channels/meta-config',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async () => {
      const config = metaEmbeddedSignupConfig()
      return {
        appId: config.appId || null,
        configId: config.configId || null,
        graphApiVersion: config.graphApiVersion,
        appSecretConfigured: config.appSecretConfigured,
        webhookUrl: config.webhookUrl,
        isConfigured: config.isConfigured,
        missing: config.missing,
        checklist: config.checklist,
      }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/channels/active',
    { preHandler: requireRole('secretary', 'doctor', 'clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const accounts = await withDb(async (sql) => createChannelAccountsRepository(sql).listByClinic(clinicId))
      const active = new Map<string, { channel: string; name: string }>()
      for (const account of accounts) {
        if (account.status !== 'active' || active.has(account.channel)) continue
        active.set(account.channel, {
          channel: account.channel,
          name: account.displayName?.trim() || account.channel,
        })
      }
      return { channels: [...active.values()] }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/channels',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const accounts = await withDb(async (sql) => createChannelAccountsRepository(sql).listByClinic(clinicId))
      return { accounts: accounts.map(redactAccount) }
    },
  )

  app.get<{ Params: { id: string } }>(
    '/clinics/:id/channels/whatsapp/health',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const accounts = await withDb(async (sql) => createChannelAccountsRepository(sql).listByClinic(clinicId))
      return buildWhatsAppHealth(accounts.map(redactAccount))
    },
  )

  app.get<{ Params: { id: string }; Querystring: { accountId?: string } }>(
    '/clinics/:id/channels/whatsapp/coexistence-readiness',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })
      const accounts = await withDb(async (sql) => createChannelAccountsRepository(sql).listByClinic(clinicId))
      return buildWhatsAppCoexistenceReadiness(accounts, request.query.accountId)
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/channels/whatsapp/validate',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(whatsappValidationSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const existing = await withDb(async (sql) => {
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        return accounts.find(
          (item) => item.channel === 'whatsapp' && item.accountId === parsed.data.accountId,
        ) ?? null
      })
      const accessToken = parsed.data.accessToken || readMetaToken(existing?.accessTokenEnc)
      if (!accessToken) {
        return reply.code(409).send({
          error: 'A Meta access token is required to validate this WABA.',
          action: 'Paste a token with WhatsApp Business Management access and retry.',
        })
      }

      const validation = await validateWhatsAppCredentials(
        parsed.data.accountId,
        parsed.data.wabaId,
        accessToken,
      )
      return validation
    },
  )

  app.put<{ Params: { id: string; channel: string } }>(
    '/clinics/:id/channels/:channel',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      if (request.params.channel !== 'whatsapp') {
        return reply.code(400).send({ error: 'Only WhatsApp channel linking is supported here' })
      }
      const parsed = validate(whatsappSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      try {
        const account = await withDb(async (sql) => {
          const repo = createChannelAccountsRepository(sql)
          const provider = parsed.data.provider ?? 'meta_whatsapp'
          const existing = (await repo.listByClinic(clinicId)).find(
            (item) => item.channel === 'whatsapp' && item.accountId === parsed.data.accountId,
          )
          const wabaId =
            parsed.data.wabaId ??
            (typeof existing?.settings?.wabaId === 'string' ? existing.settings.wabaId : undefined)
          const accessToken = parsed.data.accessToken || readMetaToken(existing?.accessTokenEnc)
          if (!existing && (!wabaId || !accessToken || !parsed.data.webhookVerifyToken)) {
            throw new Error(
              'A new WABA requires its WABA ID, Meta access token, and webhook verify token.',
            )
          }
          if ((parsed.data.accessToken || parsed.data.wabaId || !existing) && wabaId && accessToken) {
            const validation = await validateWhatsAppCredentials(
              parsed.data.accountId,
              wabaId,
              accessToken,
            )
            if (!validation.valid) {
              const detail = validation.checks
                .filter((check) => check.state === 'fail')
                .map((check) => check.detail)
                .join(' ')
              throw new Error(`Meta validation failed. ${detail}`)
            }
          }
          const settings = {
            ...(existing?.settings ?? {}),
            provider,
            setupMode: parsed.data.setupMode ?? existing?.settings?.setupMode ?? 'existing-cloud-api',
            ...(provider === 'meta_whatsapp' && parsed.data.wabaId ? { wabaId: parsed.data.wabaId } : {}),
            ...(parsed.data.tokenExpiresAt !== undefined
              ? { tokenExpiresAt: parsed.data.tokenExpiresAt }
              : {}),
          }
          return repo.create({
            clinicId,
            channel: 'whatsapp',
            accountId: parsed.data.accountId,
            displayName: parsed.data.displayName ?? existing?.displayName ?? undefined,
            accessTokenEnc: parsed.data.accessToken
              ? encryptChannelSecret(parsed.data.accessToken)
              : existing?.accessTokenEnc ?? undefined,
            webhookVerifyToken: parsed.data.webhookVerifyToken ?? existing?.webhookVerifyToken ?? undefined,
            status: parsed.data.status ?? existing?.status ?? 'active',
            settings,
          })
        })

        return { account: redactAccount(account) }
      } catch (error) {
        if (isEncryptionConfigError(error)) return reply.code(500).send({ error: (error as Error).message })
        if (
          error instanceof Error &&
          (error.message.startsWith('A new WABA requires') ||
            error.message.startsWith('Meta validation failed'))
        ) {
          return reply.code(400).send({ error: error.message })
        }
        throw error
      }
    },
  )

  app.post<{ Params: { id: string; accountId: string } }>(
    '/clinics/:id/channels/whatsapp/:accountId/register',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(phoneRegistrationSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const account = await withDb(async (sql) => {
        const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
        return accounts.find(
          (item) => item.id === request.params.accountId && item.channel === 'whatsapp',
        ) ?? null
      })
      if (!account) {
        return reply.code(404).send({ error: 'WhatsApp account was not found for this clinic.' })
      }

      const accessToken = readMetaToken(account.accessTokenEnc)
      if (!accessToken) {
        return reply.code(409).send({
          error: 'No usable Meta access token is stored for this account.',
          action: 'Save a valid Meta system-user or Embedded Signup token, then retry registration.',
        })
      }
      const wabaId = typeof account.settings?.wabaId === 'string' ? account.settings.wabaId : undefined
      if (!wabaId) {
        return reply.code(409).send({
          error: 'No WABA ID is stored for this account.',
          action: 'Save the WABA ID that owns this phone number before registration.',
        })
      }

      const wabaLookup = await fetchWabaPhoneNumbers(wabaId, accessToken)
      if (wabaLookup.error) {
        return reply.code(502).send({
          error: `Meta could not verify WABA ownership: ${wabaLookup.error}`,
          action: 'Confirm the token has WhatsApp Business Management access and retry.',
        })
      }
      if (!wabaLookup.phones.some((phone) => phone.id === account.accountId)) {
        return reply.code(409).send({
          error: 'The stored phone number does not belong to the stored WABA.',
          action: 'Correct the WABA ID or reconnect the phone through Embedded Signup.',
        })
      }

      const registration = await registerMetaPhoneNumber(account.accountId, accessToken, parsed.data.pin)
      if (!registration.ok) {
        return reply.code(registration.status >= 500 ? 502 : 400).send({
          error: registration.error,
          ...(registration.code !== undefined ? { metaCode: registration.code } : {}),
          ...(registration.subcode !== undefined ? { metaSubcode: registration.subcode } : {}),
          action:
            'Confirm the six-digit two-step verification PIN and phone-number status in WhatsApp Manager, then retry.',
        })
      }

      return {
        ok: true,
        phoneNumberId: account.accountId,
        message: 'Meta accepted the phone-number registration.',
      }
    },
  )

  app.delete<{ Params: { id: string; accountId: string } }>(
    '/clinics/:id/channels/whatsapp/:accountId',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      const deleted = await withDb(async (sql) => {
        const repo = createChannelAccountsRepository(sql)
        const existing = (await repo.listByClinic(clinicId)).find(
          (item) => item.channel === 'whatsapp' && item.id === request.params.accountId,
        )
        if (!existing) return false
        return repo.delete(clinicId, existing.id)
      })

      if (!deleted) return reply.code(404).send({ error: 'WhatsApp account was not found.' })
      return { ok: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/clinics/:id/channels/whatsapp/embedded-signup',
    { preHandler: requireRole('clinic_admin', 'ia_studio_admin') },
    async (request, reply) => {
      const parsed = validate(embeddedSignupSchema, request.body, reply)
      if (!parsed.ok) return
      const clinicId = resolveClinicScope(request, request.params.id)
      if (!clinicId) return reply.code(403).send({ error: 'Forbidden' })

      try {
        const accessToken = await exchangeEmbeddedSignupCode(parsed.data.code)
        const subscription = await subscribeWabaToApp(parsed.data.wabaId, accessToken)
        const phoneLookup = await fetchPhoneNumberInfo(parsed.data.phoneNumberId, accessToken)
        const validation = await validateWhatsAppCredentials(
          parsed.data.phoneNumberId,
          parsed.data.wabaId,
          accessToken,
        )
        if (!validation.valid) {
          throw new Error('Meta returned a phone number that does not belong to the selected WABA.')
        }
        const account = await withDb(async (sql) => {
          const repo = createChannelAccountsRepository(sql)
          const existing = (await repo.listByClinic(clinicId)).find(
            (item) => item.channel === 'whatsapp' && item.accountId === parsed.data.phoneNumberId,
          )
          const webhookVerifyToken =
            parsed.data.webhookVerifyToken?.trim() ||
            existing?.webhookVerifyToken ||
            `docmee_${randomBytes(18).toString('hex')}`
          return repo.create({
            clinicId,
            channel: 'whatsapp',
            accountId: parsed.data.phoneNumberId,
            displayName:
              parsed.data.displayName ??
              phoneLookup.phoneInfo?.verified_name ??
              phoneLookup.phoneInfo?.display_phone_number ??
              existing?.displayName ??
              'WhatsApp Business',
            accessTokenEnc: encryptChannelSecret(accessToken),
            webhookVerifyToken,
            status: 'active',
            settings: {
              ...(existing?.settings ?? {}),
              provider: 'meta_whatsapp',
              source: 'embedded_signup',
              setupMode: parsed.data.setupMode ?? 'existing-cloud-api',
              wabaId: parsed.data.wabaId,
              embeddedSignupVersion:
                parsed.data.setupMode === 'migrate-business-app' ? 'whatsapp_business_app_onboarding' : 'standard',
              appSubscribedToWaba: subscription.subscribed,
              appSubscriptionError: subscription.error,
              phoneInfo: phoneLookup.phoneInfo,
              phoneInfoError: phoneLookup.phoneInfoError,
              linkedAt: new Date().toISOString(),
            },
          })
        })
        return { account: redactAccount(account) }
      } catch (error) {
        request.log.error({ err: error }, 'Meta Embedded Signup completion failed')
        if (isEncryptionConfigError(error)) return reply.code(500).send({ error: (error as Error).message })
        return reply.code(400).send({ error: (error as Error).message })
      }
    },
  )

}

export default channelsRoute
