'use client'

// Screen 10 — Channels & integrations. Pick a clinic, then see an at-a-glance health
// card for every channel/integration: connection state, concrete setup gaps, the
// webhook URL, and Meta token-expiry warnings (Req 19). Each card links into the
// matching section of the clinic detail page to fix things. WhatsApp is shown as an
// informational card because its config lives outside the clinic record.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { BrandIcon, type BrandIconName } from '@/shared/components/BrandIcon'
import { NavIcon } from '@/shared/components/NavIcon'
import { StudioIntegrationsPanel } from '@/shared/components/StudioIntegrationsPanel'
import { AUTOMATION_DEFS } from '@/shared/automations'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useAuthStore } from '@/shared/store/auth'
import {
  channelCards,
  type ServiceCard,
  type ServiceKey,
  type ServiceStatus,
} from '@/shared/channelStatus'
import type { TranslationKey } from '@/shared/i18n'
import type { Clinic, ClinicSettings } from '@/shared/types'

interface ChannelAccount {
  id: string
  clinicId: string
  channel: 'whatsapp' | 'messenger' | 'instagram'
  accountId: string
  displayName: string | null
  status: 'active' | 'inactive' | 'error'
  provider?: 'meta_whatsapp'
  setupMode?: WhatsAppSetupMode | null
  wabaId?: string | null
  source?: string | null
  embeddedSignupVersion?: string | null
  hasAccessToken: boolean
  hasWebhookVerifyToken: boolean
  tokenExpiresAt: string | null
  createdAt: string
  updatedAt: string
}

type WhatsAppSetupMode = 'new-number' | 'migrate-business-app' | 'existing-cloud-api'

interface MetaEmbeddedSignupConfig {
  appId: string | null
  configId: string | null
  graphApiVersion: string
  isConfigured: boolean
  missing: string[]
}

interface EmbeddedSignupAssets {
  event?: 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'CANCEL' | 'ERROR'
  phoneNumberId?: string
  wabaId?: string
  errorMessage?: string
}

interface WhatsAppReadinessCheck {
  key: string
  label: string
  state: 'pass' | 'warning' | 'fail'
  detail: string
  action: string
}

interface WhatsAppCoexistenceReadinessResponse {
  checkedAt: string
  mode: string
  overall: 'ready' | 'needs_review' | 'blocked'
  account: ChannelAccount | null
  meta: {
    webhookUrl: string
    graphApiVersion: string
    wabaId: string | null
    phone: {
      id: string | null
      number: string | null
      name: string | null
      platform: string | null
      status: string | null
      codeVerification: string | null
      quality: string | null
      nameStatus: string | null
      throughput: string | null
    } | null
    wabaPhoneCount: number
    wabaError: string | null
  }
  limitations: string[]
  recommendedDocmeeScope: string[]
  checks: WhatsAppReadinessCheck[]
  requiredActions: string[]
}

interface ProviderReadiness {
  key: 'meta' | 'google' | 'email' | 'openai' | 'anthropic'
  state: 'ready' | 'missing' | 'fallback'
  configured: boolean
  missing: string[]
}

interface SuperuserClinicSettingsForm {
  botTone: NonNullable<ClinicSettings['botTone']>
  botLanguage: NonNullable<ClinicSettings['botLanguage']>
  bookingStartHour: string
  bookingEndHour: string
  bookingSlotMinutes: string
  googleCalendarId: string
  googleSheetsEnabled: boolean
  googleSheetsSpreadsheetId: string
  googleSheetsSheetName: string
  messengerTokenExpiresAt: string
  instagramTokenExpiresAt: string
  reviewLink: string
  licenseKey: string
  reviewRequestsEnabled: boolean
  followUpsEnabled: boolean
}

declare global {
  interface Window {
    FB?: {
      init: (options: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }) => void
      login: (
        callback: (response: { authResponse?: { code?: string } }) => void,
        options: Record<string, unknown>,
      ) => void
    }
    fbAsyncInit?: () => void
  }
}

const SVC_NAME: Record<ServiceKey | 'whatsapp', TranslationKey> = {
  whatsapp: 'studio.channels.svc.whatsapp',
  messenger: 'studio.channels.svc.messenger',
  instagram: 'studio.channels.svc.instagram',
  calendar: 'studio.channels.svc.calendar',
  sheets: 'studio.channels.svc.sheets',
}
const SVC_DESC: Record<ServiceKey | 'whatsapp', TranslationKey> = {
  whatsapp: 'studio.channels.desc.whatsapp',
  messenger: 'studio.channels.desc.messenger',
  instagram: 'studio.channels.desc.instagram',
  calendar: 'studio.channels.desc.calendar',
  sheets: 'studio.channels.desc.sheets',
}
const STATUS_LABEL: Record<ServiceStatus, TranslationKey> = {
  connected: 'studio.channels.status.connected',
  expiring: 'studio.channels.status.expiring',
  expired: 'studio.channels.status.expired',
  pending: 'studio.channels.status.pending',
  disconnected: 'studio.channels.status.disconnected',
}
const STATUS_STYLE: Record<ServiceStatus, string> = {
  connected:
    'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
  expiring:
    'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
  expired: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300',
  pending:
    'border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300',
  disconnected:
    'border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
}
const STATUS_DOT: Record<ServiceStatus, string> = {
  connected: 'bg-emerald-500',
  expiring: 'bg-amber-500',
  expired: 'bg-red-500',
  pending: 'bg-orange-500',
  disconnected: 'bg-gray-400',
}

export default function ChannelsPage() {
  const { t } = useI18n()
  const { clinicId, switchClinic } = useActiveClinic()
  const user = useAuthStore((state) => state.user)
  const queryClient = useQueryClient()
  const isSuperuser = user?.role === 'ia_studio_admin'

  const query = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })
  const clinic = query.data?.clinic
  const channelQuery = useQuery({
    queryKey: ['clinic-channels', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ accounts: ChannelAccount[] }>(`/clinics/${clinicId}/channels`),
  })
  const whatsappAccounts = channelQuery.data?.accounts.filter((account) => account.channel === 'whatsapp') ?? []
  const whatsappAccount =
    whatsappAccounts.find((account) => account.provider === 'meta_whatsapp') ??
    whatsappAccounts.find((account) => account.status === 'active') ??
    whatsappAccounts[0] ??
    null

  // Date.now() is read once per render; channelStatus stays pure (now is passed in).
  const cards = useMemo<ServiceCard[]>(
    () =>
      clinic ? channelCards(clinic, { apiBase: API_BASE, now: Date.now() }) : [],
    [clinic],
  )
  const connectedCount = cards.filter((c) => c.status === 'connected').length

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('studio.channels.title')}</h1>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
      </div>
      <p className="mb-4 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
        Connect the tools your clinic uses for patient messages, appointment sync, exports, email alerts, and J.zel.
        Each card shows what is ready, what is missing, and the exact values to paste from the provider account.
      </p>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.kb.selectClinic')}</p>
      ) : query.isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
            />
          ))}
        </div>
      ) : query.isError || !clinic ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('common.error')}{' '}
          <button type="button" onClick={() => query.refetch()} className="font-medium underline">
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-medium dark:bg-gray-800">
              {t('studio.channels.connectedSummary', { n: connectedCount, total: cards.length })}
            </span>
          </div>

          <ProviderStatusPanel clinic={clinic} whatsappAccounts={whatsappAccounts} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {cards.map((card) => (
              <ServiceCardView key={card.key} card={card} clinic={clinic} onSaved={() => queryClient.invalidateQueries({ queryKey: ['clinic', clinicId] })} />
            ))}
            <WhatsAppCard clinicId={clinicId} account={whatsappAccount} webhookUrl={`${API_BASE}/webhook/whatsapp`} onSaved={() => queryClient.invalidateQueries({ queryKey: ['clinic-channels', clinicId] })} />
          </div>
          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold">Guided integration setup</h2>
              <p className="mt-1 text-xs text-gray-500">
                Step-by-step forms for Google Calendar, Sheets, email delivery, automation webhooks, and the AI provider used by J.zel.
              </p>
            </div>
            <StudioIntegrationsPanel clinic={clinic} />
          </section>
          {isSuperuser && <SuperuserClinicSettingsEditor clinic={clinic} />}
        </>
      )}
    </div>
  )
}

const toDateInputValue = (value: unknown) => (typeof value === 'string' ? value.slice(0, 10) : '')

function buildSuperuserSettingsForm(settings: ClinicSettings | undefined): SuperuserClinicSettingsForm {
  return {
    botTone: settings?.botTone ?? 'professional',
    botLanguage: settings?.botLanguage ?? 'auto',
    bookingStartHour: String(settings?.bookingGrid?.startHour ?? 8),
    bookingEndHour: String(settings?.bookingGrid?.endHour ?? 17),
    bookingSlotMinutes: String(settings?.bookingGrid?.slotMinutes ?? 30),
    googleCalendarId: settings?.googleCalendar?.calendarId ? String(settings.googleCalendar.calendarId) : '',
    googleSheetsEnabled: Boolean(settings?.googleSheets?.enabled),
    googleSheetsSpreadsheetId: settings?.googleSheets?.spreadsheetId ? String(settings.googleSheets.spreadsheetId) : '',
    googleSheetsSheetName: settings?.googleSheets?.sheetName ? String(settings.googleSheets.sheetName) : '',
    messengerTokenExpiresAt: toDateInputValue(settings?.messengerTokenExpiresAt),
    instagramTokenExpiresAt: toDateInputValue(settings?.instagramTokenExpiresAt),
    reviewLink: typeof settings?.reviewLink === 'string' ? settings.reviewLink : '',
    licenseKey: typeof settings?.license_key === 'string' ? settings.license_key : '',
    reviewRequestsEnabled: settings?.automations?.reviewRequest?.enabled !== false,
    followUpsEnabled: AUTOMATION_DEFS.every((definition) => settings?.automations?.followUps?.[definition.type] !== false),
  }
}

function integerFromForm(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function SuperuserClinicSettingsEditor({ clinic }: { clinic: Clinic }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<SuperuserClinicSettingsForm>(() =>
    buildSuperuserSettingsForm(clinic.settings as ClinicSettings | undefined),
  )
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    setForm(buildSuperuserSettingsForm(clinic.settings as ClinicSettings | undefined))
    setMessage(null)
  }, [clinic.id, clinic.settings])
  const save = useMutation({
    mutationFn: () => {
      const startHour = integerFromForm(form.bookingStartHour, 8)
      const endHour = integerFromForm(form.bookingEndHour, 17)
      const slotMinutes = integerFromForm(form.bookingSlotMinutes, 30)
      if (startHour < 0 || startHour > 23 || endHour < 1 || endHour > 24 || startHour >= endHour) {
        throw new Error('Booking hours must be valid and the end time must be after the start time.')
      }
      if (![5, 10, 15, 20, 30, 45, 60].includes(slotMinutes)) {
        throw new Error('Slot length must be 5, 10, 15, 20, 30, 45, or 60 minutes.')
      }

      const current = (clinic.settings ?? {}) as ClinicSettings
      const nextSettings: ClinicSettings = {
        ...current,
        botTone: form.botTone,
        botLanguage: form.botLanguage,
        bookingGrid: { ...(current.bookingGrid ?? {}), startHour, endHour, slotMinutes },
        googleCalendar: {
          ...(current.googleCalendar ?? {}),
          calendarId: form.googleCalendarId.trim() || undefined,
        },
        googleSheets: {
          ...(current.googleSheets ?? {}),
          enabled: form.googleSheetsEnabled,
          spreadsheetId: form.googleSheetsSpreadsheetId.trim() || undefined,
          sheetName: form.googleSheetsSheetName.trim() || undefined,
        },
        messengerTokenExpiresAt: form.messengerTokenExpiresAt || undefined,
        instagramTokenExpiresAt: form.instagramTokenExpiresAt || undefined,
        reviewLink: form.reviewLink.trim() || undefined,
        license_key: form.licenseKey.trim() || undefined,
        automations: {
          ...(current.automations ?? {}),
          reviewRequest: { ...(current.automations?.reviewRequest ?? {}), enabled: form.reviewRequestsEnabled },
          followUps: Object.fromEntries(
            AUTOMATION_DEFS.map((definition) => [definition.type, form.followUpsEnabled]),
          ) as NonNullable<ClinicSettings['automations']>['followUps'],
        },
      }

      return api.patch(`/clinics/${clinic.id}`, { settings: nextSettings })
    },
    onSuccess: () => {
      setMessage('Clinic settings saved.')
      queryClient.invalidateQueries({ queryKey: ['clinic', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save settings.'),
  })
  const updateField = <K extends keyof SuperuserClinicSettingsForm>(key: K, value: SuperuserClinicSettingsForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }))

  return (
    <section className="clinic-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Superuser clinic settings</h2>
          <p className="mt-1 text-xs text-gray-500">
            No-code controls for clinic-wide behavior. Existing hidden settings are preserved when you save.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase text-gray-400">J.zel behavior</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-500">
              Tone
              <select
                value={form.botTone}
                onChange={(event) => updateField('botTone', event.target.value as SuperuserClinicSettingsForm['botTone'])}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
              >
                <option value="professional">Professional</option>
                <option value="friendly">Friendly</option>
                <option value="brief">Brief</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-gray-500">
              Reply language
              <select
                value={form.botLanguage}
                onChange={(event) => updateField('botLanguage', event.target.value as SuperuserClinicSettingsForm['botLanguage'])}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
              >
                <option value="auto">Auto-detect</option>
                <option value="es">Spanish</option>
                <option value="en">English</option>
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase text-gray-400">Booking grid</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="block text-xs font-medium text-gray-500">
              Start
              <input
                value={form.bookingStartHour}
                onChange={(event) => updateField('bookingStartHour', event.target.value)}
                type="number"
                min={0}
                max={23}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
              />
            </label>
            <label className="block text-xs font-medium text-gray-500">
              End
              <input
                value={form.bookingEndHour}
                onChange={(event) => updateField('bookingEndHour', event.target.value)}
                type="number"
                min={1}
                max={24}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
              />
            </label>
            <label className="block text-xs font-medium text-gray-500">
              Minutes
              <select
                value={form.bookingSlotMinutes}
                onChange={(event) => updateField('bookingSlotMinutes', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
              >
                {[5, 10, 15, 20, 30, 45, 60].map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase text-gray-400">Google integrations</h3>
          <div className="mt-3 space-y-2">
            <label className="block text-xs font-medium text-gray-500">
              Calendar ID
              <input
                value={form.googleCalendarId}
                onChange={(event) => updateField('googleCalendarId', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                placeholder="clinic@example.com"
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.googleSheetsEnabled}
                onChange={(event) => updateField('googleSheetsEnabled', event.target.checked)}
              />
              Enable Google Sheets export
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-gray-500">
                Spreadsheet ID
                <input
                  value={form.googleSheetsSpreadsheetId}
                  onChange={(event) => updateField('googleSheetsSpreadsheetId', event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                />
              </label>
              <label className="block text-xs font-medium text-gray-500">
                Sheet name
                <input
                  value={form.googleSheetsSheetName}
                  onChange={(event) => updateField('googleSheetsSheetName', event.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                  placeholder="Bookings"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase text-gray-400">Automation and tokens</h3>
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs font-medium text-gray-500">
                Messenger token expires
                <input
                  value={form.messengerTokenExpiresAt}
                  onChange={(event) => updateField('messengerTokenExpiresAt', event.target.value)}
                  type="date"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                />
              </label>
              <label className="block text-xs font-medium text-gray-500">
                Instagram token expires
                <input
                  value={form.instagramTokenExpiresAt}
                  onChange={(event) => updateField('instagramTokenExpiresAt', event.target.value)}
                  type="date"
                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                />
              </label>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                ['reviewRequestsEnabled', 'Review requests'],
                ['followUpsEnabled', 'Follow-ups'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={Boolean(form[key as keyof SuperuserClinicSettingsForm])}
                    onChange={(event) => updateField(key as keyof SuperuserClinicSettingsForm, event.target.checked as never)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-800 lg:col-span-2">
          <h3 className="text-xs font-semibold uppercase text-gray-400">Clinic links and license</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="block text-xs font-medium text-gray-500">
              Review link
              <input
                value={form.reviewLink}
                onChange={(event) => updateField('reviewLink', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                placeholder="https://..."
              />
            </label>
            <label className="block text-xs font-medium text-gray-500">
              License key
              <input
                value={form.licenseKey}
                onChange={(event) => updateField('licenseKey', event.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-50"
                placeholder="Stored securely by the backend"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className={save.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
        <button
          type="button"
          onClick={() => {
            setMessage(null)
            save.mutate()
          }}
          disabled={save.isPending}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
        >
          {save.isPending ? 'Saving...' : 'Save clinic settings'}
        </button>
      </div>
    </section>
  )
}

function ProviderStatusPanel({
  clinic,
  whatsappAccounts,
}: {
  clinic: Clinic
  whatsappAccounts: ChannelAccount[]
}) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const whatsappActive = whatsappAccounts.some((account) => account.status === 'active')
  const whatsappConfigured = whatsappAccounts.some(
    (account) => account.provider === 'meta_whatsapp' && account.hasAccessToken,
  )
  const lastWhatsAppUpdate = whatsappAccounts
    .map((account) => account.updatedAt)
    .sort()
    .at(-1)

  const googleConnected = Boolean(settings.googleCalendar && typeof settings.googleCalendar === 'object')
  const sheetsReady = Boolean(settings.googleSheets?.enabled && settings.googleSheets?.spreadsheetId)
  const providerQuery = useQuery({
    queryKey: ['provider-status'],
    queryFn: () => api.get<{ providers: ProviderReadiness[] }>('/provider-status'),
  })
  const providerMap = new Map((providerQuery.data?.providers ?? []).map((provider) => [provider.key, provider]))
  const email = providerMap.get('email')
  const openai = providerMap.get('openai')
  const anthropic = providerMap.get('anthropic')
  const llmFallback = openai?.state === 'fallback' || anthropic?.state === 'fallback'
  const llmReady = Boolean(openai?.configured || anthropic?.configured)

  return (
    <section className="clinic-card mb-3 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('studio.channels.providerStatus.title')}</h2>
        <span className="text-[11px] text-gray-400">{t('studio.channels.providerStatus.noSecrets')}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <ProviderTile
          icon="whatsapp"
          label={t('studio.channels.providerStatus.whatsapp')}
          state={whatsappActive && whatsappConfigured ? 'ready' : whatsappConfigured ? 'warning' : 'missing'}
          detail={
            lastWhatsAppUpdate
              ? t('studio.channels.providerStatus.lastUpdated', { date: lastWhatsAppUpdate.slice(0, 10) })
              : t('studio.channels.providerStatus.noWebhookYet')
          }
        />
        <ProviderTile
          icon="googleCalendar"
          label={t('studio.channels.providerStatus.google')}
          state={googleConnected ? 'ready' : 'missing'}
          detail={googleConnected ? t('studio.channels.providerStatus.calendarReady') : t('studio.channels.providerStatus.connectGoogle')}
        />
        <ProviderTile
          icon="email"
          label={t('studio.channels.providerStatus.email')}
          state={email?.configured ? 'ready' : 'missing'}
          detail={
            email?.configured
              ? t('studio.channels.providerStatus.emailReady')
              : 'Email delivery needs admin setup.'
          }
        />
        <ProviderTile
          icon={openai?.configured ? 'openai' : anthropic?.configured ? 'anthropic' : 'openai'}
          label={t('studio.channels.providerStatus.llm')}
          state={llmFallback ? 'fallback' : llmReady ? 'ready' : 'missing'}
          detail={
            llmFallback
              ? t('studio.channels.providerStatus.llmFallback')
              : llmReady
                ? t('studio.channels.providerStatus.llmReady')
                : 'AI response provider needs admin setup.'
          }
        />
        <ProviderTile
          icon="googleSheets"
          label={t('studio.channels.providerStatus.sheets')}
          state={sheetsReady ? 'ready' : 'missing'}
          detail={sheetsReady ? t('studio.channels.providerStatus.sheetsReady') : t('studio.channels.providerStatus.configureSheets')}
        />
      </div>
    </section>
  )
}

function ProviderTile({
  icon,
  label,
  state,
  detail,
}: {
  icon: BrandIconName
  label: string
  state: 'ready' | 'warning' | 'missing' | 'unknown' | 'fallback'
  detail: string
}) {
  const { t } = useI18n()
  const tone =
    state === 'ready'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
      : state === 'warning'
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
      : state === 'unknown' || state === 'fallback'
          ? 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300'
          : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
  return (
    <div className={`rounded-md border p-2 text-xs ${tone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BrandIcon name={icon} className="h-7 w-7" />
          <p className="truncate font-semibold">{label}</p>
        </div>
        <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] dark:bg-black/20">
          {t(`studio.channels.providerStatus.${state}` as TranslationKey)}
        </span>
      </div>
      <p className="mt-1 text-[11px] opacity-90">{detail}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {t(STATUS_LABEL[status])}
    </span>
  )
}

function ServiceTile({ svc }: { svc: ServiceKey | 'whatsapp' }) {
  if (svc === 'whatsapp') return <BrandIcon name="whatsapp" />
  if (svc === 'messenger') return <BrandIcon name="facebook" />
  if (svc === 'instagram') return <BrandIcon name="instagram" />
  if (svc === 'calendar') return <BrandIcon name="googleCalendar" />
  if (svc === 'sheets') return <BrandIcon name="googleSheets" />
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
    >
      <NavIcon name="channels" />
    </span>
  )
}

function ServiceCardView({
  card,
  clinic,
  onSaved,
}: {
  card: ServiceCard
  clinic: Clinic
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const label = card.key === 'messenger' ? 'Facebook' : t(SVC_NAME[card.key])
  return (
    <div className="clinic-card flex flex-col p-3">
      <div className="flex items-start gap-2.5">
        <ServiceTile svc={card.key} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{label}</p>
          <p className="truncate text-xs text-gray-400">{t(SVC_DESC[card.key])}</p>
        </div>
        <StatusBadge status={card.status} />
      </div>

      <div className="mt-2.5 flex-1 space-y-1.5 text-xs">
        {card.issues.length > 0 ? (
          <ul className="space-y-1">
            {card.issues.map((issue) => (
              <li key={issue} className="flex gap-1.5 text-orange-700 dark:text-orange-300">
                <span aria-hidden>!</span>
                <span>{t(`studio.channels.issue.${issue}` as TranslationKey)}</span>
              </li>
            ))}
          </ul>
        ) : card.status === 'connected' ? (
          <p className="text-emerald-600 dark:text-emerald-400">{t('studio.channels.allGood')}</p>
        ) : null}

        {card.tokenExpiry && (
          <p
            className={
              card.tokenExpiry.state === 'expired'
                ? 'text-red-600 dark:text-red-400'
                : card.tokenExpiry.state === 'expiring'
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-400'
            }
          >
            {card.tokenExpiry.state === 'expired'
              ? t('studio.channels.tokenExpiredOn', { date: card.tokenExpiry.date.slice(0, 10) })
              : card.tokenExpiry.state === 'expiring'
                ? t('studio.channels.tokenExpiresIn', {
                    n: card.tokenExpiry.daysLeft,
                    date: card.tokenExpiry.date.slice(0, 10),
                  })
                : t('studio.channels.tokenOk', { date: card.tokenExpiry.date.slice(0, 10) })}
          </p>
        )}

        {card.webhookUrl && <WebhookRow url={card.webhookUrl} />}
      </div>

      <div className="mt-2.5 border-t border-gray-100 pt-2 dark:border-gray-800">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {open ? 'Hide configuration' : 'Show configuration'}
        </button>
      </div>

      {open && <IntegrationWizard card={card} clinic={clinic} onSaved={onSaved} />}
    </div>
  )
}

function IntegrationWizard({ card, clinic, onSaved }: { card: ServiceCard; clinic: Clinic; onSaved: () => void }) {
  if (card.key === 'messenger' || card.key === 'instagram') {
    return <MetaChannelWizard card={card} clinic={clinic} onSaved={onSaved} />
  }
  if (card.key === 'calendar') return <CalendarWizard clinic={clinic} onSaved={onSaved} />
  return <SheetsWizard clinic={clinic} onSaved={onSaved} />
}

function loadFacebookSdk(appId: string, version: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Facebook signup must run in the browser.'))
  if (window.FB) {
    window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version })
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, autoLogAppEvents: true, xfbml: false, version })
      resolve()
    }
    const existing = document.getElementById('facebook-jssdk') as HTMLScriptElement | null
    if (existing) {
      existing.addEventListener('error', () => reject(new Error('Could not load Facebook SDK.')), { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = 'facebook-jssdk'
    script.async = true
    script.defer = true
    script.crossOrigin = 'anonymous'
    script.src = 'https://connect.facebook.net/en_US/sdk.js'
    script.onerror = () => reject(new Error('Could not load Facebook SDK.'))
    document.body.appendChild(script)
  })
}

function parseEmbeddedSignupMessage(event: MessageEvent): EmbeddedSignupAssets | null {
  if (!['https://www.facebook.com', 'https://web.facebook.com'].includes(event.origin)) return null
  const payload = typeof event.data === 'string' ? safeJson(event.data) : event.data
  if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return null
  return {
    event: payload.event,
    phoneNumberId: payload.data?.phone_number_id,
    wabaId: payload.data?.waba_id,
    errorMessage: payload.data?.error_message,
  }
}

function safeJson(value: string): {
  type?: string
  event?: 'FINISH' | 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' | 'CANCEL' | 'ERROR'
  data?: { phone_number_id?: string; waba_id?: string; error_message?: string }
} | null {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function MetaStandardChecklist({ webhookUrl, configured }: { webhookUrl: string; configured?: boolean }) {
  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-white p-3 text-left text-xs dark:border-gray-800 dark:bg-gray-900">
      <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-50">Technical WhatsApp checklist</summary>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span
          className={
            configured
              ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
              : 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300'
          }
        >
          {configured ? 'Meta app ready' : 'Meta app setup needed'}
        </span>
      </div>
      <ul className="mt-2 list-disc space-y-1 pl-4 text-gray-600 dark:text-gray-300">
        <li>Facebook Login for Business configuration ID is connected to the Meta app.</li>
        <li>App has WhatsApp permissions and uses HTTPS in the app domain/login settings.</li>
        <li>Business portfolio admin completes Embedded Signup and selects or creates a WABA.</li>
        <li>Phone number can receive SMS or voice verification and is eligible for Business Platform use.</li>
        <li>Webhook callback is configured for message events and points to Docmee.</li>
      </ul>
      <div className="mt-2">
        <WebhookRow url={webhookUrl} />
      </div>
    </details>
  )
}

function WhatsAppOperatingStandards() {
  const standards = [
    ['Cloud API', 'Use the configured Graph API version for messages, media, templates, and phone metadata.'],
    ['Webhooks', 'Subscribe the app to WhatsApp Business Account message events and verify the callback URL.'],
    ['Error codes', 'Review Meta error codes from failed sends; retry only when the error is transient or rate-limit related.'],
    ['Policy', 'Keep templates, automations, and patient messaging compliant with WhatsApp Business policy enforcement.'],
    ['Rate limits', 'Avoid bursts to the same recipient and respect business quality / throughput limits.'],
    ['Opt-in', 'Only initiate WhatsApp conversations where the clinic has captured valid user opt-in.'],
    ['Changelog', 'Review the Business Platform changelog before changing Graph API versions or message behavior.'],
  ] as const
  return (
    <details className="mt-3 rounded-md border border-gray-200 bg-gray-50 p-3 text-left text-xs dark:border-gray-800 dark:bg-gray-950/60">
      <summary className="cursor-pointer font-semibold text-gray-900 dark:text-gray-50">Advanced sending rules</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {standards.map(([title, body]) => (
          <div key={title} className="rounded-md border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
            <p className="font-medium text-gray-800 dark:text-gray-100">{title}</p>
            <p className="mt-0.5 text-gray-500 dark:text-gray-400">{body}</p>
          </div>
        ))}
      </div>
    </details>
  )
}

function WhatsAppBookingReadiness() {
  const items = [
    ['Dedicated number', 'Use a clinic-owned mobile or landline that can receive SMS or voice verification and is reserved for business messaging.'],
    ['Meta Business', 'Connect the clinic business portfolio/WABA so ownership, billing, verification, and phone assets are managed in Meta.'],
    ['Cloud API path', 'Use WhatsApp Business Platform for Docmee automation, shared inbox, AI assistant replies, reminders, and confirmations.'],
    ['Booking templates', 'Create approved templates for appointment confirmation, reminder, reschedule, cancellation, and follow-up messages.'],
    ['Patient opt-in', 'Capture consent before Docmee initiates WhatsApp reminders or booking confirmations outside an active patient thread.'],
    ['wa.me intake', 'Add a pre-filled booking request link on the website or ads for patient-initiated conversations.'],
  ] as const
  return (
    <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-left text-xs dark:border-emerald-900 dark:bg-emerald-950/30">
      <h4 className="font-semibold text-emerald-900 dark:text-emerald-100">Booking system readiness</h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map(([title, body]) => (
          <div key={title} className="rounded-md bg-white/80 p-2 dark:bg-gray-950/40">
            <p className="font-medium text-gray-800 dark:text-gray-100">{title}</p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">{body}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function WhatsAppCoexistenceReadiness({ webhookUrl }: { webhookUrl: string }) {
  const items = [
    ['Business App stays usable', 'Clinic staff can continue using the WhatsApp Business App after Meta approves the co-existence onboarding.'],
    ['Docmee automation uses Cloud API', 'Docmee receives patient messages through webhooks and can send booking, reminder, handover, and AI replies from the same number.'],
    ['History and echo sync', 'Enable history, smb_app_state_sync, and smb_message_echoes subscriptions so Docmee can understand messages sent from the mobile app.'],
    ['Fallback when ineligible', 'If Meta blocks co-existence for the number, disconnect or migrate the number, wait for Meta refresh, then retry onboarding.'],
  ] as const
  return (
    <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-left text-xs dark:border-teal-900 dark:bg-teal-950/30">
      <h4 className="font-semibold text-teal-900 dark:text-teal-100">Co-existence setup checklist</h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {items.map(([title, body]) => (
          <div key={title} className="rounded-md bg-white/80 p-2 dark:bg-gray-950/40">
            <p className="font-medium text-gray-800 dark:text-gray-100">{title}</p>
            <p className="mt-0.5 text-gray-600 dark:text-gray-300">{body}</p>
          </div>
        ))}
      </div>
      <div className="mt-2">
        <WebhookRow url={webhookUrl} />
      </div>
    </div>
  )
}

function WhatsAppLiveCoexistencePanel({
  readiness,
  loading,
  onRefresh,
}: {
  readiness?: WhatsAppCoexistenceReadinessResponse
  loading: boolean
  onRefresh: () => void
}) {
  const statusStyle = readiness?.overall === 'ready'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100'
    : readiness?.overall === 'blocked'
      ? 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100'
      : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100'
  const label = readiness?.overall === 'ready'
    ? 'Cloud API ready'
    : readiness?.overall === 'blocked'
      ? 'Action needed'
      : 'Needs review'
  return (
    <section className={`mt-3 rounded-md border p-3 text-left text-xs ${statusStyle}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="font-semibold">Live Meta co-existence readiness</h4>
          <p className="mt-0.5 opacity-80">
            {loading ? 'Checking Meta Graph and Docmee channel settings...' : `${label}${readiness?.checkedAt ? `, checked ${readiness.checkedAt.slice(0, 16).replace('T', ' ')}` : ''}`}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-md border border-current px-2 py-1 text-[11px] font-medium opacity-80 hover:opacity-100"
        >
          Refresh
        </button>
      </div>
      {readiness?.meta.phone && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Number', readiness.meta.phone.number ?? readiness.meta.phone.id ?? 'Unknown'],
            ['Platform', readiness.meta.phone.platform ?? 'Unknown'],
            ['Status', readiness.meta.phone.status ?? 'Unknown'],
            ['Quality', readiness.meta.phone.quality ?? 'Unknown'],
          ].map(([title, value]) => (
            <div key={title} className="rounded-md bg-white/70 p-2 dark:bg-gray-950/35">
              <p className="text-[10px] font-medium uppercase opacity-70">{title}</p>
              <p className="mt-0.5 font-semibold">{value}</p>
            </div>
          ))}
        </div>
      )}
      {readiness && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {readiness.checks.map((check) => (
            <div key={check.key} className="rounded-md bg-white/75 p-2 dark:bg-gray-950/35">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{check.label}</p>
                <span
                  className={
                    check.state === 'pass'
                      ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : check.state === 'fail'
                        ? 'rounded-full bg-red-100 px-2 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300'
                        : 'rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                  }
                >
                  {check.state.toUpperCase()}
                </span>
              </div>
              <p className="mt-1 opacity-80">{check.detail}</p>
              {check.state !== 'pass' && <p className="mt-1 font-medium opacity-90">{check.action}</p>}
            </div>
          ))}
        </div>
      )}
      {readiness?.requiredActions.length ? (
        <div className="mt-3 rounded-md bg-white/75 p-2 dark:bg-gray-950/35">
          <p className="font-semibold">Next actions</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {readiness.requiredActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function WhatsAppClinicAutomationScope({ readiness }: { readiness?: WhatsAppCoexistenceReadinessResponse }) {
  const scope = readiness?.recommendedDocmeeScope ?? [
    'Appointment confirmations, reminders, reschedules, cancellations, and follow-up templates.',
    'Shared inbox, AI triage, human handoff, and staff replies.',
    'Clinic-safe patient segments based on booking state and opt-in.',
  ]
  const limitations = readiness?.limitations ?? [
    'Groups, calls, broadcast lists, status, catalog tools, disappearing messages, view-once, and live location stay outside Docmee automation.',
    'Co-existence numbers may have Meta throughput limits.',
  ]
  return (
    <details className="mt-3 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-left text-xs dark:border-cyan-900 dark:bg-cyan-950/30">
      <summary className="cursor-pointer font-semibold text-cyan-950 dark:text-cyan-100">
        Docmee-safe automation scope
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-medium text-gray-800 dark:text-gray-100">Use Docmee for</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-gray-600 dark:text-gray-300">
            {scope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-gray-800 dark:text-gray-100">Keep outside Docmee</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-gray-600 dark:text-gray-300">
            {limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  )
}

function HelpPills({ kind }: { kind: 'whatsapp' | 'meta' }) {
  const [open, setOpen] = useState<'requirements' | 'migration' | null>(null)
  const isWhatsApp = kind === 'whatsapp'
  return (
    <div className="mt-3 text-left">
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === 'requirements' ? null : 'requirements')}
          className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Meta requirements
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === 'migration' ? null : 'migration')}
          className="rounded-full border border-gray-300 px-3 py-1 text-[11px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {isWhatsApp ? 'Number migration guide' : 'Setup guide'}
        </button>
      </div>
      {open && (
        <div className="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-300">
          {open === 'requirements' ? (
            isWhatsApp ? (
              <ul className="list-disc space-y-1 pl-4">
                <li>Meta Business portfolio with admin access.</li>
                <li>WhatsApp Business Account connected to the Meta app.</li>
                <li>Verified business phone number with SMS or voice access.</li>
                <li>Phone number ID, WABA/API access token, webhook callback URL, and verify token.</li>
                <li>Global Meta app secret must be configured on the VPS for signed webhook POSTs.</li>
              </ul>
            ) : (
              <ul className="list-disc space-y-1 pl-4">
                <li>Meta Business portfolio with admin access to the Page/professional account.</li>
                <li>Meta app with Messenger/Instagram permissions configured.</li>
                <li>Page or Instagram account ID, access token, webhook callback URL, and verify token.</li>
                <li>Subscribe the app to messages and delivery/read events for the channel.</li>
              </ul>
            )
          ) : isWhatsApp ? (
            <ol className="list-decimal space-y-1 pl-4">
              <li>If the number is used in personal WhatsApp, plan a migration window or use a new number.</li>
              <li>Move/onboard the number into WhatsApp Business Platform through Meta Business Manager.</li>
              <li>Complete phone verification and copy the phone number ID from WhatsApp API setup.</li>
              <li>Create a long-lived/system-user token with WhatsApp permissions.</li>
              <li>Save the credentials here, then verify the webhook in Meta.</li>
            </ol>
          ) : (
            <ol className="list-decimal space-y-1 pl-4">
              <li>Open Meta Developer settings for the connected app.</li>
              <li>Add the Messenger or Instagram product and connect the Page/account.</li>
              <li>Generate or copy a Page/account access token with message permissions.</li>
              <li>Paste the ID/token/verify token here and save.</li>
              <li>Verify the webhook callback in Meta and subscribe to message events.</li>
            </ol>
          )}
        </div>
      )}
    </div>
  )
}

function WizardShell({
  title,
  recommendedTitle,
  recommendedBody,
  recommendedButton,
  children,
}: {
  title: string
  recommendedTitle: string
  recommendedBody: string
  recommendedButton: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="clinic-card mt-3 bg-gray-50 p-3 text-center dark:bg-gray-950/50">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{title}</h3>
      <div className="clinic-card relative mt-3 p-3">
        <span className="absolute right-3 top-3 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white">
          Recommended
        </span>
        <h4 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-50 sm:mt-2">{recommendedTitle}</h4>
        <p className="mx-auto mt-2 max-w-xl text-xs text-gray-500 dark:text-gray-400">{recommendedBody}</p>
        <div className="mt-3">{recommendedButton}</div>
      </div>
      <div className="my-3 text-xs font-semibold text-gray-500">OR</div>
      <div className="clinic-card p-3 text-left">
        {children}
      </div>
    </div>
  )
}

function MetaChannelWizard({ card, clinic, onSaved }: { card: ServiceCard; clinic: Clinic; onSaved: () => void }) {
  const isMessenger = card.key === 'messenger'
  const settings = clinic.settings as ClinicSettings
  const [idValue, setIdValue] = useState(isMessenger ? (clinic.messengerPageId ?? '') : (clinic.instagramAccountId ?? ''))
  const [token, setToken] = useState('')
  const [verifyToken, setVerifyToken] = useState(
    isMessenger ? (clinic.messengerWebhookVerifyToken ?? '') : (clinic.instagramWebhookVerifyToken ?? ''),
  )
  const [expiresAt, setExpiresAt] = useState(
    isMessenger
      ? (settings.messengerTokenExpiresAt?.slice(0, 10) ?? '')
      : (settings.instagramTokenExpiresAt?.slice(0, 10) ?? ''),
  )
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        settings: {
          ...settings,
          ...(isMessenger ? { messengerTokenExpiresAt: expiresAt || undefined } : { instagramTokenExpiresAt: expiresAt || undefined }),
        },
      }
      if (isMessenger) {
        body.messengerPageId = idValue.trim()
        body.messengerWebhookVerifyToken = verifyToken.trim()
        body.messengerEnabled = true
        if (token.trim()) body.messengerPageAccessToken = token.trim()
      } else {
        body.instagramAccountId = idValue.trim()
        body.instagramWebhookVerifyToken = verifyToken.trim()
        body.instagramEnabled = true
        if (token.trim()) body.instagramPageAccessToken = token.trim()
      }
      return api.patch(`/clinics/${clinic.id}`, body)
    },
    onSuccess: () => {
      setToken('')
      setMessage(`${isMessenger ? 'Facebook' : 'Instagram'} settings saved.`)
      onSaved()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save settings.'),
  })
  const label = isMessenger ? 'Facebook' : 'Instagram'
  const idLabel = isMessenger ? 'Facebook Page ID' : 'Instagram account ID'
  return (
    <WizardShell
      title={`${label} setup`}
      recommendedTitle={`Connect ${label} with Facebook`}
      recommendedBody="Use a Meta admin account for the connected Page or professional account. Embedded signup is the fastest path once the Meta app is configured."
      recommendedButton={
        <button type="button" disabled className="min-h-10 rounded-md bg-teal-600 px-4 py-2 text-xs font-medium text-white opacity-60">
          Continue with Facebook
        </button>
      }
    >
      <h4 className="text-center text-sm font-semibold">More Options (Advanced)</h4>
      <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
        If you already have the Page/account ID, access token, and webhook verify token, save them here.
      </p>
      <HelpPills kind="meta" />
      <div className="mt-3 space-y-2 text-xs">
        {card.webhookUrl && <WebhookRow url={card.webhookUrl} />}
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">{idLabel}</span>
          <input value={idValue} onChange={(e) => setIdValue(e.target.value)} className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" required />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Access token {idValue ? '(leave blank to keep existing)' : ''}</span>
          <input value={token} onChange={(e) => setToken(e.target.value)} type="password" className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Webhook verify token</span>
          <input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} type="password" className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Token expires</span>
          <input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="date" className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" />
        </label>
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className={save.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
            {save.isPending ? 'Saving...' : `Connect ${label}`}
          </button>
        </div>
      </div>
    </WizardShell>
  )
}

function CalendarWizard({ clinic, onSaved }: { clinic: Clinic; onSaved: () => void }) {
  const [message, setMessage] = useState<string | null>(null)
  const disconnect = useMutation({
    mutationFn: () => api.del(`/clinic/${clinic.id}/calendar/disconnect`),
    onSuccess: () => {
      setMessage('Google Calendar disconnected.')
      onSaved()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect calendar.'),
  })
  return (
    <WizardShell
      title="Google Calendar setup"
      recommendedTitle="Connect with Google for booking sync"
      recommendedBody="Authorize the clinic Google account so Docmee can create appointment events and reuse the same consent for Google Sheets export."
      recommendedButton={
        <a href={`${API_BASE}/clinic/${clinic.id}/calendar/auth`} className="inline-flex min-h-10 items-center rounded-md bg-teal-600 px-4 py-2 text-xs font-medium text-white">
          Continue with Google
        </a>
      }
    >
      <h4 className="text-center text-sm font-semibold">More Options (Advanced)</h4>
      <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
        Calendar uses Google OAuth. If the wrong account is connected, disconnect and run the Google connection again.
      </p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <p className={disconnect.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
        <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-60 dark:border-red-900 dark:text-red-300">
          {disconnect.isPending ? 'Disconnecting...' : 'Disconnect calendar'}
        </button>
      </div>
    </WizardShell>
  )
}

function SheetsWizard({ clinic, onSaved }: { clinic: Clinic; onSaved: () => void }) {
  const settings = clinic.settings as ClinicSettings
  const sheets = settings.googleSheets ?? {}
  const [enabled, setEnabled] = useState(Boolean(sheets.enabled))
  const [spreadsheetId, setSpreadsheetId] = useState(sheets.spreadsheetId ?? '')
  const [sheetName, setSheetName] = useState(sheets.sheetName ?? 'Patients')
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api.patch(`/clinics/${clinic.id}`, { settings: { ...settings, googleSheets: { enabled, spreadsheetId: spreadsheetId.trim(), sheetName: sheetName.trim() || 'Patients' } } }),
    onSuccess: () => {
      setMessage('Google Sheets settings saved.')
      onSaved()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save Sheets settings.'),
  })
  return (
    <WizardShell
      title="Google Sheets setup"
      recommendedTitle="Use the connected Google account"
      recommendedBody="Connect Google Calendar first, then choose the spreadsheet where Docmee should sync CRM exports. The same Google authorization includes Sheets access."
      recommendedButton={
        <a href={`${API_BASE}/clinic/${clinic.id}/calendar/auth`} className="inline-flex min-h-10 items-center rounded-md bg-teal-600 px-4 py-2 text-xs font-medium text-white">
          Continue with Google
        </a>
      }
    >
      <h4 className="text-center text-sm font-semibold">More Options (Advanced)</h4>
      <p className="mt-1 text-center text-xs text-gray-500 dark:text-gray-400">
        Already have a spreadsheet? Paste its ID and choose the sheet tab name.
      </p>
      <div className="mt-3 space-y-2 text-xs">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Enable Google Sheets export
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Spreadsheet ID</span>
          <input value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Sheet name</span>
          <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950" />
        </label>
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className={save.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
            {save.isPending ? 'Saving...' : 'Save Sheets setup'}
          </button>
        </div>
      </div>
    </WizardShell>
  )
}

function WebhookRow({ url }: { url: string }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may be unavailable (insecure context); silently no-op.
    }
  }
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[10px] font-medium uppercase text-gray-400">
        {t('studio.channels.webhook')}
      </span>
      <code className="min-w-0 flex-1 truncate rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded border border-gray-300 px-1.5 py-0.5 text-[10px] hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        {copied ? t('studio.channels.copied') : t('studio.channels.copy')}
      </button>
    </div>
  )
}

function WhatsAppCard({
  clinicId,
  account,
  webhookUrl,
  onSaved,
}: {
  clinicId: string
  account: ChannelAccount | null
  webhookUrl: string
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState<'start' | 'prerequisites' | 'number' | 'prepare' | 'credentials'>(
    account?.provider === 'meta_whatsapp' || account ? 'credentials' : 'start',
  )
  const [configOpen, setConfigOpen] = useState(false)
  const [setupMode, setSetupMode] = useState<WhatsAppSetupMode | null>(
    account?.setupMode ?? (account ? 'existing-cloud-api' : null),
  )
  const [prereqs, setPrereqs] = useState<Record<string, boolean>>({
    business: false,
    website: false,
    payment: false,
    policy: false,
    phone: false,
  })
  const [accountId, setAccountId] = useState(account?.accountId ?? '')
  const [wabaId, setWabaId] = useState(account?.wabaId ?? '')
  const [displayName, setDisplayName] = useState(account?.displayName ?? '')
  const [accessToken, setAccessToken] = useState('')
  const [webhookVerifyToken, setWebhookVerifyToken] = useState('')
  const [tokenExpiresAt, setTokenExpiresAt] = useState(account?.tokenExpiresAt?.slice(0, 10) ?? '')
  const [registrationPin, setRegistrationPin] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    setAccountId(account?.accountId ?? '')
    setWabaId(account?.wabaId ?? '')
    setDisplayName(account?.displayName ?? '')
    setTokenExpiresAt(account?.tokenExpiresAt?.slice(0, 10) ?? '')
    setSetupMode(account?.setupMode ?? (account ? 'existing-cloud-api' : null))
    setRegistrationPin('')
  }, [account?.id, account?.accountId, account?.wabaId, account?.displayName, account?.tokenExpiresAt, account?.setupMode])
  const metaConfigQuery = useQuery({
    queryKey: ['meta-embedded-signup-config'],
    queryFn: () => api.get<MetaEmbeddedSignupConfig>('/channels/meta-config'),
  })
  const coexistenceReadinessQuery = useQuery({
    queryKey: ['whatsapp-coexistence-readiness', clinicId, account?.id, account?.updatedAt],
    enabled: Boolean(clinicId),
    queryFn: () =>
      api.get<WhatsAppCoexistenceReadinessResponse>(
        `/clinics/${clinicId}/channels/whatsapp/coexistence-readiness`,
      ),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.put<{ account: ChannelAccount }>(`/clinics/${clinicId}/channels/whatsapp`, {
        accountId: accountId.trim(),
        wabaId: wabaId.trim() || undefined,
        displayName: displayName.trim() || undefined,
        accessToken: accessToken.trim() || undefined,
        webhookVerifyToken: webhookVerifyToken.trim() || undefined,
        tokenExpiresAt: tokenExpiresAt || undefined,
        setupMode: setupMode ?? 'existing-cloud-api',
        status: 'active',
      }),
    onSuccess: (data) => {
      setAccessToken('')
      setWebhookVerifyToken('')
      setAccountId(data.account.accountId)
      setWabaId(data.account.wabaId ?? '')
      setDisplayName(data.account.displayName ?? '')
      setTokenExpiresAt(data.account.tokenExpiresAt?.slice(0, 10) ?? '')
      setSetupMode(data.account.setupMode ?? 'existing-cloud-api')
      setMessage('WhatsApp account saved.')
      setStep('credentials')
      onSaved()
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : 'Could not save WhatsApp account.')
    },
  })
  const embeddedSignup = useMutation({
    mutationFn: (payload: { code: string; phoneNumberId: string; wabaId?: string; setupMode: WhatsAppSetupMode }) =>
      api.post<{ account: ChannelAccount }>(`/clinics/${clinicId}/channels/whatsapp/embedded-signup`, {
        ...payload,
        displayName: displayName.trim() || undefined,
        webhookVerifyToken: webhookVerifyToken.trim() || undefined,
      }),
    onSuccess: (data) => {
      setAccountId(data.account.accountId)
      setWabaId(data.account.wabaId ?? '')
      setDisplayName(data.account.displayName ?? '')
      setAccessToken('')
      setWebhookVerifyToken('')
      setTokenExpiresAt(data.account.tokenExpiresAt?.slice(0, 10) ?? '')
      setSetupMode(data.account.setupMode ?? 'existing-cloud-api')
      setMessage('WhatsApp number linked through Facebook.')
      setStep('credentials')
      onSaved()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not finish Facebook signup.'),
  })
  const disconnectWhatsApp = useMutation({
    mutationFn: () => {
      if (!account?.id) throw new Error('No WhatsApp account is connected.')
      return api.del(`/clinics/${clinicId}/channels/whatsapp/${account.id}`)
    },
    onSuccess: () => {
      setAccountId('')
      setWabaId('')
      setDisplayName('')
      setAccessToken('')
      setWebhookVerifyToken('')
      setTokenExpiresAt('')
      setSetupMode(null)
      setMessage('WhatsApp account disconnected. You can connect another account now.')
      setStep('start')
      setConfigOpen(true)
      onSaved()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect WhatsApp.'),
  })
  const registerPhone = useMutation({
    mutationFn: () => {
      if (!account?.id) throw new Error('Save the Meta WhatsApp account before registering its phone number.')
      return api.post<{ ok: true; phoneNumberId: string; message: string }>(
        `/clinics/${clinicId}/channels/whatsapp/${account.id}/register`,
        { pin: registrationPin },
      )
    },
    onSuccess: (data) => {
      setMessage(data.message)
      coexistenceReadinessQuery.refetch()
      onSaved()
    },
    onError: (error) => {
      const base = error instanceof Error ? error.message : 'Meta could not register the phone number.'
      const details = error instanceof Error ? (error as Error & { details?: unknown }).details : undefined
      const action = details && typeof details === 'object' && typeof (details as { action?: unknown }).action === 'string'
        ? (details as { action: string }).action
        : null
      setMessage(action ? `${base} ${action}` : base)
    },
    // The PIN is needed only for this request. Never retain it after an attempt.
    onSettled: () => setRegistrationPin(''),
  })

  const status: ServiceStatus = account?.status === 'active' ? 'connected' : account ? 'pending' : 'disconnected'
  const canContinue = Boolean(setupMode)
  const needsPrep = setupMode === 'new-number' || setupMode === 'migrate-business-app'
  const prereqItems = [
    ['business', 'Legally registered business', 'The clinic should have a business name/address that can match Meta Business verification.'],
    ['website', 'Valid website with privacy policy', 'Meta commonly checks for a public website and data/privacy policy for business messaging.'],
    ['payment', 'Valid payment method', 'Add a debit/credit card in Meta Business Manager for WhatsApp conversations and verification.'],
    ['policy', 'Compliant WhatsApp use case', 'Healthcare messaging must follow WhatsApp Business, commerce, and patient-consent rules.'],
    ['phone', 'Phone can receive SMS or call', 'The number must not have active WhatsApp sessions when Meta asks to verify or migrate it.'],
  ] as const
  const allPrereqsReady = prereqItems.every(([id]) => prereqs[id])
  const setAllPrereqs = (checked: boolean) =>
    setPrereqs(Object.fromEntries(prereqItems.map(([id]) => [id, checked])) as Record<string, boolean>)
  async function continueWithFacebook(modeOverride?: WhatsAppSetupMode) {
    const selectedSetupMode = modeOverride ?? setupMode ?? 'migrate-business-app'
    setSetupMode(selectedSetupMode)
    const config = metaConfigQuery.data
    if (!config?.isConfigured || !config.appId || !config.configId) {
      const missing = config?.missing?.length ? ` Missing: ${config.missing.join(', ')}.` : ''
      setMessage(`Meta Embedded Signup is not configured yet.${missing}`)
      setStep('number')
      return
    }

    setMessage(
      selectedSetupMode === 'migrate-business-app'
        ? 'Opening Facebook co-existence setup...'
        : 'Opening Facebook setup...',
    )
    try {
      await loadFacebookSdk(config.appId, config.graphApiVersion)
      if (!window.FB) {
        setMessage('Facebook SDK did not finish loading. Refresh this page and try again.')
        return
      }
      const assets: EmbeddedSignupAssets = {}
      let resolveAssets: (value: EmbeddedSignupAssets) => void = () => undefined
      const assetsReady = new Promise<EmbeddedSignupAssets>((resolve) => {
        resolveAssets = resolve
      })
      const timeout = window.setTimeout(() => resolveAssets(assets), 5000)
      const listener = (event: MessageEvent) => {
        const parsed = parseEmbeddedSignupMessage(event)
        if (!parsed) return
        if (parsed.event === 'ERROR') {
          window.clearTimeout(timeout)
          resolveAssets({ event: 'ERROR', errorMessage: parsed.errorMessage ?? 'Meta Embedded Signup returned an error.' })
          return
        }
        if (parsed.event === 'CANCEL') {
          window.clearTimeout(timeout)
          resolveAssets({ event: 'CANCEL' })
          return
        }
        if (
          parsed.event &&
          parsed.event !== 'FINISH' &&
          parsed.event !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING'
        ) {
          return
        }
        Object.assign(assets, parsed)
        if (assets.phoneNumberId) {
          window.clearTimeout(timeout)
          resolveAssets(assets)
        }
      }
      window.addEventListener('message', listener)
      window.FB?.login(
        async (response) => {
          window.removeEventListener('message', listener)
          const code = response.authResponse?.code
          const returnedAssets = assets.phoneNumberId ? assets : await assetsReady
          if (!code) {
            setMessage('Facebook setup was cancelled before authorization finished.')
            return
          }
          if (returnedAssets.event === 'ERROR') {
            setMessage(returnedAssets.errorMessage ?? 'Meta Embedded Signup returned an error.')
            setStep('prepare')
            return
          }
          if (returnedAssets.event === 'CANCEL') {
            setMessage('Facebook setup was cancelled. You can try again or use Cloud API setup.')
            setStep('number')
            return
          }
          if (!returnedAssets.phoneNumberId) {
            setMessage('Facebook returned authorization, but no WhatsApp phone number ID. Try again after selecting a number.')
            setStep('prepare')
            return
          }
          embeddedSignup.mutate({
            code,
            phoneNumberId: returnedAssets.phoneNumberId,
            wabaId: returnedAssets.wabaId,
            setupMode: selectedSetupMode,
          })
        },
        {
          config_id: config.configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            sessionInfoVersion: '3',
            ...(selectedSetupMode === 'migrate-business-app'
              ? { featureType: 'whatsapp_business_app_onboarding' }
              : {}),
            setup: {},
          },
        },
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start Facebook setup.')
    }
  }

  if (step === 'start') {
    return (
      <div className="clinic-card col-span-1 p-5 sm:col-span-2">
        <div className="flex items-start gap-2.5">
          <ServiceTile svc="whatsapp" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{t('studio.channels.svc.whatsapp')}</p>
            <p className="truncate text-xs text-gray-400">Guided setup for patient WhatsApp messages</p>
          </div>
          <StatusBadge status={status} />
          <button
            type="button"
            onClick={() => setConfigOpen((value) => !value)}
            aria-expanded={configOpen}
            className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {configOpen ? 'Hide configuration' : 'Show configuration'}
          </button>
        </div>
        {configOpen && (
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950">
            <BrandIcon name="whatsapp" className="h-10 w-10" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50">Connect the clinic WhatsApp number</h2>
          <p className="mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Use the Facebook guided setup when possible. If Meta already gave you the phone number ID and access token,
            use the manual setup form below.
          </p>

          <div className="clinic-card relative mt-6 w-full bg-gray-50 p-5 dark:bg-gray-950/60">
            <span className="absolute right-5 top-4 rounded-full bg-green-600 px-3 py-1 text-xs font-medium text-white">
              Recommended
            </span>
            <h3 className="mt-8 text-base font-semibold text-gray-900 dark:text-gray-50 sm:mt-4">
              Guided Facebook setup
            </h3>
            <div className="mx-auto mt-3 flex max-w-xl items-start gap-3 text-left text-sm text-gray-500 dark:text-gray-400">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-300">
                ?
              </span>
              <p>
                <strong className="text-gray-800 dark:text-gray-100">Recommended:</strong> sign in with the clinic Meta Business admin account.
                Docmee will guide the number connection and fill the Meta details when Meta returns them.
              </p>
            </div>
            <button
              type="button"
              onClick={() => continueWithFacebook('migrate-business-app')}
              disabled={embeddedSignup.isPending}
              className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-bold text-blue-600">f</span>
              {embeddedSignup.isPending ? 'Opening...' : 'Connect with Facebook'}
            </button>
            <p className="mt-2 text-[11px] text-gray-400">
              {metaConfigQuery.data?.isConfigured
                ? 'Opens Facebook setup for the clinic WhatsApp Business number.'
                : 'Facebook guided setup is not ready yet. Use manual setup if you already have Meta values.'}
            </p>
            {message && <p className={message.includes('missing') || message.includes('cancelled') ? 'mt-2 text-xs text-amber-600' : 'mt-2 text-xs text-emerald-600'}>{message}</p>}
            <HelpPills kind="whatsapp" />
            <MetaStandardChecklist webhookUrl={webhookUrl} configured={metaConfigQuery.data?.isConfigured} />
            <WhatsAppBookingReadiness />
            <WhatsAppOperatingStandards />
          </div>

          <div className="my-4 text-sm font-semibold text-gray-700 dark:text-gray-300">OR</div>

          <div className="clinic-card w-full p-5">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Manual setup with Meta values</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm text-gray-500 dark:text-gray-400">
              Use this if you already have the real Meta WhatsApp Phone Number ID, access token, and webhook verify token.
            </p>
            <HelpPills kind="whatsapp" />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setSetupMode('existing-cloud-api')
                  setStep('credentials')
                }}
                className="min-h-11 rounded-md border border-blue-500 px-5 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                Enter Meta values
              </button>
              <button
                type="button"
                onClick={() => setStep('number')}
                className="min-h-11 rounded-md border border-gray-300 px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                Help me choose setup path
              </button>
            </div>
          </div>
        </div>
        )}
      </div>
    )
  }

  return (
    <form
      className="clinic-card flex flex-col p-3 sm:col-span-2"
      onSubmit={(event) => {
        event.preventDefault()
        setMessage(null)
        mutation.mutate()
      }}
    >
      <div className="flex items-start gap-2.5">
        <ServiceTile svc="whatsapp" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{t('studio.channels.svc.whatsapp')}</p>
          <p className="truncate text-xs text-gray-400">Guided setup for patient WhatsApp messages</p>
        </div>
        <StatusBadge status={status} />
        <button
          type="button"
          onClick={() => setConfigOpen((value) => !value)}
          aria-expanded={configOpen}
          className="inline-flex min-h-9 shrink-0 items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {configOpen ? 'Hide configuration' : 'Show configuration'}
        </button>
      </div>

      {configOpen && (
      <>
      <div className="mt-3 grid grid-cols-2 gap-1 text-[10px] font-medium sm:grid-cols-6">
        {[
          ['prerequisites', '1. Ready'],
          ['number', '2. Number'],
          ['prepare', '3. Meta'],
          ['credentials', '4. Save values'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStep(id as 'prerequisites' | 'number' | 'prepare' | 'credentials')}
            className={
              step === id
                ? 'rounded-md bg-emerald-600 px-2 py-1 text-white'
                : 'rounded-md bg-gray-100 px-2 py-1 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {step === 'prerequisites' && (
        <div className="mt-3 grid gap-4 text-xs md:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)]">
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-gray-900 dark:text-gray-50">Before connecting WhatsApp</h3>
              <label className="flex items-center gap-2 text-[11px] font-medium text-gray-500">
                <input
                  type="checkbox"
                  checked={allPrereqsReady}
                  onChange={(event) => setAllPrereqs(event.target.checked)}
                />
                Select all
              </label>
            </div>
            <div className="space-y-2">
              {prereqItems.map(([id, title, desc]) => (
                <label
                  key={id}
                  className={
                    prereqs[id]
                      ? 'block rounded-md border border-emerald-300 bg-emerald-50 p-2 dark:border-emerald-900 dark:bg-emerald-950/30'
                      : 'block rounded-md border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50'
                  }
                >
                  <span className="flex gap-2">
                    <input
                      type="checkbox"
                      checked={prereqs[id]}
                      onChange={(event) => setPrereqs((current) => ({ ...current, [id]: event.target.checked }))}
                    />
                    <span>
                      <span className="block font-medium text-gray-800 dark:text-gray-100">{title}</span>
                      <span className="block text-gray-500 dark:text-gray-400">{desc}</span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('start')}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!allPrereqsReady}
                onClick={() => setStep('number')}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Proceed
              </button>
            </div>
          </div>
          <div className="clinic-card bg-gray-50 p-4 text-center dark:bg-gray-950/50">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-white text-2xl shadow-sm dark:border-gray-800 dark:bg-gray-900">
              ?
            </div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50">Let Docmee guide the setup</h4>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              Check the items you already have. Docmee will guide the rest step by step.
            </p>
            <button
              type="button"
              onClick={() => setStep('number')}
              className="mt-4 rounded-full bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700"
            >
              WhatsApp now
            </button>
          </div>
        </div>
      )}

      {step === 'number' && (
        <div className="mt-3 space-y-2 text-xs">
          <div className="clinic-card bg-gray-50 p-4 text-center dark:bg-gray-950/50">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-50">Choose the WhatsApp number</h3>
            <div className="clinic-card relative mt-4 p-4">
              <span className="absolute right-4 top-3 rounded-full bg-green-600 px-2 py-0.5 text-[10px] font-medium text-white">
                Recommended
              </span>
              <h4 className="mt-6 text-sm font-semibold text-gray-900 dark:text-gray-50 sm:mt-2">
                Connect with Facebook for the fastest setup
              </h4>
              <p className="mx-auto mt-2 max-w-xl text-xs text-gray-500 dark:text-gray-400">
                Use an admin role on the clinic Facebook page or Meta Business portfolio. Docmee will guide the steps now; real Meta login can be attached later.
              </p>
              <button
                type="button"
                onClick={() => continueWithFacebook(setupMode ?? 'migrate-business-app')}
                disabled={embeddedSignup.isPending}
                className="mt-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-blue-600 px-5 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-bold text-blue-600">f</span>
                {embeddedSignup.isPending ? 'Opening...' : setupMode === 'migrate-business-app' ? 'Start co-existence' : 'Continue with Facebook'}
              </button>
            </div>
            <div className="my-3 text-xs font-semibold text-gray-500">OR</div>
            <div className="clinic-card p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-50">More Options (Advanced)</h4>
              <p className="mx-auto mt-1 max-w-xl text-xs text-gray-500 dark:text-gray-400">
                If a developer already prepared the Meta details, connect directly here.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSetupMode('existing-cloud-api')
                  setStep('credentials')
                }}
                className="mt-3 rounded-md border border-blue-500 px-4 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950/40"
              >
                Connect using Cloud API
              </button>
            </div>
            <MetaStandardChecklist webhookUrl={webhookUrl} configured={metaConfigQuery.data?.isConfigured} />
            <WhatsAppLiveCoexistencePanel
              readiness={coexistenceReadinessQuery.data}
              loading={coexistenceReadinessQuery.isLoading || coexistenceReadinessQuery.isFetching}
              onRefresh={() => coexistenceReadinessQuery.refetch()}
            />
            <WhatsAppClinicAutomationScope readiness={coexistenceReadinessQuery.data} />
          </div>
          <p className="pt-2 text-gray-500 dark:text-gray-400">
            Choose the onboarding path that matches the clinic's current WhatsApp number.
          </p>
          {[
            ['new-number', 'Use a new WhatsApp number', 'Best when the clinic can dedicate a fresh number to Docmee and avoid changing an existing WhatsApp workflow.'],
            ['migrate-business-app', 'Co-exist with an existing WhatsApp Business App number', 'Use Meta WhatsApp Coexistence when the clinic wants to keep using the Business App while Docmee uses Cloud API automation. If Meta says the number is not eligible, migration or disconnect may still be required.'],
            ['existing-cloud-api', 'Connect an existing Meta Cloud API / WABA number', 'Use this when the clinic already has a WABA, phone number ID, access token, and webhook verify token.'],
          ].map(([id, title, desc]) => (
            <label
              key={id}
              className={
                setupMode === id
                  ? 'block rounded-md border border-emerald-400 bg-emerald-50 p-2 dark:border-emerald-800 dark:bg-emerald-950/30'
                  : 'block rounded-md border border-gray-200 p-2 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50'
              }
            >
              <span className="flex gap-2">
                <input
                  type="radio"
                  name="wa-number-type"
                  checked={setupMode === id}
                  onChange={() => setSetupMode(id as WhatsAppSetupMode)}
                />
                <span>
                  <span className="block font-medium text-gray-800 dark:text-gray-100">{title}</span>
                  <span className="block text-gray-500 dark:text-gray-400">{desc}</span>
                </span>
              </span>
            </label>
          ))}
          {setupMode === 'migrate-business-app' && <WhatsAppCoexistenceReadiness webhookUrl={webhookUrl} />}
            <button
              type="button"
              onClick={() => setStep('prerequisites')}
              className="mt-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              disabled={!canContinue}
              onClick={() => setStep(needsPrep ? 'prepare' : 'credentials')}
              className="ml-2 mt-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              Continue
            </button>
        </div>
      )}

      {step === 'prepare' && (
        <div className="mt-3 space-y-2 text-xs text-gray-600 dark:text-gray-300">
          {setupMode === 'migrate-business-app' && (
            <div className="rounded-md border border-teal-300 bg-teal-50 p-2 text-teal-800 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
              Preferred path: connect the existing WhatsApp Business App number with Meta Coexistence so the clinic can keep the mobile app while Docmee uses Cloud API automation. If Meta marks the number as ineligible, use Meta's migration/disconnect guidance and retry after the number refreshes.
            </div>
          )}
          {setupMode === 'migrate-business-app' && <WhatsAppCoexistenceReadiness webhookUrl={webhookUrl} />}
          {setupMode === 'new-number' && (
            <div className="rounded-md border border-emerald-300 bg-emerald-50 p-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
              Add a fresh phone number in Meta Business Manager, verify it by SMS or call, then use its phone number ID below. This avoids interrupting the existing clinic WhatsApp app.
            </div>
          )}
          <ol className="list-decimal space-y-1 pl-4">
            <li>Create or open the clinic's Meta Business portfolio.</li>
            <li>Add WhatsApp to a Meta app and create/select a WhatsApp Business Account.</li>
            <li>
              {setupMode === 'migrate-business-app'
                ? 'Choose the WhatsApp Business App / Coexistence option during Embedded Signup when Meta offers it.'
                : 'Add the clinic phone number and complete Meta phone verification.'}
            </li>
            <li>Copy the phone number ID from WhatsApp API Setup.</li>
            <li>Create a long-lived/system-user access token with WhatsApp permissions.</li>
            <li>Set the callback URL to the webhook shown below and use the verify token you save here.</li>
          </ol>
          <WebhookRow url={webhookUrl} />
          <MetaStandardChecklist webhookUrl={webhookUrl} configured={metaConfigQuery.data?.isConfigured} />
          <WhatsAppLiveCoexistencePanel
            readiness={coexistenceReadinessQuery.data}
            loading={coexistenceReadinessQuery.isLoading || coexistenceReadinessQuery.isFetching}
            onRefresh={() => coexistenceReadinessQuery.refetch()}
          />
          <WhatsAppClinicAutomationScope readiness={coexistenceReadinessQuery.data} />
          <WhatsAppBookingReadiness />
          <WhatsAppOperatingStandards />
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => setStep('start')}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep('credentials')}
              className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              I have the Meta credentials
            </button>
          </div>
        </div>
      )}
      {step === 'credentials' && (
        <div className="mt-2.5 space-y-2 text-xs">
          {account ? (
            <div className="rounded-md bg-emerald-50 p-2 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Connected phone ID {account.accountId}. WABA ID {account.wabaId ? account.wabaId : 'missing'}. Token {account.hasAccessToken ? 'stored' : 'missing'}.
            </div>
          ) : (
            <div className="rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Save the Meta Cloud API credentials to activate WhatsApp for this clinic.
            </div>
          )}
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
            <p className="font-semibold">What to paste from Meta</p>
            <ol className="mt-1 list-decimal space-y-1 pl-4">
              <li>Phone Number ID from WhatsApp Manager or Meta Developer WhatsApp API setup.</li>
              <li>WABA ID from WhatsApp Manager / Business settings so Docmee can verify the phone belongs to the stored WABA.</li>
              <li>Permanent or system-user access token for the business app.</li>
              <li>A webhook verify token you choose here and paste into Meta webhooks.</li>
              <li>Optional token expiry date so Docmee can warn you before renewal.</li>
            </ol>
          </div>
          <WebhookRow url={webhookUrl} />
          <WhatsAppLiveCoexistencePanel
            readiness={coexistenceReadinessQuery.data}
            loading={coexistenceReadinessQuery.isLoading || coexistenceReadinessQuery.isFetching}
            onRefresh={() => coexistenceReadinessQuery.refetch()}
          />
          {account && (
            <div className="rounded-md border border-purple-200 bg-purple-50 p-3 text-purple-950 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-100">
              <p className="font-semibold">Register this phone with Meta Cloud API</p>
              <p className="mt-1 text-[11px] text-purple-800 dark:text-purple-200">
                Enter the six-digit two-step verification PIN configured for this phone number. Docmee sends it directly to Meta and does not store it.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className="min-w-48 flex-1">
                  <span className="mb-1 block font-medium">Six-digit PIN</span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={registrationPin}
                    onChange={(event) => setRegistrationPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-md border border-purple-300 bg-white px-2 py-1.5 text-sm text-gray-950 dark:border-purple-800 dark:bg-gray-950 dark:text-gray-50"
                    aria-label="Meta phone registration PIN"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null)
                    registerPhone.mutate()
                  }}
                  disabled={!/^\d{6}$/.test(registrationPin) || registerPhone.isPending}
                  className="rounded-md bg-purple-700 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                >
                  {registerPhone.isPending ? 'Registering...' : 'Register phone'}
                </button>
              </div>
            </div>
          )}
          <WhatsAppBookingReadiness />
          <WhatsAppClinicAutomationScope readiness={coexistenceReadinessQuery.data} />
          <WhatsAppOperatingStandards />

          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Meta WhatsApp Phone Number ID</span>
            <input
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="1234567890"
              required
            />
            <span className="mt-1 block text-[11px] text-gray-400">Find this in Meta WhatsApp Manager or Developers &gt; WhatsApp &gt; API setup.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Meta WABA ID</span>
            <input
              value={wabaId}
              onChange={(event) => setWabaId(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="1757229692360293"
            />
            <span className="mt-1 block text-[11px] text-gray-400">Required to verify ownership before registering the phone. Leave unchanged to keep the stored WABA ID.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Display name for staff</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="Clinic WhatsApp"
            />
            <span className="mt-1 block text-[11px] text-gray-400">This is the label Docmee staff will see; it does not change the approved Meta display name.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
              Meta access token {account?.hasAccessToken ? '(leave blank to keep existing)' : ''}
            </span>
            <input
              value={accessToken}
              onChange={(event) => setAccessToken(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder="EAAB..."
              type="password"
              required={!account?.hasAccessToken}
            />
            <span className="mt-1 block text-[11px] text-gray-400">Use a production token from the Meta business app or system user. Docmee stores it securely and masks it after saving.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Webhook verify token</span>
            <input
              value={webhookVerifyToken}
              onChange={(event) => setWebhookVerifyToken(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              placeholder={account?.hasWebhookVerifyToken ? 'Stored' : 'Create a random phrase and paste it in Meta'}
              type="password"
            />
            <span className="mt-1 block text-[11px] text-gray-400">Create a simple secret phrase here, save it, then paste the same phrase in Meta Webhooks &gt; Verify token.</span>
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Token expires on</span>
            <input
              value={tokenExpiresAt}
              onChange={(event) => setTokenExpiresAt(event.target.value)}
              className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
              type="date"
            />
            <span className="mt-1 block text-[11px] text-gray-400">Optional, but recommended. It helps Docmee warn before a token must be rotated.</span>
          </label>

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-800">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStep('start')}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs dark:border-gray-700"
              >
                Back
              </button>
              {account ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm('Disconnect this WhatsApp account from Docmee? You can connect another account after disconnecting.')) {
                      setMessage(null)
                      disconnectWhatsApp.mutate()
                    }
                  }}
                  disabled={disconnectWhatsApp.isPending}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                >
                  {disconnectWhatsApp.isPending ? 'Disconnecting...' : 'Disconnect WhatsApp'}
                </button>
              ) : null}
            </div>
            <p className={mutation.isError || disconnectWhatsApp.isError || registerPhone.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
            <button
              type="submit"
              disabled={mutation.isPending || disconnectWhatsApp.isPending}
              className="shrink-0 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
            >
              {mutation.isPending ? 'Saving...' : account ? 'Update' : 'Connect'}
            </button>
          </div>
        </div>
      )}
      </>
      )}
    </form>
  )
}
