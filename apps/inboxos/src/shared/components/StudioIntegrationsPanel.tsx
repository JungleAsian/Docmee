'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE } from '@/shared/api/client'
import { BrandIcon, type BrandIconName } from '@/shared/components/BrandIcon'
import { PillToggle } from '@/shared/components/PillToggle'
import { useAuthStore } from '@/shared/store/auth'
import type { Clinic } from '@/shared/types'

type IntegrationStatus = 'connected' | 'pending' | 'disconnected'
type GoogleSheetsSettings = { enabled?: boolean; spreadsheetId?: string; sheetName?: string }
type EmailDeliveryProvider = 'google' | 'outlook' | 'other'
type EmailDeliverySettings = {
  enabled?: boolean
  provider?: EmailDeliveryProvider
  fromName?: string
  fromEmail?: string
  replyTo?: string
  smtpHost?: string
  smtpPort?: number
  smtpSecure?: boolean
  smtpUser?: string
  smtpPasswordSet?: boolean
  notes?: string
  lastTestAt?: string
  lastTestTo?: string
}
type ExternalIntegration = {
  enabled?: boolean
  webhookUrl?: string
  model?: string
  notes?: string
}
type IntegrationSettings = {
  googleCalendar?: unknown
  googleSheets?: GoogleSheetsSettings
  emailDelivery?: EmailDeliverySettings
  aiAssistant?: {
    chatProvider?: AiProvider
    embedProvider?: 'openai' | 'gemini' | 'custom'
    model?: string
    baseURL?: string
  }
  integrations?: {
    n8n?: ExternalIntegration
    chatgpt?: ExternalIntegration
    claude?: ExternalIntegration
  }
}

const field =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950'

function Toggle({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return <PillToggle checked={on} disabled={disabled} label={label} onChange={onChange} />
}

function StatusPill({ status }: { status: IntegrationStatus }) {
  const classes: Record<IntegrationStatus, string> = {
    connected: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300',
    pending: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300',
    disconnected: 'border-gray-300 bg-gray-50 text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400',
  }
  const label: Record<IntegrationStatus, string> = {
    connected: 'Ready',
    pending: 'Needs setup',
    disconnected: 'Off',
  }
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${classes[status]}`}>{label[status]}</span>
}

function MiniGuide({ needs, steps }: { needs?: string[]; steps?: string[] }) {
  if (!needs?.length && !steps?.length) return null
  return (
    <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
      {needs?.length ? (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/60">
          <p className="font-semibold text-gray-800 dark:text-gray-100">What you need</p>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-gray-600 dark:text-gray-300">
            {needs.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {steps?.length ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="font-semibold text-emerald-900 dark:text-emerald-100">Setup steps</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-emerald-900/85 dark:text-emerald-100/85">
            {steps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  )
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-[11px] leading-4 text-gray-400">{children}</span>
}

function IntegrationCard({
  title,
  subtitle,
  status,
  icon,
  needs,
  steps,
  children,
}: {
  title: string
  subtitle: string
  status: IntegrationStatus
  icon?: BrandIconName
  needs?: string[]
  steps?: string[]
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <section className="clinic-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon ? <BrandIcon name={icon} /> : null}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{title}</h2>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill status={status} />
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="inline-flex min-h-9 items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {open ? 'Hide configuration' : 'Show configuration'}
          </button>
        </div>
      </div>
      {open ? (
        <>
          <MiniGuide needs={needs} steps={steps} />
          <div className="mt-4">{children}</div>
        </>
      ) : null}
    </section>
  )
}

function IntegrationGroupBanner({
  icon,
  title,
  description,
}: {
  icon: BrandIconName
  title: string
  description: string
}) {
  return (
    <section className="clinic-card border-sky-200 bg-sky-50/70 p-4 dark:border-sky-900 dark:bg-sky-950/20">
      <div className="flex items-start gap-3">
        <BrandIcon name={icon} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-sky-950 dark:text-sky-100">{title}</h2>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-sky-900/80 dark:text-sky-100/80">{description}</p>
        </div>
      </div>
    </section>
  )
}

type AiProvider = 'claude' | 'openai' | 'gemini' | 'custom'
type AiProviderStatus = {
  provider: AiProvider
  connected: boolean
  source: 'clinic' | 'none'
  last4: string | null
  validatedAt: string | null
}

type ProviderReadiness = {
  key: 'meta' | 'google' | 'email' | 'openai' | 'anthropic'
  configured: boolean
  state: 'ready' | 'missing' | 'fallback' | 'waived'
  missing: string[]
  action?: string
}

const DEFAULT_MODEL: Record<AiProvider, string> = {
  claude: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  custom: '',
}

const PROVIDER_META: Record<AiProvider, { subtitle: string; keyLabel: string; placeholder: string; action: string }> = {
  claude: {
    subtitle: 'Connect the clinic Claude account for Docmee answers.',
    keyLabel: 'Anthropic API key',
    placeholder: 'sk-ant-...',
    action: 'Connect Claude',
  },
  openai: {
    subtitle: 'Connect the clinic ChatGPT/OpenAI account for Docmee answers.',
    keyLabel: 'OpenAI API key',
    placeholder: 'sk-...',
    action: 'Connect ChatGPT',
  },
  gemini: {
    subtitle: 'Connect the clinic Gemini account for Docmee answers.',
    keyLabel: 'Gemini API key',
    placeholder: 'AIza...',
    action: 'Connect Gemini',
  },
  custom: {
    subtitle: 'Connect any OpenAI-compatible AI endpoint for Docmee.',
    keyLabel: 'API key',
    placeholder: 'your endpoint key',
    action: 'Connect custom AI',
  },
}

const PROVIDER_ICON: Record<AiProvider, BrandIconName> = {
  claude: 'claude',
  openai: 'chatgpt',
  gemini: 'gemini',
  custom: 'customAi',
}

const PROVIDER_CONSOLE_URL: Partial<Record<AiProvider, string>> = {
  claude: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/app/apikey',
}

const EMBEDDING_PROVIDERS: AiProvider[] = ['openai', 'gemini', 'custom']

function embeddingProviderFor(provider: AiProvider): AiProvider | null {
  return EMBEDDING_PROVIDERS.includes(provider) ? provider : null
}

function connectedEmbeddingProvider(statuses: AiProviderStatus[], current?: string): AiProvider | null {
  const currentProvider = EMBEDDING_PROVIDERS.find((provider) => provider === current)
  if (currentProvider && statuses.some((status) => status.provider === currentProvider && status.connected)) {
    return currentProvider
  }
  return EMBEDDING_PROVIDERS.find((provider) =>
    statuses.some((status) => status.provider === provider && status.connected),
  ) ?? null
}

export function StudioIntegrationsPanel({ clinic }: { clinic: Clinic }) {
  const settings = (clinic.settings ?? {}) as IntegrationSettings
  const calendarConnected = Boolean(settings.googleCalendar)
  const sheets = settings.googleSheets ?? {}
  const emailDelivery = settings.emailDelivery ?? {}
  const n8n = settings.integrations?.n8n ?? {}
  const providerStatus = useQuery({
    queryKey: ['provider-status', clinic.id],
    queryFn: () => api.get<{ providers: ProviderReadiness[] }>('/provider-status'),
  })
  const emailProvider = providerStatus.data?.providers.find((provider) => provider.key === 'email') ?? null

  return (
    <div className="space-y-4">
      <IntegrationGroupBanner
        icon="google"
        title="Google workspace sync"
        description="Connect calendar and spreadsheet tools used by the clinic for appointment scheduling and operational exports."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <CalendarIntegration clinic={clinic} connected={calendarConnected} />
        <SheetsIntegration clinic={clinic} connected={calendarConnected} sheets={sheets} />
      </div>

      <IntegrationGroupBanner
        icon="email"
        title="Patient and clinic notifications"
        description="Configure outbound email delivery and reply handling for appointment alerts, reports, and clinic communication."
      />
      <EmailDeliveryIntegration clinic={clinic} config={emailDelivery} provider={emailProvider} loading={providerStatus.isLoading} />

      <IntegrationGroupBanner
        icon="n8n"
        title="Automation webhooks"
        description="Send Docmee events to external workflow automation tools when the clinic needs custom operations outside the app."
      />
      <N8nIntegration clinic={clinic} config={n8n} />
    </div>
  )
}

// Items 3/9/16 of the 25-item batch: J.zel AI provider connections moved out to
// their own Studio → AI Settings page (was previously rendered inline at the
// bottom of StudioIntegrationsPanel). Exported so that page can render it
// directly — it reuses this file's shared IntegrationCard/IntegrationGroupBanner
// plumbing and the ProviderLoginCard below, so it stays colocated here rather
// than duplicating that machinery in a second file.
export function AiProvidersPanel({ clinic }: { clinic: Clinic }) {
  const jzelConfigLocked = useAuthStore((s) => s.user?.jzelEnabled === false)
  const aiStatus = useQuery({
    queryKey: ['ai-status', clinic.id],
    queryFn: () => api.get<{ providers: AiProviderStatus[] }>(`/clinic/${clinic.id}/ai/status`),
  })
  const statusFor = (provider: AiProvider) =>
    aiStatus.data?.providers.find((p) => p.provider === provider) ?? null
  const providerStatuses = aiStatus.data?.providers ?? []

  return (
    <div className="space-y-4">
      <IntegrationGroupBanner
        icon="claude"
        title="Docmee AI providers"
        description="Connect AI provider keys used by Docmee for chat responses, knowledge-base grounding, and clinic-specific assistance."
      />
      {jzelConfigLocked && (
        <p className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
          Docmee is hidden for your user account, so Docmee and AI service configuration is locked.
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProviderLoginCard
          clinic={clinic}
          provider="claude"
          title="Claude (Anthropic)"
          status={statusFor('claude')}
          statuses={providerStatuses}
          loading={aiStatus.isLoading}
          locked={jzelConfigLocked}
        />
        <ProviderLoginCard
          clinic={clinic}
          provider="openai"
          title="Codex / ChatGPT (OpenAI)"
          status={statusFor('openai')}
          statuses={providerStatuses}
          loading={aiStatus.isLoading}
          locked={jzelConfigLocked}
        />
        <ProviderLoginCard
          clinic={clinic}
          provider="gemini"
          title="Google Gemini"
          status={statusFor('gemini')}
          statuses={providerStatuses}
          loading={aiStatus.isLoading}
          locked={jzelConfigLocked}
        />
        <ProviderLoginCard
          clinic={clinic}
          provider="custom"
          title="Custom / OpenAI-compatible"
          status={statusFor('custom')}
          statuses={providerStatuses}
          loading={aiStatus.isLoading}
          locked={jzelConfigLocked}
        />
      </div>
    </div>
  )
}

function CalendarIntegration({ clinic, connected }: { clinic: Clinic; connected: boolean }) {
  const qc = useQueryClient()
  const [message, setMessage] = useState<string | null>(null)
  const disconnect = useMutation({
    mutationFn: () => api.del(`/clinic/${clinic.id}/calendar/disconnect`),
    onSuccess: () => {
      setMessage('Google Calendar disconnected.')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect calendar.'),
  })

  return (
    <IntegrationCard
      title="Google Calendar"
      subtitle="Lets Docmee create and update appointment events in the clinic calendar."
      status={connected ? 'connected' : 'disconnected'}
      icon="googleCalendar"
      needs={['A Google account that owns or can edit the clinic calendar.', 'Permission from the clinic to let Docmee add and update appointment events.']}
      steps={['Click Connect Google.', 'Sign in with the clinic Google account.', 'Approve access, then return to Docmee and test a booking.']}
    >
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`${API_BASE}/clinic/${clinic.id}/calendar/auth`}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
        >
          Connect Google Calendar
        </a>
        <button
          type="button"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending || !connected}
          className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
        >
          {disconnect.isPending ? 'Disconnecting...' : 'Disconnect calendar'}
        </button>
      </div>
      {message && <p className={disconnect.isError ? 'mt-2 text-xs text-red-500' : 'mt-2 text-xs text-emerald-500'}>{message}</p>}
    </IntegrationCard>
  )
}

function SheetsIntegration({
  clinic,
  connected,
  sheets,
}: {
  clinic: Clinic
  connected: boolean
  sheets: GoogleSheetsSettings
}) {
  const qc = useQueryClient()
  const settings = (clinic.settings ?? {}) as IntegrationSettings
  const [enabled, setEnabled] = useState(Boolean(sheets.enabled))
  const [spreadsheetId, setSpreadsheetId] = useState(sheets.spreadsheetId ?? '')
  const [sheetName, setSheetName] = useState(sheets.sheetName ?? 'Patients')
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinic.id}`, {
        settings: {
          ...settings,
          googleSheets: { enabled, spreadsheetId: spreadsheetId.trim(), sheetName: sheetName.trim() || 'Patients' },
        },
      }),
    onSuccess: () => {
      setMessage('Google Sheets settings saved.')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save Sheets settings.'),
  })
  const disconnect = useMutation({
    mutationFn: () => {
      const nextSettings = { ...settings }
      delete nextSettings.googleSheets
      return api.patch(`/clinics/${clinic.id}`, { settings: nextSettings })
    },
    onSuccess: () => {
      setEnabled(false)
      setSpreadsheetId('')
      setSheetName('Patients')
      setMessage('Google Sheets disconnected.')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect Sheets.'),
  })
  const status: IntegrationStatus = enabled ? (connected && spreadsheetId.trim() ? 'connected' : 'pending') : 'disconnected'

  return (
    <IntegrationCard
      title="Google Sheets"
      subtitle="Optional export for patient/contact lists and operating reports."
      status={status}
      icon="googleSheets"
      needs={['A Google Sheet created by the clinic.', 'The Spreadsheet ID from the sheet URL.', 'The tab name where Docmee should write rows.']}
      steps={['Connect Google Calendar first so Google access is approved.', 'Paste the Spreadsheet ID and tab name.', 'Save, then run a small export test.']}
    >
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-gray-700 dark:text-gray-200">Turn on spreadsheet export</span>
          <Toggle on={enabled} onChange={setEnabled} label="Enable Google Sheets export" />
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Spreadsheet ID</span>
          <input value={spreadsheetId} onChange={(event) => setSpreadsheetId(event.target.value)} className={field} placeholder="1abcDEFghiJKLmnoPQRstuVWxyz..." />
          <FieldHint>Open the Google Sheet and copy the long ID between /d/ and /edit in the browser URL.</FieldHint>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Sheet tab name</span>
          <input value={sheetName} onChange={(event) => setSheetName(event.target.value)} className={field} placeholder="Patients" />
          <FieldHint>This is the tab at the bottom of the spreadsheet, such as Patients or Bookings.</FieldHint>
        </label>
        {!connected && <p className="text-[11px] text-amber-600">Connect Google Calendar first so Docmee has Google OAuth access.</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <p className={save.isError ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending || (!enabled && !spreadsheetId.trim())} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-300">
              {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
              {save.isPending ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </IntegrationCard>
  )
}

const EMAIL_PROVIDER_OPTIONS: Array<{ id: EmailDeliveryProvider; label: string; hint: string }> = [
  { id: 'google', label: 'Google / Gmail', hint: 'smtp.gmail.com with a Google app password.' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', hint: 'smtp.office365.com with an app password or SMTP auth.' },
  { id: 'other', label: 'Other SMTP', hint: 'Use any SMTP mailbox or relay.' },
]

const providerDefaultHost: Record<EmailDeliveryProvider, string> = {
  google: 'smtp.gmail.com',
  outlook: 'smtp.office365.com',
  other: '',
}

function EmailDeliveryIntegration({
  clinic,
  config,
  provider,
  loading,
}: {
  clinic: Clinic
  config: EmailDeliverySettings
  provider: ProviderReadiness | null
  loading: boolean
}) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(Boolean(config.enabled))
  const [emailProvider, setEmailProvider] = useState<EmailDeliveryProvider>(config.provider ?? 'google')
  const [fromName, setFromName] = useState(config.fromName ?? clinic.name ?? 'Docmee')
  const [fromEmail, setFromEmail] = useState(config.fromEmail ?? '')
  const [replyTo, setReplyTo] = useState(config.replyTo ?? '')
  const [smtpHost, setSmtpHost] = useState(config.smtpHost ?? providerDefaultHost[config.provider ?? 'google'])
  const [smtpPort, setSmtpPort] = useState(String(config.smtpPort ?? 587))
  const [smtpSecure, setSmtpSecure] = useState(Boolean(config.smtpSecure))
  const [smtpUser, setSmtpUser] = useState(config.smtpUser ?? '')
  const [smtpPassword, setSmtpPassword] = useState('')
  const [testTo, setTestTo] = useState(config.replyTo ?? '')
  const [notes, setNotes] = useState(config.notes ?? '')
  const [message, setMessage] = useState<string | null>(null)

  const readiness = useQuery({
    queryKey: ['email-delivery', clinic.id],
    queryFn: () => api.get<{ emailDelivery: EmailDeliverySettings; missing: string[] }>(`/clinics/${clinic.id}/email-delivery`),
  })
  const saved = readiness.data?.emailDelivery ?? config
  const missing = readiness.data?.missing ?? []

  useEffect(() => {
    if (!readiness.data) return
    const next = readiness.data.emailDelivery
    const nextProvider = next.provider ?? 'google'
    setEnabled(Boolean(next.enabled))
    setEmailProvider(nextProvider)
    setFromName(next.fromName ?? clinic.name ?? 'Docmee')
    setFromEmail(next.fromEmail ?? '')
    setReplyTo(next.replyTo ?? '')
    setSmtpHost(next.smtpHost ?? providerDefaultHost[nextProvider])
    setSmtpPort(String(next.smtpPort ?? 587))
    setSmtpSecure(Boolean(next.smtpSecure))
    setSmtpUser(next.smtpUser ?? '')
    setNotes(next.notes ?? '')
    setTestTo(next.replyTo ?? next.fromEmail ?? '')
  }, [clinic.name, readiness.data])

  function chooseProvider(next: EmailDeliveryProvider) {
    setEmailProvider(next)
    if (next !== 'other') {
      setSmtpHost(providerDefaultHost[next])
      setSmtpPort('587')
      setSmtpSecure(false)
    } else if (emailProvider !== 'other') {
      setSmtpHost('')
      setSmtpPort('587')
      setSmtpSecure(false)
    }
  }

  const providerReady = provider?.configured === true || missing.length === 0
  const hasSender = fromEmail.trim().includes('@')
  const hasSmtp = Boolean(smtpHost.trim() && smtpPort.trim() && smtpUser.trim() && (smtpPassword.trim() || saved.smtpPasswordSet))
  const status: IntegrationStatus = enabled ? (hasSender && hasSmtp && providerReady ? 'connected' : 'pending') : 'disconnected'

  const save = useMutation({
    mutationFn: () =>
      api.patch<{ emailDelivery: EmailDeliverySettings; missing: string[] }>(`/clinics/${clinic.id}/email-delivery`, {
        enabled,
        provider: emailProvider,
        fromName: fromName.trim() || 'Docmee',
        fromEmail: fromEmail.trim(),
        replyTo: replyTo.trim(),
        smtpHost: smtpHost.trim(),
        smtpPort: Number(smtpPort) || 587,
        smtpSecure,
        smtpUser: smtpUser.trim(),
        smtpPassword: smtpPassword.trim() || undefined,
        notes: notes.trim(),
      }),
    onSuccess: (data) => {
      setMessage(data.missing.length ? `Saved. Still missing: ${data.missing.join(', ')}.` : 'Email delivery is ready.')
      setSmtpPassword('')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['provider-status', clinic.id] })
      qc.invalidateQueries({ queryKey: ['email-delivery', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not save email settings.'),
  })
  const disconnect = useMutation({
    mutationFn: () => api.del<{ emailDelivery: EmailDeliverySettings; missing: string[] }>(`/clinics/${clinic.id}/email-delivery`),
    onSuccess: () => {
      setEnabled(false)
      setEmailProvider('google')
      setFromName('Docmee')
      setFromEmail('')
      setReplyTo('')
      setSmtpHost(providerDefaultHost.google)
      setSmtpPort('587')
      setSmtpSecure(false)
      setSmtpUser('')
      setSmtpPassword('')
      setTestTo('')
      setNotes('')
      setMessage('Email delivery disconnected.')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['provider-status', clinic.id] })
      qc.invalidateQueries({ queryKey: ['email-delivery', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect email delivery.'),
  })
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; sentTo: string; emailDelivery: EmailDeliverySettings }>(`/clinics/${clinic.id}/email-delivery/test`, { to: testTo.trim() || undefined }),
    onSuccess: (data) => {
      setMessage(`Test email sent to ${data.sentTo}.`)
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
      qc.invalidateQueries({ queryKey: ['email-delivery', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not send test email.'),
  })

  return (
    <IntegrationCard
      title="Email Delivery"
      subtitle="Send Docmee notifications with Google, Outlook, or any SMTP mailbox."
      status={status}
      icon="email"
      needs={[
        'A mailbox or SMTP relay that allows authenticated sending.',
        'For Google or Outlook, use an app password or SMTP-enabled account credentials.',
        'A verified From email and a monitored Reply-to inbox.',
      ]}
      steps={[
        'Choose the email platform.',
        'Enter sender, SMTP username, and password or app password.',
        'Save, then send a test email before enabling production alerts.',
      ]}
    >
      <div className="space-y-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-gray-700 dark:text-gray-200">Turn on outbound email</span>
          <Toggle on={enabled} onChange={setEnabled} label="Enable email delivery" />
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {EMAIL_PROVIDER_OPTIONS.map((option) => {
            const active = emailProvider === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => chooseProvider(option.id)}
                className={`rounded-md border px-3 py-3 text-left transition ${
                  active
                    ? 'border-cyan-400 bg-cyan-50 text-cyan-950 shadow-sm dark:border-cyan-500 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-gray-200 bg-white text-gray-700 hover:border-cyan-200 hover:bg-cyan-50/50 dark:border-gray-800 dark:bg-gray-950/30 dark:text-gray-300 dark:hover:border-cyan-800'
                }`}
              >
                <span className="block text-sm font-semibold">{option.label}</span>
                <span className="mt-1 block text-[11px] leading-4 opacity-80">{option.hint}</span>
              </button>
            )
          })}
        </div>

        <div className={`rounded-md border p-2 text-[11px] ${missing.length ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200' : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
          {loading || readiness.isLoading ? (
            <span>Checking email delivery settings...</span>
          ) : missing.length ? (
            <span className="font-medium">Needs setup: {missing.join(', ')}.</span>
          ) : (
            <span className="font-medium">Email delivery settings are complete. Send a test email to confirm the mailbox accepts Docmee messages.</span>
          )}
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Sender name</span>
            <input value={fromName} onChange={(event) => setFromName(event.target.value)} className={field} placeholder="Docmee" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">From email</span>
            <input value={fromEmail} onChange={(event) => setFromEmail(event.target.value)} className={field} placeholder="notifications@yourclinic.com" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Reply-to email</span>
            <input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} className={field} placeholder="clinic@example.com" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">SMTP username</span>
            <input value={smtpUser} onChange={(event) => setSmtpUser(event.target.value)} className={field} placeholder="Usually the mailbox email" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">SMTP host</span>
            <input value={smtpHost} onChange={(event) => setSmtpHost(event.target.value)} disabled={emailProvider !== 'other'} className={field} placeholder="smtp.example.com" />
          </label>
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">SMTP port</span>
            <input value={smtpPort} onChange={(event) => setSmtpPort(event.target.value)} disabled={emailProvider !== 'other'} className={field} placeholder="587" inputMode="numeric" />
          </label>
          <label className="block md:col-span-2 xl:col-span-1">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
              SMTP password or app password {saved.smtpPasswordSet ? '(saved - leave blank to keep)' : ''}
            </span>
            <input type="password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} className={field} placeholder={saved.smtpPasswordSet ? '********' : 'Paste app password or SMTP password'} />
            <FieldHint>Secret values are write-only and shown as ******** after saving.</FieldHint>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-gray-200 bg-gray-50 p-2 dark:border-gray-800 dark:bg-gray-950/40">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={smtpSecure} onChange={(event) => setSmtpSecure(event.target.checked)} disabled={emailProvider !== 'other'} />
            <span className="font-medium text-gray-600 dark:text-gray-300">Use direct SSL/TLS instead of STARTTLS</span>
          </label>
          <span className="text-[11px] text-gray-500 dark:text-gray-400">Google and Outlook use port 587 with STARTTLS.</span>
        </div>

        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Notes</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className={field} placeholder="Domain verification, owner, mailbox policy, or support inbox notes" />
        </label>

        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Send test to</span>
            <input value={testTo} onChange={(event) => setTestTo(event.target.value)} className={field} placeholder="admin@example.com" />
          </label>
          <button
            type="button"
            onClick={() => test.mutate()}
            disabled={test.isPending || missing.length > 0}
            className="self-end rounded-md border border-cyan-300 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50 disabled:opacity-50 dark:border-cyan-800 dark:text-cyan-200 dark:hover:bg-cyan-950/40"
          >
            {test.isPending ? 'Sending...' : 'Send test email'}
          </button>
        </div>

        <SaveRow
          pending={save.isPending}
          error={save.isError || disconnect.isError || test.isError}
          message={message}
          onSave={() => save.mutate()}
          onDisconnect={() => disconnect.mutate()}
          disconnectPending={disconnect.isPending}
          disconnectDisabled={!enabled && !fromEmail.trim() && !smtpUser.trim() && !saved.smtpPasswordSet}
        />
      </div>
    </IntegrationCard>
  )
}
function N8nIntegration({ clinic, config }: { clinic: Clinic; config: ExternalIntegration }) {
  const qc = useQueryClient()
  const [enabled, setEnabled] = useState(Boolean(config.enabled))
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl ?? '')
  const [notes, setNotes] = useState(config.notes ?? '')
  const [message, setMessage] = useState<string | null>(null)
  const save = useIntegrationSave(clinic, 'n8n', { enabled, webhookUrl: webhookUrl.trim(), notes: notes.trim() }, () => {
    setMessage('N8N integration saved.')
    qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
  }, (error) => setMessage(error))
  const disconnect = useMutation({
    mutationFn: () => {
      const settings = (clinic.settings ?? {}) as IntegrationSettings
      const integrations = { ...(settings.integrations ?? {}) }
      delete integrations.n8n
      return api.patch(`/clinics/${clinic.id}`, { settings: { ...settings, integrations } })
    },
    onSuccess: () => {
      setEnabled(false)
      setWebhookUrl('')
      setNotes('')
      setMessage('N8N disconnected.')
      qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect N8N.'),
  })
  const status: IntegrationStatus = enabled ? (webhookUrl.trim() ? 'connected' : 'pending') : 'disconnected'

  return (
    <IntegrationCard
      title="Automation webhook"
      subtitle="Send selected Docmee events to n8n, Make, Zapier, or another workflow tool."
      status={status}
      icon="n8n"
      needs={['A workflow URL from your automation tool.', 'A clear plan for what should happen when Docmee sends an event.']}
      steps={['Create a webhook trigger in your automation tool.', 'Copy the webhook URL and paste it here.', 'Save, then run one test event before using it with real patients.']}
    >
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-gray-700 dark:text-gray-200">Turn on automation webhook</span>
          <Toggle on={enabled} onChange={setEnabled} label="Enable automation webhook" />
        </div>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Webhook URL from your automation tool</span>
          <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} className={field} placeholder="https://n8n.example.com/webhook/..." />
          <FieldHint>Paste the full HTTPS URL created by n8n, Make, Zapier, or your workflow platform.</FieldHint>
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">Notes</span>
          <input value={notes} onChange={(event) => setNotes(event.target.value)} className={field} />
        </label>
        <SaveRow
          pending={save.isPending}
          error={save.isError || disconnect.isError}
          message={message}
          onSave={() => save.mutate()}
          onDisconnect={() => disconnect.mutate()}
          disconnectPending={disconnect.isPending}
          disconnectDisabled={!enabled && !webhookUrl.trim()}
        />
      </div>
    </IntegrationCard>
  )
}

// Per-clinic AI provider connection. Providers do not offer a safe partner OAuth
// flow for API access, so the working "login" is a secure clinic-owned API key.
function ProviderLoginCard({
  clinic,
  provider,
  title,
  status,
  statuses,
  loading,
  locked,
}: {
  clinic: Clinic
  provider: AiProvider
  title: string
  status: AiProviderStatus | null
  statuses: AiProviderStatus[]
  loading: boolean
  locked: boolean
}) {
  const qc = useQueryClient()
  const settings = (clinic.settings ?? {}) as IntegrationSettings
  const currentAi = settings.aiAssistant ?? {}
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState(provider === 'custom' ? currentAi.baseURL ?? '' : '')
  const [model, setModel] = useState(
    provider === 'custom'
      ? currentAi.model ?? ''
      : currentAi.chatProvider === provider
        ? currentAi.model ?? DEFAULT_MODEL[provider]
        : DEFAULT_MODEL[provider],
  )
  const [configOpen, setConfigOpen] = useState(false)
  const [connectionMode, setConnectionMode] = useState<'api' | 'login'>('api')
  const [message, setMessage] = useState<string | null>(null)
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ai-status', clinic.id] })
    qc.invalidateQueries({ queryKey: ['clinic', clinic.id] })
  }

  const connect = useMutation({
    mutationFn: async () => {
      if (locked) throw new Error('Docmee is hidden for your user account. AI service configuration is locked.')
      const nextEmbedProvider =
        embeddingProviderFor(provider) ?? connectedEmbeddingProvider(statuses, currentAi.embedProvider)
      await api.post(`/clinic/${clinic.id}/ai/${provider}/connect`, {
        apiKey: apiKey.trim(),
        baseURL: provider === 'custom' ? baseURL.trim() : undefined,
      })
      await api.patch(`/clinics/${clinic.id}`, {
        settings: {
          aiAssistant: {
            ...(settings.aiAssistant ?? {}),
            chatProvider: provider,
            model: model.trim() || DEFAULT_MODEL[provider],
            baseURL: provider === 'custom' ? baseURL.trim() : '',
            ...(nextEmbedProvider ? { embedProvider: nextEmbedProvider } : {}),
          },
        },
      })
      if (nextEmbedProvider) {
        await api.post(`/clinics/${clinic.id}/kb/reembed`, {})
      }
    },
    onSuccess: () => {
      setApiKey('')
      setMessage(`${title} connected and selected for Docmee.`)
      refresh()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not connect this provider.'),
  })
  const disconnect = useMutation({
    mutationFn: () => {
      if (locked) throw new Error('Docmee is hidden for your user account. AI service configuration is locked.')
      return api.del(`/clinic/${clinic.id}/ai/${provider}/disconnect`)
    },
    onSuccess: () => {
      setMessage(`${title} disconnected.`)
      refresh()
    },
    onError: (error) => setMessage(error instanceof Error ? error.message : 'Could not disconnect this provider.'),
  })

  const source = status?.source ?? 'none'
  const cardStatus: IntegrationStatus = source === 'clinic' ? 'connected' : 'disconnected'
  const meta = PROVIDER_META[provider]
  const subtitle = meta.subtitle
  const canConnect = apiKey.trim().length >= 8 && (provider !== 'custom' || (baseURL.trim().startsWith('http') && model.trim().length > 0))

  return (
    <IntegrationCard
      title={title}
      subtitle={subtitle}
      status={cardStatus}
      icon={PROVIDER_ICON[provider]}
      needs={[
        provider === 'custom' ? 'An OpenAI-compatible endpoint URL from your AI provider.' : `An API key from the ${title} provider account.`,
        'A model name approved for this clinic.',
        'A clinic decision that this provider should power Docmee.',
      ]}
      steps={[
        'Open the provider account in a new tab.',
        'Create or copy an API key.',
        'Paste the key here, choose the model, and save.',
      ]}
    >
      <div
        aria-disabled={locked}
        className={`space-y-3 text-xs ${locked ? 'rounded-md bg-gray-50/70 p-2 opacity-60 dark:bg-gray-950/50' : ''}`}
      >
        {locked && (
          <p className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
            Locked because Docmee is hidden for your user account.
          </p>
        )}
        {loading ? (
          <p className="text-gray-400">Checking connection...</p>
        ) : source === 'clinic' ? (
          <p className="font-medium text-emerald-600 dark:text-emerald-400">
            Connected with this clinic's key{status?.last4 ? ` (****${status.last4})` : ''}.
          </p>
        ) : (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            <p className="font-semibold">API key required. Paste this provider key to enable {title}.</p>
            <p className="mt-1">
              If you already entered it before, Docmee does not currently have it saved for this clinic.
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setConfigOpen((value) => !value)}
          aria-expanded={configOpen}
          disabled={locked}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {configOpen ? 'Hide configuration' : 'Show configuration'}
        </button>

        {configOpen && (
        <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-950/60">
        <div className="grid grid-cols-2 gap-1 rounded-md bg-gray-200 p-1 text-xs font-semibold dark:bg-gray-800">
          <button
            type="button"
            disabled={locked}
            onClick={() => setConnectionMode('api')}
            className={
              connectionMode === 'api'
                ? 'rounded bg-white px-3 py-1.5 text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-50'
                : 'rounded px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }
          >
            API key
          </button>
          <button
            type="button"
            disabled={locked}
            onClick={() => setConnectionMode('login')}
            className={
              connectionMode === 'login'
                ? 'rounded bg-white px-3 py-1.5 text-gray-900 shadow-sm dark:bg-gray-950 dark:text-gray-50'
                : 'rounded px-3 py-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
            }
          >
            Open provider account
          </button>
        </div>

        {connectionMode === 'login' && (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            {provider === 'custom' ? (
              <>
                <p className="font-semibold">Custom providers use their own dashboard.</p>
                <p className="mt-1">
                  Open your custom AI provider account, create an OpenAI-compatible API key, then paste the key and endpoint URL below.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">Open the provider account, then return here.</p>
                <p className="mt-1">
                  Sign in, create or copy an API key, then paste it in the API key tab so Docmee can validate and save it.
                </p>
                <a
                  href={PROVIDER_CONSOLE_URL[provider]}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={locked}
                  tabIndex={locked ? -1 : undefined}
                  onClick={(event) => {
                    if (locked) event.preventDefault()
                  }}
                  className={`mt-3 inline-flex min-h-9 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold text-white ${
                    locked ? 'pointer-events-none bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  Open {title}
                </a>
              </>
            )}
          </div>
        )}

        {connectionMode === 'api' && (
        <>
        <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
              {meta.keyLabel}
            </span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            disabled={locked}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={meta.placeholder}
            className={field}
          />
          <FieldHint>Docmee stores this securely and will only show a masked ending after saving.</FieldHint>
        </label>

        <label className="block">
          <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
            Model for Docmee
          </span>
          <input
            type="text"
            value={model}
            disabled={locked}
            onChange={(event) => setModel(event.target.value)}
            placeholder={provider === 'custom' ? 'model-name-from-your-provider' : DEFAULT_MODEL[provider]}
            className={field}
          />
          <FieldHint>Use the exact model name from the provider, such as claude-sonnet-4-6, gpt-4o, or gemini-2.0-flash.</FieldHint>
        </label>

        {provider === 'custom' && (
          <label className="block">
            <span className="mb-1 block font-medium text-gray-500 dark:text-gray-400">
              Endpoint URL
            </span>
            <input
              type="url"
              value={baseURL}
              disabled={locked}
              onChange={(event) => setBaseURL(event.target.value)}
              placeholder="https://your-ai-provider.example/v1"
              className={field}
            />
            <span className="mt-1 block text-[11px] text-gray-400">
              Use the OpenAI-compatible /v1 base URL from your provider.
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setMessage(null)
              connect.mutate()
            }}
            disabled={locked || connect.isPending || !canConnect}
            className="rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white disabled:opacity-60"
          >
            {connect.isPending ? 'Connecting...' : source === 'clinic' ? 'Replace connection' : meta.action}
          </button>
          {source === 'clinic' && (
            <button
              type="button"
              onClick={() => {
                setMessage(null)
                disconnect.mutate()
              }}
              disabled={locked || disconnect.isPending}
              className="rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
            >
              {disconnect.isPending ? 'Disconnecting...' : 'Disconnect'}
            </button>
          )}
        </div>

        {message && (
          <p className={connect.isError || disconnect.isError ? 'text-red-500' : 'text-emerald-500'}>{message}</p>
        )}
        <p className="text-[11px] text-gray-400">
          Keys are encrypted on the server and never shown again. Connecting also selects this provider for Docmee.
        </p>
        </>
        )}
        </div>
        )}
      </div>
    </IntegrationCard>
  )
}

function useIntegrationSave(
  clinic: Clinic,
  key: 'n8n' | 'chatgpt' | 'claude',
  value: ExternalIntegration,
  onSuccess: () => void,
  onError: (error: string) => void,
) {
  const settings = (clinic.settings ?? {}) as IntegrationSettings
  return useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinic.id}`, {
        settings: {
          ...settings,
          integrations: {
            ...(settings.integrations ?? {}),
            [key]: value,
          },
        },
      }),
    onSuccess,
    onError: (error) => onError(error instanceof Error ? error.message : 'Could not save integration.'),
  })
}

function SaveRow({
  pending,
  error,
  message,
  onSave,
  onDisconnect,
  disconnectPending,
  disconnectDisabled,
}: {
  pending: boolean
  error: boolean
  message: string | null
  onSave: () => void
  onDisconnect?: () => void
  disconnectPending?: boolean
  disconnectDisabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <p className={error ? 'text-xs text-red-500' : 'text-xs text-emerald-500'}>{message}</p>
      <div className="flex flex-wrap gap-2">
        {onDisconnect && (
          <button type="button" onClick={onDisconnect} disabled={disconnectPending || disconnectDisabled} className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-300">
            {disconnectPending ? 'Disconnecting...' : 'Disconnect'}
          </button>
        )}
        <button type="button" onClick={onSave} disabled={pending} className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60">
          {pending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
