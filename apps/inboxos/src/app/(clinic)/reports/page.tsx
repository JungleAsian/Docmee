'use client'

// Req 37 â€” Automatic reports (Screen 16). The "panel" delivery channel for the
// scheduled reports the reports worker generates (daily 08:00 / weekly Monday
// 09:00). A read-only delivery HISTORY: a schedule summary banner (the cadence +
// recipient are worker/Settings-driven, surfaced read-only here), filterable list
// of past reports with daily/weekly type pills and a derived delivery badge
// (emailed / not emailed / send failed), and a right-side slide-over that renders
// the report HTML that was emailed, with its recipient + delivery status.
// clinic_admin and ia_studio_admin only.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ArrowClockwise, ArrowRight, Buildings, CalendarBlank, CalendarCheck, CheckCircle, Circle, DownloadSimple, EnvelopeSimple, FolderOpen, LockKey, MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { useAuthStore } from '@/shared/store/auth'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useOnline } from '@/shared/hooks/useOnline'
import { rolesWith } from '@/shared/permissions'
import { useI18n } from '@/shared/hooks/useI18n'
import { reportDelivery, type DeliveryState } from '@/shared/reportDelivery'
import type { Clinic, GeneratedReport, ReportSummary, ReportType } from '@/shared/types'

type TypeFilter = 'all' | ReportType
type DeliveryFilter = 'all' | 'emailed' | 'notEmailed'
type ReportFormat = 'html' | 'pdf' | 'csv'

interface ReportSettings {
  enabled: boolean
  frequency: ReportType
  recipients: string[]
  format: ReportFormat
  hourLocal: number
}

export default function ReportsPage() {
  const { t } = useI18n()
  // Req 2: mirror the API's clinic_admin/ia_studio_admin gate at the page level.
  // A wrong-role user is redirected to /inbox by the guard (permission-denied).
  const { ready } = useAuthGuard(rolesWith('reports'))
  const user = useAuthStore((s) => s.user)
  const online = useOnline()
  const isAdmin = user?.role === 'ia_studio_admin'
  // Studio admins start on the "select a clinic" state (they operate many tenants);
  // a clinic_admin is scoped to their own clinic, so it loads straight away.
  const [clinicId, setClinicId] = useState<string>(isAdmin ? '' : (user?.clinicId ?? ''))
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [deliveryFilter, setDeliveryFilter] = useState<DeliveryFilter>('all')

  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    enabled: isAdmin,
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })

  const reportsQuery = useQuery({
    queryKey: ['reports', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ reports: ReportSummary[] }>(`/clinics/${clinicId}/reports`),
  })
  const reports = useMemo(() => reportsQuery.data?.reports ?? [], [reportsQuery.data])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reports.filter((r) => {
      if (typeFilter !== 'all' && r.type !== typeFilter) return false
      const state = reportDelivery(r)
      if (deliveryFilter === 'emailed' && state !== 'sent') return false
      if (deliveryFilter === 'notEmailed' && state === 'sent') return false
      if (q && !r.subject.toLowerCase().includes(q)) return false
      return true
    })
  }, [reports, search, typeFilter, deliveryFilter])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  const hasReports = reports.length > 0

  return (
    <div className="clinic-surface">
      <div className="clinic-page space-y-5">
        {/* Header */}
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">Scheduled clinic summaries</p>
            <h1 className="clinic-title">{t('reports.title')}</h1>
            <p className="clinic-subtitle">{t('reports.desc')}</p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <select
                value={clinicId}
                onChange={(e) => setClinicId(e.target.value)}
                aria-label={t('reports.selectClinic')}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">{t('reports.selectClinic')}</option>
                {(clinicsQuery.data?.clinics ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => exportReportsCsv(filtered, t)}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
            >
              <DownloadSimple className="h-4 w-4" aria-hidden /> {t('reports.export')}
            </button>
          </div>
        </div>

        {/* Schedule summary banner */}
        <div className="clinic-card flex flex-wrap items-center gap-x-6 gap-y-4 bg-gradient-to-b from-white to-gray-50 p-4 dark:from-gray-900 dark:to-gray-900/60">
          <SchedItem
            icon={<CalendarBlank className="h-5 w-5" aria-hidden />}
            iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
            k={t('reports.sched.daily')}
            v={t('reports.sched.dailyTime')}
            note={t('reports.sched.dailyNote')}
          />
          <span className="hidden h-9 w-px self-center bg-gray-200 sm:block dark:bg-gray-800" />
          <SchedItem
            icon={<CalendarCheck className="h-5 w-5" aria-hidden />}
            iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300"
            k={t('reports.sched.weekly')}
            v={t('reports.sched.weeklyTime')}
            note={t('reports.sched.weeklyNote')}
          />
          <span className="hidden h-9 w-px self-center bg-gray-200 sm:block dark:bg-gray-800" />
          <SchedItem
            icon={<EnvelopeSimple className="h-5 w-5" aria-hidden />}
            iconClass="bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300"
            k={t('reports.sched.recipient')}
            v="Configured below"
          />
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400">
            <LockKey className="h-3.5 w-3.5" aria-hidden /> {t('reports.sched.managed')}
          </span>
        </div>

        {/* Toolbar: search + type + delivery filters + refresh */}
        <div className="clinic-toolbar">
          <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm sm:max-w-xs dark:border-gray-700 dark:bg-gray-800">
            <MagnifyingGlass className="h-4 w-4 text-gray-400" aria-hidden />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('reports.search')}
              className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          <Segmented
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: t('reports.filter.all') },
              { value: 'daily', label: reportTypeLabel(t, 'daily') },
              { value: 'weekly', label: reportTypeLabel(t, 'weekly') },
              { value: 'monthly', label: reportTypeLabel(t, 'monthly') },
            ]}
          />
          <Segmented
            value={deliveryFilter}
            onChange={setDeliveryFilter}
            options={[
              { value: 'all', label: t('reports.filter.allDelivery') },
              { value: 'emailed', label: t('reports.filter.emailed') },
              { value: 'notEmailed', label: t('reports.filter.notEmailed') },
            ]}
          />
          <button
            type="button"
            onClick={() => reportsQuery.refetch()}
            disabled={!clinicId || reportsQuery.isFetching}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
          >
            <ArrowClockwise className={`h-4 w-4 ${reportsQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden /> {t('reports.refresh')}
          </button>
        </div>

        {!online && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <b>{t('conn.offline.title')}</b> - {t('conn.offline.body')}
          </div>
        )}

        {clinicId && <ReportSettingsPanel clinicId={clinicId} />}

        {/* States */}
        {isAdmin && !clinicId ? (
          <PickClinicState title={t('reports.pick.title')} body={t('reports.pick.body')} />
        ) : reportsQuery.isLoading ? (
          <LoadingState />
        ) : reportsQuery.isError ? (
          <ErrorState
            title={t('reports.error.title')}
            body={t('reports.error.body')}
            retry={t('common.retry')}
            onRetry={() => reportsQuery.refetch()}
          />
        ) : !hasReports ? (
          <EmptyState title={t('reports.empty')} body={t('reports.emptyBody')} />
        ) : (
          <>
            <p className="text-xs font-medium text-gray-400">{t('reports.count', { n: filtered.length })}</p>

            {filtered.length === 0 ? (
              <div className="clinic-empty-state text-sm">
                {t('reports.noMatch')}
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="clinic-card hidden overflow-hidden lg:block">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left text-[10px] font-bold uppercase tracking-wide text-gray-400 dark:border-gray-800 dark:bg-gray-800/40">
                        <th className="w-28 px-4 py-3">{t('reports.col.type')}</th>
                        <th className="px-4 py-3">{t('reports.col.report')}</th>
                        <th className="px-4 py-3">{t('reports.col.period')}</th>
                        <th className="px-4 py-3">{t('reports.col.generated')}</th>
                        <th className="px-4 py-3">{t('reports.col.delivery')}</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr
                          key={r.id}
                          className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 dark:border-gray-800/70 dark:hover:bg-gray-800/30"
                        >
                          <td className="px-4 py-3.5">
                            <TypePill type={r.type} label={reportTypeLabel(t, r.type)} />
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-gray-700 dark:text-gray-200">{r.subject}</td>
                          <td className="px-4 py-3.5 text-gray-500 dark:text-gray-400">
                            {formatRange(r.periodStart, r.periodEnd)}
                          </td>
                          <td className="px-4 py-3.5 text-gray-400">{formatDate(r.createdAt)}</td>
                          <td className="px-4 py-3.5">
                            <DeliveryBadge state={reportDelivery(r)} />
                          </td>
                          <td className="px-4 py-3.5 text-right">
                            <button
                              type="button"
                              onClick={() => setOpenId(r.id)}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400"
                            >
                              {t('reports.view')} <ArrowRight className="h-4 w-4" aria-hidden />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Mobile stacked cards */}
                <div className="space-y-3 lg:hidden">
                  {filtered.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setOpenId(r.id)}
                      className="block w-full rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm dark:border-gray-800 dark:bg-gray-900"
                    >
                <TypePill type={r.type} label={reportTypeLabel(t, r.type)} />
                      <p className="mt-2 font-semibold text-gray-700 dark:text-gray-200">{r.subject}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatRange(r.periodStart, r.periodEnd)}</p>
                      <p className="text-xs text-gray-400">
                        {t('reports.generated')} {formatDate(r.createdAt)}
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                        <DeliveryBadge state={reportDelivery(r)} />
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-teal-600 dark:text-teal-400">{t('reports.view')} <ArrowRight className="h-4 w-4" aria-hidden /></span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Legend */}
            <div className="clinic-card flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
              <span className="font-bold uppercase tracking-wide text-gray-400">{t('reports.legend')}</span>
              <span className="inline-flex items-center gap-1.5">
                <DeliveryBadge state="sent" /> {t('reports.delivery.sentHint')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <DeliveryBadge state="notsent" /> {t('reports.delivery.notsentHint')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <DeliveryBadge state="failed" /> {t('reports.delivery.failedHint')}
              </span>
            </div>
          </>
        )}
      </div>

      {openId && clinicId && (
        <ReportViewer clinicId={clinicId} reportId={openId} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

// â”€â”€ Schedule banner item â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SchedItem({
  icon,
  iconClass,
  k,
  v,
  note,
}: {
  icon: ReactNode
  iconClass: string
  k: string
  v: string
  note?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${iconClass}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{k}</p>
        <p className="truncate text-sm font-semibold text-gray-700 dark:text-gray-200">
          {v}
          {note && <span className="font-normal text-gray-400"> - {note}</span>}
        </p>
      </div>
    </div>
  )
}

// â”€â”€ Segmented filter control â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ReportSettingsPanel({ clinicId }: { clinicId: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState<ReportSettings | null>(null)
  const [recipientsText, setRecipientsText] = useState('')
  const query = useQuery({
    queryKey: ['report-settings', clinicId],
    queryFn: () => api.get<{ settings: ReportSettings }>(`/clinics/${clinicId}/reports/settings`),
  })
  const mutation = useMutation({
    mutationFn: (settings: ReportSettings) => api.patch(`/clinics/${clinicId}/reports/settings`, settings),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['report-settings', clinicId] })
      qc.invalidateQueries({ queryKey: ['reports', clinicId] })
    },
  })

  useEffect(() => {
    if (!query.data?.settings) return
    setDraft(query.data.settings)
    setRecipientsText(query.data.settings.recipients.join('\n'))
  }, [query.data?.settings])

  if (query.isLoading || !draft) {
    return <div className="clinic-card h-24 animate-pulse bg-gray-50 dark:bg-gray-900" aria-busy="true" />
  }

  const recipients = recipientsText
    .split(/[\n,;]/)
    .map((value) => value.trim())
    .filter(Boolean)
  const invalidRecipients = recipients.some((value) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
  const canSave = !invalidRecipients && recipients.length <= 20

  return (
    <section className="clinic-card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold">Scheduled report settings</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Controls the worker cadence, recipients, and stored export format.</p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
            className="h-4 w-4 rounded border-gray-300 text-teal-600"
          />
          Enabled
        </label>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className="space-y-1 text-xs font-semibold text-gray-500">
          Frequency
          <select
            value={draft.frequency}
            onChange={(e) => setDraft({ ...draft, frequency: e.target.value as ReportType })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </label>
        <label className="space-y-1 text-xs font-semibold text-gray-500">
          Local hour
          <input
            type="number"
            min={0}
            max={23}
            value={draft.hourLocal}
            onChange={(e) => setDraft({ ...draft, hourLocal: Number(e.target.value) })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>
        <label className="space-y-1 text-xs font-semibold text-gray-500">
          Format
          <select
            value={draft.format}
            onChange={(e) => setDraft({ ...draft, format: e.target.value as ReportFormat })}
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="html">HTML</option>
            <option value="pdf">PDF metadata</option>
            <option value="csv">CSV metadata</option>
          </select>
        </label>
        <div className="flex items-end">
          <button
            type="button"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate({ ...draft, recipients })}
            className="w-full rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            Save settings
          </button>
        </div>
      </div>
      <label className="block space-y-1 text-xs font-semibold text-gray-500">
        Recipients
        <textarea
          value={recipientsText}
          onChange={(e) => setRecipientsText(e.target.value)}
          rows={2}
          placeholder="one@email.com\ntwo@email.com"
          className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm font-normal text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>
      {invalidRecipients && <p className="text-xs text-red-600">One or more recipients is not a valid email address.</p>}
      {mutation.isSuccess && <p className="text-xs text-emerald-600">Report settings saved.</p>}
    </section>
  )
}

function reportTypeLabel(t: ReturnType<typeof useI18n>['t'], type: ReportType): string {
  if (type === 'monthly') return 'Monthly'
  return t(`reports.type.${type}` as Parameters<typeof t>[0])
}
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-gray-300 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-3 py-2 text-xs font-semibold ${i > 0 ? 'border-l border-gray-200 dark:border-gray-700' : ''} ${
            value === o.value
              ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300'
              : 'text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// â”€â”€ Type pill (daily / weekly) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function TypePill({ type, label }: { type: ReportType; label: string }) {
  const daily = type === 'daily'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
        daily
          ? 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
          : 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${daily ? 'bg-teal-500' : 'bg-teal-500'}`} />
      {label}
    </span>
  )
}

// â”€â”€ Delivery badge (sent / notsent / failed) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DELIVERY_STYLE: Record<DeliveryState, string> = {
  sent: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  notsent: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  failed: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300',
}
const DELIVERY_KEY: Record<DeliveryState, string> = {
  sent: 'reports.delivery.sent',
  notsent: 'reports.delivery.notsent',
  failed: 'reports.delivery.failed',
}

function DeliveryBadge({ state }: { state: DeliveryState }) {
  const { t } = useI18n()
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${DELIVERY_STYLE[state]}`}
    >
      {state === 'sent' && <CheckCircle className="h-3.5 w-3.5" weight="fill" aria-hidden />}
      {state === 'notsent' && <Circle className="h-3.5 w-3.5" weight="bold" aria-hidden />}
      {state === 'failed' && <XCircle className="h-3.5 w-3.5" weight="fill" aria-hidden />}
      {t(DELIVERY_KEY[state] as Parameters<typeof t>[0])}
    </span>
  )
}

// â”€â”€ Slide-over: rendered report + delivery status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function ReportViewer({
  clinicId,
  reportId,
  onClose,
}: {
  clinicId: string
  reportId: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['report', clinicId, reportId],
    queryFn: () => api.get<{ report: GeneratedReport }>(`/clinics/${clinicId}/reports/${reportId}`),
  })
  const report = query.data?.report
  const state = report ? reportDelivery(report) : null

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label={t('reports.close')} onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div className="relative z-10 flex h-full w-full max-w-xl flex-col bg-white shadow-xl dark:bg-gray-900">
        {/* Head */}
        <div className="flex items-start gap-3 border-b border-gray-200 p-5 dark:border-gray-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-bold">{report?.subject ?? t('reports.title')}</h2>
            {report && (
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {formatRange(report.periodStart, report.periodEnd)} Â· {t('reports.generated')} {formatDate(report.createdAt)}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('reports.close')}
            className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            âœ•
          </button>
        </div>

        {/* Delivery strip */}
        {report && state && (
          <div className="flex flex-wrap gap-x-8 gap-y-3 border-b border-gray-200 bg-gray-50 px-5 py-3.5 dark:border-gray-800 dark:bg-gray-800/40">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('reports.recipient')}</p>
              <p className="mt-0.5 text-sm font-semibold">{report.recipientEmail || t('reports.noRecipient')}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('reports.delivery.label')}</p>
              <div className="mt-0.5">
                <DeliveryBadge state={state} />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t('reports.type.label')}</p>
              <div className="mt-0.5">
                <TypePill type={report.type} label={reportTypeLabel(t, report.type)} />
              </div>
            </div>
          </div>
        )}

        {/* Rendered report HTML (the email body) */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-5 dark:bg-gray-950">
          {query.isLoading || !report ? (
            <p className="text-sm text-gray-400">{t('reports.loadingOne')}</p>
          ) : query.isError ? (
            <p className="text-sm text-red-500">{t('reports.error.title')}</p>
          ) : (
            <div
              className="clinic-card prose prose-sm max-w-none p-5 dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: report.html }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// â”€â”€ States â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function LoadingState() {
  return (
    <div className="clinic-card overflow-hidden" aria-busy="true">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-gray-100 p-4 last:border-0 dark:border-gray-800/70">
          <div className="h-5 w-16 animate-pulse rounded-full bg-gray-100 dark:bg-gray-800" />
          <div className="h-3 flex-1 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          <div className="h-6 w-20 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="clinic-card flex flex-col items-center justify-center gap-2 p-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300"><FolderOpen className="h-6 w-6" aria-hidden /></div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="max-w-xs text-xs text-gray-500 dark:text-gray-400">{body}</p>
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
    <div className="clinic-card flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-2xl dark:bg-red-950/40">!</div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{body}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        <ArrowClockwise className="h-4 w-4" aria-hidden /> {retry}
      </button>
    </div>
  )
}

function PickClinicState({ title, body }: { title: string; body: string }) {
  return (
    <div className="clinic-card flex flex-col items-center justify-center gap-2 p-10 text-center">
      <span className="mb-1 inline-flex items-center rounded bg-teal-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
        Admin Studio
      </span>
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300"><Buildings className="h-6 w-6" aria-hidden /></div>
      <h4 className="text-sm font-bold">{title}</h4>
      <p className="max-w-sm text-xs text-gray-500 dark:text-gray-400">{body}</p>
    </div>
  )
}

// â”€â”€ CSV export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function exportReportsCsv(reports: ReportSummary[], t: ReturnType<typeof useI18n>['t']): void {
  const header = [
    t('reports.col.type'),
    t('reports.col.report'),
    t('reports.col.period'),
    t('reports.col.generated'),
    t('reports.col.delivery'),
    t('reports.recipient'),
  ]
  const stateLabel: Record<DeliveryState, string> = {
    sent: t('reports.delivery.sent'),
    notsent: t('reports.delivery.notsent'),
    failed: t('reports.delivery.failed'),
  }
  const rows = reports.map((r) => [
    reportTypeLabel(t, r.type),
    r.subject,
    formatRange(r.periodStart, r.periodEnd),
    formatDate(r.createdAt),
    stateLabel[reportDelivery(r)],
    r.recipientEmail ?? '',
  ])
  const csv = [header, ...rows].map((cols) => cols.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }) // BOM so Excel reads ES accents
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'docmee-reports.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

// â”€â”€ Date helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso)
  const end = new Date(endIso)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-'
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }
  return `${start.toLocaleDateString(undefined, opts)} - ${end.toLocaleDateString(undefined, opts)}`
}


