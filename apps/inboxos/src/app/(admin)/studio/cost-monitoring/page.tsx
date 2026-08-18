'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useAuthStore } from '@/shared/store/auth'
import type { ClinicMetrics, ClinicStats, ClinicUsage, ClinicUsageRow } from '@/shared/types'

const CHART = {
  orange: '#F97316',
  red: '#EF4444',
  blue: '#3B82F6',
  purple: '#34c6e5',
  green: '#10B981',
}

const USD_TO_CAD = 1.419
const USD_TO_GTQ = 7.629
const WHATSAPP_CONVERSATION_USD = 0.018
const ACTIVE_CONVERSATION_OPS_USD = 0.01
const PATIENT_STORAGE_USD = 0.003

function money(value: number, currency: 'USD' | 'CAD' | 'GTQ') {
  const converted = currency === 'USD' ? value : currency === 'CAD' ? value * USD_TO_CAD : value * USD_TO_GTQ
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: converted > 0 && converted < 1 ? 4 : 2,
  }).format(converted)
}

function num(value: number) {
  return value.toLocaleString('en-US')
}

function pct(value: number) {
  return `${Math.round(value * 100)}%`
}

export default function CostMonitoringPage() {
  const { clinicId, switchClinic } = useActiveClinic()
  const user = useAuthStore((state) => state.user)
  const isSuperuser = user?.role === 'ia_studio_admin'
  const [currency, setCurrency] = useState<'USD' | 'CAD' | 'GTQ'>('USD')

  const statsQuery = useQuery({
    queryKey: ['stats', clinicId],
    enabled: Boolean(clinicId) && isSuperuser,
    queryFn: () => api.get<{ stats: ClinicStats }>(`/clinics/${clinicId}/stats`),
  })
  const usageQuery = useQuery({
    queryKey: ['usage', clinicId],
    enabled: Boolean(clinicId) && isSuperuser,
    queryFn: () => api.get<{ usage: ClinicUsage }>(`/clinics/${clinicId}/usage`),
  })
  const metricsQuery = useQuery({
    queryKey: ['metrics', clinicId, 30],
    enabled: Boolean(clinicId) && isSuperuser,
    queryFn: () => api.get<{ metrics: ClinicMetrics }>(`/clinics/${clinicId}/metrics?window=30`),
  })
  const breakdownQuery = useQuery({
    queryKey: ['usage-summary'],
    enabled: isSuperuser,
    queryFn: () => api.get<{ clinics: ClinicUsageRow[] }>('/usage/summary'),
  })

  const stats = statsQuery.data?.stats
  const usage = usageQuery.data?.usage
  const metrics = metricsQuery.data?.metrics
  const platform = breakdownQuery.data?.clinics ?? []

  const whatsappConversations = metrics?.conversationsByChannel.find((item) => item.channel === 'whatsapp')?.count ?? 0
  const aiCost = usage?.totalCostUsd ?? 0
  const whatsappCost = whatsappConversations * WHATSAPP_CONVERSATION_USD
  const clinicOpsCost =
    (stats?.activeConversations ?? 0) * ACTIVE_CONVERSATION_OPS_USD +
    (stats?.totalPatients ?? 0) * PATIENT_STORAGE_USD
  const totalCost = aiCost + whatsappCost + clinicOpsCost
  const costSplit = [
    { label: 'AI agent', value: aiCost, color: CHART.purple },
    { label: 'WhatsApp traffic', value: whatsappCost, color: CHART.green },
    { label: 'Clinic usage', value: clinicOpsCost, color: CHART.orange },
  ]
  const dailyTrend = useMemo(() => buildTrend(metrics, aiCost, whatsappCost, clinicOpsCost), [metrics, aiCost, whatsappCost, clinicOpsCost])
  const platformTop = platform.slice(0, 8)

  if (!isSuperuser) {
    return (
      <div className="clinic-page clinic-page-md space-y-6">
        <div className="clinic-card p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Limited access</p>
          <h1 className="mt-2 text-xl font-bold">Usage</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Usage and cost controls are managed by super users. Clinic admins can configure their clinic channels and integrations, but cannot enable, disable, or manage usage controls.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="clinic-page clinic-page-md space-y-8">
      <div className="clinic-page-header">
        <div>
          <p className="clinic-eyebrow">Cost operations</p>
          <h1 className="clinic-title">Cost monitoring</h1>
          <p className="clinic-subtitle">
            Monitor AI agent spend, WhatsApp traffic estimates, and clinic usage in USD, CAD, and Guatemalan quetzales.
          </p>
        </div>
        <div className="clinic-toolbar">
          <ClinicSelect value={clinicId} onChange={switchClinic} label="Clinic" />
          <select
            value={currency}
            onChange={(event) => setCurrency(event.target.value as 'USD' | 'CAD' | 'GTQ')}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
            <option value="GTQ">GTQ</option>
          </select>
        </div>
      </div>

      <section className="clinic-card overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_1.5fr]">
          <div className="border-b border-gray-100 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-5 dark:border-gray-800 dark:from-cyan-950/25 dark:via-[var(--crm-card-bg)] dark:to-blue-950/20 lg:border-b-0 lg:border-r">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">Monthly run-rate</p>
            <p className="mt-3 text-4xl font-bold text-gray-950 dark:text-gray-50">{money(totalCost, currency)}</p>
            <p className="mt-2 text-sm text-gray-500">
              AI is live spend from usage events. WhatsApp and clinic usage are estimates until Meta billing exports are connected.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-2 text-sm">
              <CurrencyTile label="USD" value={money(totalCost, 'USD')} />
              <CurrencyTile label="CAD" value={money(totalCost, 'CAD')} />
              <CurrencyTile label="GTQ" value={money(totalCost, 'GTQ')} />
            </div>
          </div>
          <div className="grid gap-3 p-4 sm:grid-cols-3">
            <CostCard label="AI agent" value={money(aiCost, currency)} detail={`${num(usage?.totalTokens ?? 0)} tokens`} color="bg-cyan-500" />
            <CostCard label="WhatsApp traffic" value={money(whatsappCost, currency)} detail={`${num(whatsappConversations)} WhatsApp conversations`} color="bg-emerald-500" />
            <CostCard label="Clinic usage" value={money(clinicOpsCost, currency)} detail={`${num(stats?.totalPatients ?? 0)} patients`} color="bg-amber-500" />
          </div>
        </div>
      </section>

      {!clinicId ? (
        <div className="clinic-empty-state text-sm">Select a clinic to view cost monitoring.</div>
      ) : statsQuery.isLoading || usageQuery.isLoading || metricsQuery.isLoading ? (
        <div className="clinic-empty-state text-sm">Loading cost data...</div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            <CostPie data={costSplit} currency={currency} total={totalCost} />
            <TrendChart data={dailyTrend} currency={currency} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ModelCostTable usage={usage} currency={currency} />
            <PlatformClinicChart rows={platformTop} currency={currency} onSelect={switchClinic} />
          </div>

          <UsageOperationsPanel
            stats={stats}
            usage={usage}
            platform={platform}
            currency={currency}
            onSelect={switchClinic}
          />

          <section className="clinic-card p-4">
            <h2 className="text-sm font-semibold">Cost assumptions</h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              This page monitors real usage counts, but the dollar figures below combine one live-billed category
              with two fixed per-unit estimates and a fixed currency conversion — not a live pricing or FX feed.
            </p>
            <div className="mt-3 grid gap-4 text-sm leading-relaxed text-gray-600 dark:text-gray-300 md:grid-cols-4">
              <p>
                AI agent cost uses the actual values recorded in Docmee's <code>ai_usage_events.cost_usd</code>
                table, together with the captured token counts for each model call. This is the most precise cost
                category because it comes from real usage events.
              </p>
              <p>
                WhatsApp traffic is estimated at {money(WHATSAPP_CONVERSATION_USD, 'USD')} for each WhatsApp
                conversation. This gives the clinic a practical planning number until the live Meta billing feed is
                connected.
              </p>
              <p>
                Clinic usage is an operational estimate based on active conversations and patient volume. It represents
                the storage, processing, and platform activity needed to keep the clinic workspace running.
              </p>
              <p>
                CAD and GTQ figures use a fixed conversion rate ({USD_TO_CAD} CAD and {USD_TO_GTQ} GTQ per USD), not a
                live exchange rate — switch to USD for the most accurate figure.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function UsageOperationsPanel({
  stats,
  usage,
  platform,
  currency,
  onSelect,
}: {
  stats: ClinicStats | undefined
  usage: ClinicUsage | undefined
  platform: ClinicUsageRow[]
  currency: 'USD' | 'CAD' | 'GTQ'
  onSelect: (id: string) => void
}) {
  return (
    <section className="clinic-card overflow-hidden">
      <div className="border-b border-gray-100 px-5 py-4 dark:border-gray-800">
        <p className="text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-200">Usage dashboard</p>
        <h2 className="mt-1 text-lg font-bold">Clinic activity and AI usage</h2>
      </div>
      <div className="grid gap-0 lg:grid-cols-[0.9fr_1.4fr]">
        <div className="grid gap-3 border-b border-gray-100 p-4 dark:border-gray-800 lg:border-b-0 lg:border-r">
          <CostCard label="Active conversations" value={num(stats?.activeConversations ?? 0)} detail="Currently open clinic workload" color="bg-blue-500" />
          <CostCard label="Total patients" value={num(stats?.totalPatients ?? 0)} detail="Patient records in this clinic" color="bg-cyan-500" />
          {typeof stats?.activeClinics === 'number' ? (
            <CostCard label="Active clinics" value={num(stats.activeClinics)} detail="Platform clinics with activity" color="bg-emerald-500" />
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2">Clinic</th>
                <th className="px-3 py-2 text-right">AI cost</th>
                <th className="px-3 py-2 text-right">Tokens</th>
                <th className="px-3 py-2 text-right">Calls</th>
              </tr>
            </thead>
            <tbody>
              {platform.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-sm text-gray-400">No clinic usage recorded yet.</td>
                </tr>
              ) : (
                platform.map((clinic) => (
                  <tr
                    key={clinic.clinicId}
                    className="cursor-pointer border-t border-gray-100 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800/50"
                    onClick={() => onSelect(clinic.clinicId)}
                  >
                    <td className="px-3 py-2 font-medium">{clinic.clinicName}</td>
                    <td className="px-3 py-2 text-right">{money(clinic.totalCostUsd, currency)}</td>
                    <td className="px-3 py-2 text-right">{num(clinic.totalTokens)}</td>
                    <td className="px-3 py-2 text-right">{num(clinic.eventCount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      {usage && usage.eventCount > 0 ? (
        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-500 dark:border-gray-800">
          Selected clinic AI usage: {money(usage.totalCostUsd, currency)} across {num(usage.eventCount)} calls and {num(usage.totalTokens)} tokens.
        </div>
      ) : null}
    </section>
  )
}

function CurrencyTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/70 bg-white/65 p-3 dark:border-white/10 dark:bg-slate-950/30">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-gray-950 dark:text-gray-50">{value}</p>
    </div>
  )
}

function CostCard({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white/70 p-4 dark:border-gray-800 dark:bg-slate-900/45">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-950 dark:text-gray-50">{value}</p>
      <p className="mt-1 text-xs text-gray-500">{detail}</p>
    </div>
  )
}

function CostPie({ data, currency, total }: { data: Array<{ label: string; value: number; color: string }>; currency: 'USD' | 'CAD' | 'GTQ'; total: number }) {
  const circumference = 2 * Math.PI * 42
  let offset = 0
  return (
    <section className="clinic-card p-5">
      <h2 className="text-sm font-semibold">Cost composition</h2>
      <div className="mt-5 flex flex-wrap items-center gap-6">
        <div className="relative h-[9.8rem] w-[9.8rem] shrink-0">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label="Cost composition pie chart">
            {data.map((item) => {
              const length = total > 0 ? (item.value / total) * circumference : 0
              const slice = (
                <circle key={item.label} cx="50" cy="50" r="42" fill="none" stroke={item.color} strokeWidth="18" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} />
              )
              offset += length
              return slice
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-lg font-bold">{money(total, currency)}</span>
            <span className="text-[10px] text-gray-500">total</span>
          </div>
        </div>
        <ul className="min-w-48 flex-1 space-y-3 text-sm">
          {data.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                {item.label}
              </span>
              <span className="font-semibold">{money(item.value, currency)} {total > 0 ? `(${pct(item.value / total)})` : ''}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function TrendChart({ data, currency }: { data: Array<{ date: string; value: number }>; currency: 'USD' | 'CAD' | 'GTQ' }) {
  const max = Math.max(1, ...data.map((item) => item.value))
  const width = 720
  const height = 240
  const pad = 28
  const points = data.map((item, index) => ({
    ...item,
    x: data.length <= 1 ? width / 2 : pad + (index / (data.length - 1)) * (width - pad * 2),
    y: height - pad - (item.value / max) * (height - pad * 2),
  }))
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const area = points.length ? `${line} L ${points[points.length - 1]!.x} ${height - pad} L ${points[0]!.x} ${height - pad} Z` : ''
  return (
    <section className="clinic-card clinic-chart-card">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Estimated daily cost trend</h2>
        <span className="text-xs text-gray-400">30 days</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full md:h-80" role="img" aria-label="Daily cost trend" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cost-monitoring-trend" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={CHART.purple} stopOpacity="0.32" />
            <stop offset="100%" stopColor={CHART.purple} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = pad + tick * (height - pad * 2)
          return <line key={tick} x1={pad} x2={width - pad} y1={y} y2={y} stroke="currentColor" className="text-gray-200 dark:text-gray-800" />
        })}
        <path d={area} fill="url(#cost-monitoring-trend)" />
        <path d={line} fill="none" stroke={CHART.purple} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => (
          <g key={point.date}>
            <circle cx={point.x} cy={point.y} r="4.5" fill={CHART.purple} />
            {(index === 0 || index === points.length - 1 || index % 6 === 0) && (
              <text x={point.x} y={height - 6} textAnchor="middle" className="fill-gray-400 text-[11px]">
                {point.date.slice(5)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <p className="mt-3 text-xs text-gray-500">Peak estimate: {money(max, currency)}</p>
    </section>
  )
}

function ModelCostTable({ usage, currency }: { usage: ClinicUsage | undefined; currency: 'USD' | 'CAD' | 'GTQ' }) {
  return (
    <section className="clinic-card overflow-hidden">
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <h2 className="text-sm font-semibold">AI model cost</h2>
      </div>
      {!usage || usage.byModel.length === 0 ? (
        <p className="p-4 text-sm text-gray-400">No model cost recorded yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
            <tr>
              <th className="px-3 py-2">Model</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2 text-right">Tokens</th>
              <th className="px-3 py-2 text-right">Calls</th>
            </tr>
          </thead>
          <tbody>
            {usage.byModel.map((model) => (
              <tr key={model.model} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-3 py-2 font-medium">{model.model}</td>
                <td className="px-3 py-2 text-right">{money(model.costUsd, currency)}</td>
                <td className="px-3 py-2 text-right">{num(model.totalTokens)}</td>
                <td className="px-3 py-2 text-right">{num(model.eventCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function PlatformClinicChart({ rows, currency, onSelect }: { rows: ClinicUsageRow[]; currency: 'USD' | 'CAD' | 'GTQ'; onSelect: (id: string) => void }) {
  const max = Math.max(1, ...rows.map((row) => row.totalCostUsd))
  return (
    <section className="clinic-card p-5">
      <h2 className="text-sm font-semibold">Platform AI spend by clinic</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">No clinic spend recorded yet.</p>
      ) : (
        <ul className="mt-5 space-y-3">
          {rows.map((row) => (
            <li key={row.clinicId}>
              <button type="button" onClick={() => onSelect(row.clinicId)} className="w-full text-left">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{row.clinicName}</span>
                  <span className="shrink-0 text-xs text-gray-500">{money(row.totalCostUsd, currency)}</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div className="h-full rounded-full bg-cyan-500" style={{ width: `${(row.totalCostUsd / max) * 100}%` }} />
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function buildTrend(metrics: ClinicMetrics | undefined, aiCost: number, whatsappCost: number, clinicOpsCost: number) {
  const base = aiCost + whatsappCost + clinicOpsCost
  const days = metrics?.conversationsPerDay?.length ? metrics.conversationsPerDay : Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.now() - (29 - index) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    return { date, count: 0 }
  })
  const totalConversations = Math.max(1, days.reduce((sum, day) => sum + day.count, 0))
  const steadyCost = base / Math.max(1, days.length)
  return days.map((day) => ({
    date: day.date,
    value: metrics ? base * (day.count / totalConversations) + steadyCost * 0.35 : steadyCost,
  }))
}
