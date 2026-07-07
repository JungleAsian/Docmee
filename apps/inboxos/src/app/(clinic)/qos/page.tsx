'use client'

// Req 32 — Quality of Service monitoring (Screen 15, Surface A).
// An operations board that surfaces the service-quality problems the basic metrics
// dashboard does not: upset patients, abandoned conversations, secretary vs bot
// response times, unclosed conversations and follow-up opportunities — plus an
// actionable "needs attention" list that drills into the patient view. Bot vs human
// mode, upset/urgent safety status and aging are first-class colour-coded signals.
// clinic_admin and ia_studio_admin only. No external charting library.
import { useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useOnline } from '@/shared/hooks/useOnline'
import { rolesWith } from '@/shared/permissions'
import { useI18n } from '@/shared/hooks/useI18n'
import type { Clinic, ClinicQos, QosAttentionItem } from '@/shared/types'

const STALE_OPTIONS = [6, 12, 24, 48, 72]

type Tone = 'danger' | 'warn' | 'unclosed' | 'info' | 'teal'

// Per-channel brand dot colour (whatsapp green / messenger blue / instagram pink).
const CHANNEL_DOT: Record<string, string> = {
  whatsapp: 'bg-[#25d366]',
  messenger: 'bg-[#0a7cff]',
  instagram: 'bg-[#d62976]',
}
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
}

export default function QosPage() {
  const { t } = useI18n()
  // Req 2: mirror the API's clinic_admin/ia_studio_admin gate at the page level.
  const { ready } = useAuthGuard(rolesWith('qos'))
  const user = useAuthStore((s) => s.user)
  const online = useOnline()
  const isAdmin = user?.role === 'ia_studio_admin'
  // Studio admins start on the "select a clinic" state (they operate many tenants);
  // a clinic_admin is scoped to their own clinic, so it loads straight away.
  const [clinicId, setClinicId] = useState<string>(isAdmin ? '' : (user?.clinicId ?? ''))
  const [staleHours, setStaleHours] = useState<number>(24)

  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    enabled: isAdmin,
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })

  const qosQuery = useQuery({
    queryKey: ['qos', clinicId, staleHours],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ qos: ClinicQos }>(`/clinics/${clinicId}/qos?staleHours=${staleHours}`),
  })
  const q = qosQuery.data?.qos

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  const roleLabel = isAdmin ? 'Admin Studio' : t('qos.roleAdmin')
  const blended = blendResponse(q?.avgBotResponseSeconds ?? 0, q?.avgSecretaryResponseSeconds ?? 0)

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-md space-y-8">
        {/* Header: title + role / live pills */}
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">Operational quality</p>
            <h1 className="clinic-title">{t('qos.title')}</h1>
            <p className="clinic-subtitle">{t('qos.desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-xs font-semibold text-teal-600 dark:border-teal-900 dark:bg-teal-950/50 dark:text-teal-300">
              {roleLabel}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
                online
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300'
                  : 'border-gray-200 bg-gray-100 text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500 ring-2 ring-emerald-500/20' : 'bg-gray-400'}`}
              />
              {online ? t('qos.live') : t('conn.offline.title')}
            </span>
          </div>
        </div>

        {/* Filters: clinic (admin) + aging window */}
        <div className="clinic-toolbar">
          {isAdmin && (
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-semibold uppercase tracking-wide text-gray-400">{t('qos.selectClinic')}</span>
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">—</option>
                {(clinicsQuery.data?.clinics ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold uppercase tracking-wide text-gray-400">{t('qos.agingWindow')}</span>
            <select
              value={staleHours}
              onChange={(e) => setStaleHours(Number(e.target.value))}
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              {STALE_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {t('qos.hoursOption', { h })}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!online && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <b>{t('conn.offline.title')}</b> · {t('conn.offline.body')}
          </div>
        )}

        {/* States: select-clinic / loading / error / data */}
        {isAdmin && !clinicId ? (
          <PickClinicState title={t('qos.pick.title')} body={t('qos.pick.body')} />
        ) : qosQuery.isLoading ? (
          <LoadingState />
        ) : qosQuery.isError ? (
          <ErrorState
            title={t('qos.error.title')}
            body={t('qos.error.body')}
            retry={t('common.retry')}
            onRetry={() => qosQuery.refetch()}
          />
        ) : !q ? (
          <div className="clinic-empty-state text-sm">{t('qos.empty')}</div>
        ) : (
          <>
            {/* Risk stat cards */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
              <RiskCard
                icon="⚠️"
                tone="danger"
                label={t('qos.card.upset')}
                value={String(q.upsetPatients)}
                chip={{ variant: 'danger', text: t('qos.chip.unresolved', { n: q.upsetUnresolved }) }}
                hint={t('qos.card.upsetHint')}
              />
              <RiskCard
                icon="🚪"
                tone="warn"
                label={t('qos.card.abandoned')}
                value={String(q.abandonedConversations)}
                chip={{ variant: 'warn', text: t('qos.chip.quiet') }}
                hint={t('qos.card.abandonedHint')}
              />
              <RiskCard
                icon="🕓"
                tone="unclosed"
                label={t('qos.card.aged')}
                value={String(q.unclosedAged)}
                chip={{ variant: 'unclosed', text: t('qos.chip.pastWindow') }}
                hint={t('qos.card.agedHint')}
              />
              <RiskCard
                icon="⚡"
                tone="info"
                label={t('qos.card.response')}
                value={formatDuration(blended)}
                chip={
                  blended > 0 && blended <= 300
                    ? { variant: 'ok', text: t('qos.chip.withinTarget') }
                    : undefined
                }
                hint={t('qos.card.responseHint')}
              />
              <RiskCard
                icon="🔔"
                tone="teal"
                label={t('qos.card.followups')}
                value={String(q.followUpOpportunities)}
                chip={{ variant: 'warn', text: t('qos.chip.pending', { n: q.pendingFollowUps }) }}
                hint={t('qos.card.followupsHint')}
              />
            </div>

            {/* Response time + follow-up split */}
            <div className="clinic-chart-grid">
              <section className="clinic-card clinic-chart-card">
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-sm font-bold">{t('qos.rt.title')}</h2>
                  <span className="ml-auto text-xs text-gray-400">{t('qos.rt.window')}</span>
                </div>
                <p className="mb-4 text-xs text-gray-400">{t('qos.rt.sub')}</p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                  <ResponsePanel
                    mode="bot"
                    badge={t('qos.rt.bot')}
                    value={formatDuration(q.avgBotResponseSeconds)}
                    meta={t('qos.rt.botMeta')}
                    seconds={q.avgBotResponseSeconds}
                  />
                  <ResponsePanel
                    mode="human"
                    badge={t('qos.rt.human')}
                    value={formatDuration(q.avgSecretaryResponseSeconds)}
                    meta={t('qos.rt.humanMeta')}
                    seconds={q.avgSecretaryResponseSeconds}
                  />
                </div>
              </section>

              <section className="clinic-card clinic-chart-card">
                <h2 className="text-sm font-bold">{t('qos.fu.title')}</h2>
                <p className="mb-4 text-xs text-gray-400">{t('qos.fu.sub')}</p>
                <div className="flex flex-col gap-3">
                  <FollowUpRow
                    icon="🔁"
                    iconClass="bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300"
                    title={t('qos.fu.opportunities')}
                    sub={t('qos.fu.opportunitiesSub')}
                    value={q.followUpOpportunities}
                  />
                  <FollowUpRow
                    icon="🔔"
                    iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
                    title={t('qos.fu.pending')}
                    sub={t('qos.fu.pendingSub')}
                    value={q.pendingFollowUps}
                  />
                </div>
              </section>
            </div>

            {/* Needs-attention list */}
            <section className="clinic-card clinic-chart-card">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-bold">{t('qos.attention')}</h2>
                {q.attention.length > 0 && (
                  <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-bold text-red-600 dark:bg-red-950/40 dark:text-red-300">
                    {t('qos.attn.count', { n: q.attention.length })}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
                  {t('qos.attn.staleNote')}
                  <span className="rounded-md border border-gray-200 px-2 py-0.5 font-semibold text-gray-600 dark:border-gray-700 dark:text-gray-300">
                    {t('qos.hoursOption', { h: staleHours })}
                  </span>
                </span>
              </div>

              {q.attention.length === 0 ? (
                <AllClearState
                  tag={t('qos.allClear.tag')}
                  title={t('qos.allClear.title')}
                  body={t('qos.allClear.body')}
                  widen={staleHours < 72 ? t('qos.allClear.widen') : undefined}
                  onWiden={() => setStaleHours(72)}
                />
              ) : (
                <div>
                  {/* Desktop column header */}
                  <div className="hidden grid-cols-[minmax(0,2.4fr)_7rem_6rem_6rem_auto] gap-3 border-b border-gray-200 px-1 pb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400 md:grid dark:border-gray-800">
                    <span>{t('qos.col.patient')}</span>
                    <span>{t('qos.col.reason')}</span>
                    <span>{t('qos.col.mode')}</span>
                    <span>{t('qos.col.aged')}</span>
                    <span />
                  </div>
                  {q.attention.map((item) => (
                    <AttentionRow key={item.conversationId} item={item} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}

// ── Risk stat card ────────────────────────────────────────────────────────────
const TONE_BAR: Record<Tone, string> = {
  danger: 'border-l-4 border-l-red-500',
  warn: 'border-l-4 border-l-amber-500',
  unclosed: 'border-l-4 border-l-gray-400',
  info: '',
  teal: '',
}
const TONE_ICON: Record<Tone, string> = {
  danger: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
  warn: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300',
  unclosed: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300',
  info: 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300',
  teal: 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300',
}

type ChipVariant = 'danger' | 'warn' | 'unclosed' | 'ok'
const CHIP_STYLE: Record<ChipVariant, string> = {
  danger: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
  warn: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  unclosed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  ok: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
}
const CHIP_DOT: Record<ChipVariant, string> = {
  danger: 'bg-red-500',
  warn: 'bg-amber-500',
  unclosed: 'bg-gray-400',
  ok: 'bg-emerald-500',
}

function Chip({ variant, text }: { variant: ChipVariant; text: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${CHIP_STYLE[variant]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT[variant]}`} />
      {text}
    </span>
  )
}

function RiskCard({
  icon,
  tone,
  label,
  value,
  chip,
  hint,
}: {
  icon: string
  tone: Tone
  label: string
  value: string
  chip?: { variant: ChipVariant; text: string }
  hint: string
}) {
  return (
    <div
      className={`clinic-card p-5 ${TONE_BAR[tone]}`}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <div className={`flex h-9 w-9 items-center justify-center rounded-xl text-base ${TONE_ICON[tone]}`}>{icon}</div>
        <p className="text-xs font-semibold leading-tight text-gray-500 dark:text-gray-400">{label}</p>
      </div>
      <p
        className={`text-4xl font-bold tracking-tight ${
          tone === 'danger' ? 'text-red-600 dark:text-red-400' : tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
      >
        {value}
      </p>
      {chip && <div className="mt-2">{<Chip {...chip} />}</div>}
      <p className="mt-2 text-[11px] leading-snug text-gray-400">{hint}</p>
    </div>
  )
}

// ── Response-time panel (bot vs human) ────────────────────────────────────────
function ResponsePanel({
  mode,
  badge,
  value,
  meta,
  seconds,
}: {
  mode: 'bot' | 'human'
  badge: string
  value: string
  meta: string
  seconds: number
}) {
  // Meter fills relative to a 10-minute ceiling — a fast bot reply barely registers,
  // a slow human reply fills the bar, making the gap visually obvious.
  const width = seconds <= 0 ? 0 : Math.min(100, Math.max(5, (seconds / 600) * 100))
  const accent = mode === 'bot' ? 'bg-teal-500' : 'bg-teal-500'
  const badgeStyle =
    mode === 'bot'
      ? 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300'
      : 'bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300'
  return (
    <div className="rounded-xl bg-gray-50 p-3.5 dark:bg-gray-800/40">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${badgeStyle}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${accent}`} />
        {badge}
      </span>
      <p className="mt-3 text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">{meta}</p>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div className={`h-full rounded-full ${accent}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function FollowUpRow({
  icon,
  iconClass,
  title,
  sub,
  value,
}: {
  icon: string
  iconClass: string
  title: string
  sub: string
  value: number
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base ${iconClass}`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-[11px] text-gray-400">{sub}</p>
      </div>
      <p className="text-xl font-bold tracking-tight">{value}</p>
    </div>
  )
}

// ── Needs-attention row ───────────────────────────────────────────────────────
const REASON_CHIP: Record<QosAttentionItem['reason'], ChipVariant> = {
  upset: 'danger',
  abandoned: 'warn',
  unclosed: 'unclosed',
}
const REASON_AGED_KEY: Record<QosAttentionItem['reason'], string> = {
  upset: 'qos.aged.unresolved',
  abandoned: 'qos.aged.silent',
  unclosed: 'qos.aged.open',
}

function AttentionRow({ item }: { item: QosAttentionItem }) {
  const { t } = useI18n()
  const name = item.patientName || t('qos.noName')
  const upset = item.reason === 'upset'
  const channelLabel = CHANNEL_LABEL[item.channel] ?? item.channel
  return (
    <div className="border-b border-gray-100 last:border-0 dark:border-gray-800/70">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 md:grid md:grid-cols-[minmax(0,2.4fr)_7rem_6rem_6rem_auto] md:items-center">
        {/* Patient */}
        <div className="flex min-w-0 flex-1 items-center gap-3 md:flex-none">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
              upset
                ? 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {initials(name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{name}</p>
            <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <span className={`h-1.5 w-1.5 rounded-full ${CHANNEL_DOT[item.channel] ?? 'bg-gray-400'}`} />
              {channelLabel}
            </p>
          </div>
        </div>

        {/* Reason */}
        <div className="md:justify-self-start">
          <Chip variant={REASON_CHIP[item.reason]} text={t(`qos.reason.${item.reason}` as Parameters<typeof t>[0])} />
        </div>

        {/* Mode — bot vs human, unmistakable */}
        <div
          className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
            item.mode === 'human' ? 'text-teal-600 dark:text-teal-300' : 'text-teal-600 dark:text-teal-300'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${item.mode === 'human' ? 'bg-teal-500' : 'bg-teal-500'}`} />
          {item.mode === 'human' ? t('qos.mode.human') : t('qos.mode.bot')}
        </div>

        {/* Aged */}
        <div className="text-sm font-bold">
          {item.lastMessageAt ? relativeTime(item.lastMessageAt) : '—'}
          <span className="block text-[11px] font-medium text-gray-400">
            {t(REASON_AGED_KEY[item.reason] as Parameters<typeof t>[0])}
          </span>
        </div>

        {/* Drill-down into the patient view */}
        <Link
          href={`/inbox/${item.conversationId}/patient`}
          className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-600 shadow-sm hover:bg-gray-50 md:ml-0 md:justify-self-end dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
        >
          {t('qos.openChat')}
        </Link>
      </div>
    </div>
  )
}

// ── States ────────────────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="clinic-card p-5">
            <div className="mb-3 h-9 w-9 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
            <div className="h-8 w-1/2 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        ))}
      </div>
      <div className="clinic-card h-56 animate-pulse" />
    </div>
  )
}

function ErrorState({
  title,
  body,
  retry,
  onRetry,
}: {
  title: string
  body: string
  retry: string
  onRetry: () => void
}) {
  return (
    <div className="clinic-card flex flex-col items-center justify-center gap-2 p-12 text-center">
      <span className="mb-1 inline-flex items-center rounded bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-600 dark:bg-red-950/40 dark:text-red-300">
        {title}
      </span>
      <div className="text-3xl">⚠️</div>
      <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">{body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 rounded-lg border border-red-200 px-4 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
      >
        {retry}
      </button>
    </div>
  )
}

function AllClearState({
  tag,
  title,
  body,
  widen,
  onWiden,
}: {
  tag: string
  title: string
  body: string
  widen?: string
  onWiden: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
      <span className="mb-1 inline-flex items-center rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
        {tag}
      </span>
      <div className="text-3xl">✅</div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="max-w-xs text-xs text-gray-500 dark:text-gray-400">{body}</p>
      {widen && (
        <button
          type="button"
          onClick={onWiden}
          className="mt-1 rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-semibold text-teal-600 shadow-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {widen}
        </button>
      )}
    </div>
  )
}

function PickClinicState({ title, body }: { title: string; body: string }) {
  return (
    <div className="clinic-card flex flex-col items-center justify-center gap-2 p-12 text-center">
      <span className="mb-1 inline-flex items-center rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
        Admin Studio
      </span>
      <div className="text-3xl">🏥</div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{body}</p>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '··'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

// Blended first-response time: average the bot + secretary medians that are present.
function blendResponse(bot: number, secretary: number): number {
  const present = [bot, secretary].filter((s) => s > 0)
  if (present.length === 0) return 0
  return Math.round(present.reduce((a, b) => a + b, 0) / present.length)
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

// Compact relative time (e.g. "3h", "2d") for the aging column.
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const diffMin = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (diffMin < 60) return `${diffMin}m`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 48) return `${diffH}h`
  return `${Math.round(diffH / 24)}d`
}
