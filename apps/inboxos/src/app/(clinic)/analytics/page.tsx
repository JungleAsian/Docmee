'use client'

// Gap #39 — Advanced analytics. Available to clinic_admin and ia_studio_admin.
// Date range picker, headline metrics, a peak-hours heatmap, patient retention,
// bot effectiveness and a CSV export — no external charting library.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { rolesWith } from '@/shared/permissions'
import { useI18n } from '@/shared/hooks/useI18n'
import { useFeatures } from '@/shared/hooks/useFeatures'
import type { Clinic, AdvancedAnalytics, ClinicMetrics, ClinicQos } from '@/shared/types'

const DAY_MS = 24 * 60 * 60 * 1000
const isoDate = (d: Date) => d.toISOString().slice(0, 10)
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
type CardTone = 'indigo' | 'cyan' | 'emerald' | 'teal' | 'amber' | 'rose' | 'violet'

const CARD_TONE: Record<CardTone, string> = {
  indigo: 'from-cyan-50 to-white text-cyan-700 dark:from-cyan-950/35 dark:to-[var(--crm-card-bg)] dark:text-cyan-200',
  cyan: 'from-blue-50 to-white text-blue-700 dark:from-blue-950/35 dark:to-[var(--crm-card-bg)] dark:text-blue-200',
  emerald: 'from-emerald-50 to-white text-emerald-700 dark:from-emerald-950/35 dark:to-[var(--crm-card-bg)] dark:text-emerald-200',
  teal: 'from-cyan-50 to-white text-cyan-700 dark:from-cyan-950/35 dark:to-[var(--crm-card-bg)] dark:text-cyan-200',
  amber: 'from-orange-50 to-white text-orange-700 dark:from-orange-950/35 dark:to-[var(--crm-card-bg)] dark:text-orange-200',
  rose: 'from-red-50 to-white text-red-700 dark:from-red-950/35 dark:to-[var(--crm-card-bg)] dark:text-red-200',
  violet: 'from-cyan-50 to-white text-cyan-700 dark:from-cyan-950/35 dark:to-[var(--crm-card-bg)] dark:text-cyan-200',
}

const CHART = {
  orange: '#F97316',
  red: '#EF4444',
  blue: '#3B82F6',
  purple: '#34c6e5',
  cyan: '#06B6D4',
  green: '#10B981',
}

export default function AnalyticsPage() {
  const { t } = useI18n()
  // Req 2: mirror the API's clinic_admin/ia_studio_admin gate at the page level.
  const { ready } = useAuthGuard(rolesWith('analytics'))
  const user = useAuthStore((s) => s.user)
  const { features, ready: featuresReady } = useFeatures()
  const isAdmin = user?.role === 'ia_studio_admin'
  const [clinicId, setClinicId] = useState<string>(user?.clinicId ?? '')
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 30 * DAY_MS)))
  const [to, setTo] = useState(isoDate(new Date()))

  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    enabled: isAdmin && features.advancedAnalytics,
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })

  const analyticsQuery = useQuery({
    queryKey: ['analytics', clinicId, from, to],
    enabled: Boolean(clinicId) && features.advancedAnalytics,
    queryFn: () =>
      api.get<{ analytics: AdvancedAnalytics }>(
        `/clinics/${clinicId}/analytics?from=${from}&to=${to}`,
      ),
  })
  const metricsQuery = useQuery({
    queryKey: ['metrics', clinicId, 30],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ metrics: ClinicMetrics }>(`/clinics/${clinicId}/metrics?window=30`),
  })
  const qosQuery = useQuery({
    queryKey: ['qos', clinicId, 24],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ qos: ClinicQos }>(`/clinics/${clinicId}/qos?staleHours=24`),
  })
  const a = analyticsQuery.data?.analytics
  const metrics = metricsQuery.data?.metrics
  const qos = qosQuery.data?.qos

  function exportCsv() {
    if (!a) return
    const lines = [
      ['Metric', 'Value'],
      ['Conversations', String(a.totalConversations)],
      ['Resolution rate', `${Math.round(a.resolutionRate * 100)}%`],
      ['Messages per conversation', String(a.avgConversationLength)],
      ['Handoff rate', `${Math.round(a.handoffRate * 100)}%`],
      ['Automation rate', `${Math.round(a.automationRate * 100)}%`],
      ['KB hit rate', `${Math.round(a.kbHitRate * 100)}%`],
      ['New patients', String(a.newPatients)],
      ['Returning patients', String(a.returningPatients)],
    ]
    const csv = lines.map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `analytics-${clinicId}-${from}_${to}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-md space-y-8">
      <div className="clinic-page-header">
        <div>
          <p className="clinic-eyebrow">Reporting source of truth</p>
          <h1 className="clinic-title">{t('analytics.title')}</h1>
          <p className="clinic-subtitle">
            Compare patient demand, automation effectiveness, retention, and knowledge-base coverage across the selected reporting window.
          </p>
        </div>
        <div className="clinic-toolbar">
          {isAdmin && (
            <label className="flex flex-col text-xs text-gray-500">
              {t('analytics.selectClinic')}
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
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
          <label className="flex flex-col text-xs text-gray-500">
            {t('analytics.from')}
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <label className="flex flex-col text-xs text-gray-500">
            {t('analytics.to')}
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
          </label>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!a}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('analytics.exportCsv')}
          </button>
        </div>
      </div>

      {!clinicId ? (
        <div className="clinic-empty-state text-sm">{t('analytics.empty')}</div>
      ) : (
        <>
          <CrmCommandPanel
            analytics={a}
            metrics={metrics}
            qos={qos}
            loading={analyticsQuery.isLoading || metricsQuery.isLoading || qosQuery.isLoading}
          />
          <OperationalSnapshot
            metrics={metrics}
            qos={qos}
            loading={metricsQuery.isLoading || qosQuery.isLoading}
          />

          {featuresReady && !features.advancedAnalytics ? (
            <div className="clinic-empty-state text-sm">{t('analytics.disabled')}</div>
          ) : analyticsQuery.isLoading ? (
            <div className="clinic-empty-state text-sm">{t('common.loading')}</div>
          ) : !a ? (
            <div className="clinic-empty-state text-sm">{t('common.empty')}</div>
          ) : (
            <>
              <div className="clinic-kpi-grid">
                <Card label={t('analytics.totalConversations')} value={String(a.totalConversations)} tone="teal" />
                <Card label={t('analytics.resolutionRate')} value={`${Math.round(a.resolutionRate * 100)}%`} tone="emerald" />
                <Card label={t('analytics.avgLength')} value={String(a.avgConversationLength)} tone="cyan" />
                <Card label={t('analytics.handoffRate')} value={`${Math.round(a.handoffRate * 100)}%`} tone="amber" />
                <Card label={t('analytics.automationRate')} value={`${Math.round(a.automationRate * 100)}%`} tone="violet" />
                <Card label={t('analytics.kbHitRate')} value={`${Math.round(a.kbHitRate * 100)}%`} tone="teal" />
                <Card label={t('analytics.newPatients')} value={String(a.newPatients)} tone="cyan" />
                <Card label={t('analytics.returningPatients')} value={String(a.returningPatients)} tone="emerald" />
              </div>

              <div className="clinic-chart-grid">
                <ConversationTrend
                  title="Conversation trend"
                  data={metrics?.conversationsPerDay ?? []}
                  empty={t('common.empty')}
                />
                <PatientMixDonut
                  title={t('analytics.retention')}
                  newPatients={a.newPatients}
                  returning={a.returningPatients}
                />
              </div>
              {metrics ? <MetricsDeepDive metrics={metrics} /> : null}
              <RateGaugeGrid
                rates={[
                  { label: t('analytics.resolutionRate'), value: a.resolutionRate, color: CHART.green },
                  { label: t('analytics.handoffRate'), value: a.handoffRate, color: CHART.orange },
                  { label: t('analytics.automationRate'), value: a.automationRate, color: CHART.blue },
                  { label: t('analytics.kbHitRate'), value: a.kbHitRate, color: CHART.purple },
                ]}
              />
              <Heatmap title={t('analytics.peakHours')} data={a.peakHours} empty={t('common.empty')} />
            </>
          )}
        </>
      )}
      </div>
    </div>
  )
}

function MetricsDeepDive({ metrics }: { metrics: ClinicMetrics }) {
  const { t } = useI18n()
  return (
    <section className="clinic-card clinic-chart-card">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Metrics detail</h2>
          <p className="mt-1 text-xs text-gray-500">Channel mix, resolution split, and top patient intents in one reporting panel.</p>
        </div>
        <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-medium text-cyan-700 dark:bg-cyan-950/45 dark:text-cyan-200">
          {t('metrics.windowDays', { days: 30 })}
        </span>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <MetricBars
          title={t('metrics.byChannel')}
          rows={metrics.conversationsByChannel.map((item) => ({
            label: t(`metrics.channel.${item.channel}` as Parameters<typeof t>[0]) || item.channel,
            value: item.count,
          }))}
          empty={t('metrics.noData')}
        />
        <MetricBars
          title="Resolution split"
          rows={[
            { label: 'AI', value: metrics.resolutionSplit.bot },
            { label: 'Human', value: metrics.resolutionSplit.human },
            { label: 'Urgent', value: metrics.resolutionSplit.urgent },
          ]}
          empty={t('metrics.noData')}
        />
        <MetricBars
          title={t('metrics.topIntents')}
          rows={metrics.topIntents.map((item) => ({ label: item.intent, value: item.count }))}
          empty={t('metrics.noData')}
        />
      </div>
    </section>
  )
}

function MetricBars({
  title,
  rows,
  empty,
}: {
  title: string
  rows: Array<{ label: string; value: number }>
  empty: string
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <div className="rounded-lg border border-gray-100 bg-white/55 p-4 dark:border-gray-800 dark:bg-slate-900/35">
      <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h3>
      {total === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-gray-700 dark:text-gray-200">{row.label}</span>
                <span className="shrink-0 text-xs font-semibold text-gray-500">{row.value}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div className="h-full rounded-full bg-cyan-500" style={{ width: `${(row.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function pct(value: number | undefined): string {
  return value === undefined ? '-' : `${Math.round(value * 100)}%`
}

function seconds(value: number | undefined): string {
  if (value === undefined) return '-'
  if (value < 60) return `${value}s`
  return `${Math.round(value / 60)}m`
}

function CrmCommandPanel({
  analytics,
  metrics,
  qos,
  loading,
}: {
  analytics: AdvancedAnalytics | undefined
  metrics: ClinicMetrics | undefined
  qos: ClinicQos | undefined
  loading: boolean
}) {
  const split = metrics?.resolutionSplit
  const resolvedTotal = split ? split.bot + split.human + split.urgent : 0
  const containment = split && resolvedTotal > 0 ? split.bot / resolvedTotal : undefined
  const returningTotal = analytics ? analytics.newPatients + analytics.returningPatients : 0
  const returningShare = analytics && returningTotal > 0 ? analytics.returningPatients / returningTotal : undefined
  const cards = [
    {
      label: 'Patient demand',
      value: analytics ? String(analytics.totalConversations) : '-',
      detail: 'Conversations in selected range',
      tone: 'teal',
    },
    {
      label: 'Booking pipeline',
      value: pct(metrics?.bookingConversionRate),
      detail: `${metrics?.bookings ?? '-'} booked from ${metrics?.leads ?? '-'} leads`,
      tone: 'emerald',
    },
    {
      label: 'Service health',
      value: seconds(metrics?.avgResponseSeconds),
      detail: `${qos?.pendingFollowUps ?? '-'} pending follow-ups`,
      tone: 'amber',
    },
    {
      label: 'AI containment',
      value: pct(containment),
      detail: `${qos?.upsetUnresolved ?? '-'} unresolved upset conversations`,
      tone: 'cyan',
    },
  ] as const

  return (
    <section className="clinic-card overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1.05fr_1.4fr]">
        <div className="border-b border-gray-100 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-5 dark:border-gray-800 dark:from-cyan-950/25 dark:via-[var(--crm-card-bg)] dark:to-blue-950/20 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">CRM command center</p>
              <h2 className="mt-2 text-xl font-bold text-gray-950 dark:text-gray-50">Clinic performance at a glance</h2>
            </div>
            {loading ? <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs text-gray-500 dark:bg-slate-900/70">Syncing</span> : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-300">
            A single reporting cockpit for patient demand, booking conversion, service recovery, and automation quality.
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
            <SummaryStat label="Returning patients" value={pct(returningShare)} />
            <SummaryStat label="No response risk" value={pct(metrics?.noResponseRate)} />
          </div>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {cards.map((card) => (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-white/70 p-4 dark:border-gray-800 dark:bg-slate-900/45">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-gray-500">{card.label}</p>
                <span className={`h-2.5 w-2.5 rounded-full ${card.tone === 'teal' ? 'bg-cyan-500' : card.tone === 'emerald' ? 'bg-emerald-500' : card.tone === 'amber' ? 'bg-orange-500' : 'bg-blue-500'}`} />
              </div>
              <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-gray-50">{card.value}</p>
              <p className="mt-1 text-xs text-gray-500">{card.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/65 p-3 dark:border-white/10 dark:bg-slate-950/30">
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-950 dark:text-gray-50">{value}</p>
    </div>
  )
}

function OperationalSnapshot({
  metrics,
  qos,
  loading,
}: {
  metrics: ClinicMetrics | undefined
  qos: ClinicQos | undefined
  loading: boolean
}) {
  const { t } = useI18n()
  const split = metrics?.resolutionSplit
  const resolvedTotal = split ? split.bot + split.human + split.urgent : 0
  const containment = split && resolvedTotal > 0 ? split.bot / resolvedTotal : undefined
  const responseScore =
    metrics?.avgResponseSeconds === undefined ? undefined : Math.max(0, Math.min(1, 1 - metrics.avgResponseSeconds / 900))
  const workloadMax = Math.max(1, qos?.pendingFollowUps ?? 0, qos?.upsetUnresolved ?? 0, Math.round((metrics?.transferRate ?? 0) * 100), Math.round((metrics?.noResponseRate ?? 0) * 100))

  return (
    <section className="clinic-card clinic-chart-card">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{t('analytics.opsTitle')}</h2>
          <p className="mt-1 text-xs text-gray-500">Visual snapshot of service speed, conversion, containment, and operational risk.</p>
        </div>
        {loading && <span className="text-xs text-gray-400">{t('common.loading')}</span>}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr]">
        <div className="grid gap-4 sm:grid-cols-3">
          <SnapshotGauge
            label={t('analytics.ops.responseTime')}
            value={responseScore}
            display={seconds(metrics?.avgResponseSeconds)}
            color={CHART.purple}
            caption="Faster is better"
          />
          <SnapshotGauge
            label={t('analytics.ops.bookingConversion')}
            value={metrics?.bookingConversionRate}
            display={pct(metrics?.bookingConversionRate)}
            color={CHART.green}
            caption={`${metrics?.bookings ?? '-'} bookings`}
          />
          <SnapshotGauge
            label={t('analytics.ops.aiContainment')}
            value={containment}
            display={pct(containment)}
            color={CHART.blue}
            caption="Resolved by AI"
          />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white/55 p-4 dark:border-gray-800 dark:bg-slate-900/35">
          <h3 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">Operational load</h3>
          <div className="space-y-4">
            <SnapshotBar label={t('analytics.ops.pendingReminders')} value={qos?.pendingFollowUps} max={workloadMax} color="bg-cyan-500" />
            <SnapshotBar label={t('analytics.ops.upsetOpen')} value={qos?.upsetUnresolved} max={workloadMax} color="bg-rose-500" />
            <SnapshotBar label={t('analytics.ops.handoffRate')} value={metrics?.transferRate === undefined ? undefined : Math.round(metrics.transferRate * 100)} max={100} suffix="%" color="bg-orange-500" />
            <SnapshotBar label={t('analytics.ops.noResponse')} value={metrics?.noResponseRate === undefined ? undefined : Math.round(metrics.noResponseRate * 100)} max={100} suffix="%" color="bg-blue-500" />
            <SnapshotBar label={t('analytics.ops.noShowRate')} value={metrics?.noShowRate === undefined ? undefined : Math.round(metrics.noShowRate * 100)} max={100} suffix="%" color="bg-orange-500" />
          </div>
        </div>
      </div>
    </section>
  )
}

function SnapshotGauge({
  label,
  value,
  display,
  color,
  caption,
}: {
  label: string
  value: number | undefined
  display: string
  color: string
  caption: string
}) {
  const normalized = Math.max(0, Math.min(1, value ?? 0))
  const radius = 42
  const circumference = 2 * Math.PI * radius
  const dash = normalized * circumference
  return (
    <div className="rounded-xl border border-gray-100 bg-white/55 p-4 text-center dark:border-gray-800 dark:bg-slate-900/35">
      <div className="relative mx-auto h-[7.2rem] w-[7.2rem]">
        <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" role="img" aria-label={label}>
          <circle cx="56" cy="56" r={radius} fill="none" stroke="currentColor" strokeWidth="12" className="text-gray-100 dark:text-gray-800" />
          <circle
            cx="56"
            cy="56"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold">{display}</span>
          <span className="text-[10px] text-gray-500">{caption}</span>
        </div>
      </div>
      <p className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">{label}</p>
    </div>
  )
}

function SnapshotBar({
  label,
  value,
  max,
  suffix = '',
  color,
}: {
  label: string
  value: number | undefined
  max: number
  suffix?: string
  color: string
}) {
  const safeValue = value ?? 0
  const width = Math.max(2, Math.min(100, (safeValue / Math.max(1, max)) * 100))
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
        <span className="truncate text-gray-700 dark:text-gray-200">{label}</span>
        <span className="shrink-0 text-xs font-semibold text-gray-500">{value === undefined ? '-' : `${safeValue}${suffix}`}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  )
}

function Card({ label, value, tone = 'indigo' }: { label: string; value: string; tone?: CardTone }) {
  return (
    <div className={`clinic-card bg-gradient-to-br p-5 ${CARD_TONE[tone]}`}>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RetentionBar({
  title,
  newPatients,
  returning,
}: {
  title: string
  newPatients: number
  returning: number
}) {
  const total = newPatients + returning
  const newPct = total > 0 ? (newPatients / total) * 100 : 0
  return (
    <section className="clinic-card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {total === 0 ? (
        <p className="text-sm text-gray-400">—</p>
      ) : (
        <div className="space-y-2">
          <div className="flex h-6 overflow-hidden rounded">
            <div className="bg-cyan-500" style={{ width: `${newPct}%` }} />
            <div className="bg-blue-500" style={{ width: `${100 - newPct}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-gray-500">
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-cyan-500" />{newPatients}</span>
            <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-500" />{returning}</span>
          </div>
        </div>
      )}
    </section>
  )
}

function ConversationTrend({
  title,
  data,
  empty,
}: {
  title: string
  data: Array<{ date: string; count: number }>
  empty: string
}) {
  const max = Math.max(1, ...data.map((d) => d.count))
  const width = 720
  const height = 220
  const pad = 28
  const points = data.map((d, i) => {
    const x = data.length <= 1 ? width / 2 : pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = height - pad - (d.count / max) * (height - pad * 2)
    return { ...d, x, y }
  })
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area =
    points.length > 0
      ? `${line} L ${points[points.length - 1]!.x} ${height - pad} L ${points[0]!.x} ${height - pad} Z`
      : ''

  return (
    <section className="clinic-card clinic-chart-card">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs text-gray-400">30 days</span>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="min-w-0 overflow-hidden">
          <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full md:h-80" role="img" aria-label={title} preserveAspectRatio="none">
            <defs>
              <linearGradient id="analytics-trend-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={CHART.purple} stopOpacity="0.35" />
                <stop offset="100%" stopColor={CHART.purple} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
              const y = pad + tick * (height - pad * 2)
              return <line key={tick} x1={pad} x2={width - pad} y1={y} y2={y} stroke="currentColor" className="text-gray-200 dark:text-gray-800" />
            })}
            <path d={area} fill="url(#analytics-trend-fill)" />
            <path d={line} fill="none" stroke={CHART.purple} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            {points.map((p, index) => (
              <g key={p.date}>
                <circle cx={p.x} cy={p.y} r="4.5" fill={CHART.purple} />
                {(index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 6) === 0) && (
                  <text x={p.x} y={height - 6} textAnchor="middle" className="fill-gray-400 text-[11px]">
                    {p.date.slice(5)}
                  </text>
                )}
              </g>
            ))}
          </svg>
        </div>
      )}
    </section>
  )
}

function PatientMixDonut({
  title,
  newPatients,
  returning,
}: {
  title: string
  newPatients: number
  returning: number
}) {
  const total = newPatients + returning
  const data = [
    { label: 'New', value: newPatients, color: CHART.purple },
    { label: 'Returning', value: returning, color: CHART.blue },
  ]
  const slices = donutSlices(data, 40)
  return (
    <section className="clinic-card clinic-chart-card">
      <h2 className="mb-5 text-sm font-semibold">{title}</h2>
      {total === 0 ? (
        <p className="text-sm text-gray-400">-</p>
      ) : (
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative h-[10.4rem] w-[10.4rem]">
            <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={title}>
              {slices.map((s) => (
                <circle
                  key={s.label}
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={s.color}
                  strokeWidth="22"
                  strokeDasharray={`${s.length} ${s.gap}`}
                  strokeDashoffset={s.offset}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-xl font-bold">{Math.round((returning / total) * 100)}%</span>
              <span className="text-[11px] text-gray-500">returning</span>
            </div>
          </div>
          <ul className="min-w-36 flex-1 space-y-2 text-sm">
            {data.map((item) => (
              <li key={item.label} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </span>
                <span className="font-semibold">{item.value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function RateGaugeGrid({
  rates,
}: {
  rates: Array<{ label: string; value: number; color: string }>
}) {
  return (
    <section className="clinic-card clinic-chart-card">
      <h2 className="mb-6 text-sm font-semibold">Performance gauges</h2>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {rates.map((rate) => (
          <Gauge key={rate.label} {...rate} />
        ))}
      </div>
    </section>
  )
}

function Gauge({ label, value, color }: { label: string; value: number; color: string }) {
  const pctValue = Math.max(0, Math.min(1, value))
  const circumference = 2 * Math.PI * 36
  const dash = pctValue * circumference
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-gray-100 bg-white/60 p-4 text-center dark:border-gray-800 dark:bg-slate-900/40">
      <div className="relative h-[6.4rem] w-[6.4rem]">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={label}>
          <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="12" className="text-gray-100 dark:text-gray-800" />
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-lg font-bold">
          {Math.round(pctValue * 100)}%
        </div>
      </div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
    </div>
  )
}

function donutSlices(data: Array<{ label: string; value: number; color: string }>, r: number) {
  const circumference = 2 * Math.PI * r
  const total = Math.max(1, data.reduce((sum, item) => sum + item.value, 0))
  let offset = 0
  return data.map((item) => {
    const length = (item.value / total) * circumference
    const slice = {
      ...item,
      length,
      gap: circumference - length,
      offset: -offset,
    }
    offset += length
    return slice
  })
}

function Heatmap({
  title,
  data,
  empty,
}: {
  title: string
  data: AdvancedAnalytics['peakHours']
  empty: string
}) {
  const grid = useMemo(() => {
    const map = new Map<string, number>()
    let max = 0
    for (const cell of data) {
      map.set(`${cell.dayOfWeek}-${cell.hour}`, cell.count)
      if (cell.count > max) max = cell.count
    }
    return { map, max: Math.max(1, max) }
  }, [data])

  return (
    <section className="clinic-card clinic-chart-card overflow-x-auto">
      <h2 className="mb-5 text-sm font-semibold">{title}</h2>
      {data.length === 0 ? (
        <p className="text-sm text-gray-400">{empty}</p>
      ) : (
        <div className="inline-block">
          <div className="flex">
            <div className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="w-4 text-center text-[8px] text-gray-400">
                {h % 6 === 0 ? h : ''}
              </div>
            ))}
          </div>
          {WEEKDAYS.map((label, dow) => (
            <div key={dow} className="flex items-center">
              <div className="w-10 text-[10px] text-gray-500">{label}</div>
              {Array.from({ length: 24 }, (_, hour) => {
                const count = grid.map.get(`${dow}-${hour}`) ?? 0
                const intensity = count / grid.max
                return (
                  <div
                    key={hour}
                    title={`${label} ${hour}:00 — ${count}`}
                    className="m-px h-4 w-4 rounded-sm"
                    style={{
                      backgroundColor:
                        count === 0 ? 'rgba(139,92,246,0.06)' : `rgba(139,92,246,${0.15 + intensity * 0.85})`,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
