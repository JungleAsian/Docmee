'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { NavIcon } from '@/shared/components/NavIcon'
import { BackButton } from '@/shared/components/BackButton'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'

type CredentialState = 'pass' | 'warning' | 'fail' | 'manual'
type RotationMode = 'monitor' | 'guide' | 'validate' | 'audit'

interface CredentialItem {
  key: string
  label: string
  category: string
  state: CredentialState
  configured: boolean
  lastObservedAt: string | null
  recommendedFrequency: string
  owner: string
  validation: string
  guidance: string
  rotationMode: RotationMode[]
  manualOnly?: boolean
}

interface CredentialHealthResponse {
  checkedAt: string
  clinic: {
    id: string
    name: string
  }
  visibility: 'superuser_only'
  summary: {
    pass: number
    warning: number
    fail: number
    manual: number
    total: number
  }
  credentials: CredentialItem[]
  audit: {
    principle: string
    lastCheckedAt: string
    recordsStored: string
  }
}

const STATE_LABEL: Record<CredentialState, string> = {
  pass: 'Ready',
  warning: 'Needs review',
  fail: 'Action required',
  manual: 'Manual only',
}

const STATE_STYLE: Record<CredentialState, string> = {
  pass: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
  fail: 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
  manual: 'border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
}

const MODE_LABEL: Record<RotationMode, string> = {
  monitor: 'Monitor',
  guide: 'Guide',
  validate: 'Validate',
  audit: 'Audit',
}

function formatDate(value: string | null) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not recorded'
  return date.toLocaleString()
}

export default function CredentialHealthPage() {
  const { clinicId, switchClinic } = useActiveClinic()
  const query = useQuery({
    queryKey: ['credential-health', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<CredentialHealthResponse>('/credential-health'),
  })
  const grouped = useMemo(() => {
    const entries = query.data?.credentials ?? []
    return entries.reduce<Record<string, CredentialItem[]>>((acc, item) => {
      acc[item.category] = [...(acc[item.category] ?? []), item]
      return acc
    }, {})
  }, [query.data?.credentials])

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="clinic-page-header">
        <div>
          <BackButton href="/studio" label="Admin Studio" />
          <p className="clinic-eyebrow">Superuser only</p>
          <h1 className="clinic-title">Security & credential health</h1>
          <p className="clinic-subtitle">
            Monitor, guide, validate, and audit credential readiness. Critical infrastructure rotation stays outside the web app.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ClinicSelect value={clinicId} onChange={switchClinic} label="Clinic" />
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={!clinicId}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            Refresh checks
          </button>
        </div>
      </div>

      {!clinicId ? (
        <Empty text="Select a clinic to review its credential health." />
      ) : query.isLoading ? (
        <Empty text="Loading credential health..." />
      ) : query.isError || !query.data ? (
        <Empty text="Could not load credential health. Confirm you are logged in as a superuser." />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Kpi label="Ready" value={query.data.summary.pass} tone="emerald" />
            <Kpi label="Needs review" value={query.data.summary.warning} tone="amber" />
            <Kpi label="Action required" value={query.data.summary.fail} tone="red" />
            <Kpi label="Manual only" value={query.data.summary.manual} tone="sky" />
            <Kpi label="Total checks" value={query.data.summary.total} tone="gray" />
          </section>

          <section className="clinic-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Operating model</h2>
                <p className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                  Clinic: {query.data.clinic.name}
                </p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{query.data.audit.principle}</p>
              </div>
              <span className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                Checked {formatDate(query.data.checkedAt)}
              </span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-4">
              {(['monitor', 'guide', 'validate', 'audit'] as RotationMode[]).map((mode) => (
                <div key={mode} className="rounded-lg border border-gray-200 p-3 dark:border-gray-800">
                  <p className="text-sm font-semibold">{MODE_LABEL[mode]}</p>
                  <p className="mt-1 text-xs text-gray-500">
                    {mode === 'monitor'
                      ? 'Track readiness, age, missing values, and provider state.'
                      : mode === 'guide'
                        ? 'Show exact manual steps and ownership without exposing secrets.'
                        : mode === 'validate'
                          ? 'Run safe connection checks after a credential is changed.'
                          : 'Record review timestamps and rotation decisions without storing secret values.'}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {Object.entries(grouped).map(([category, items]) => (
            <section key={category} className="space-y-3">
              <div className="flex items-center gap-2">
                <NavIcon name="shield" />
                <h2 className="text-base font-semibold">{category}</h2>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {items.map((item) => (
                  <CredentialCard key={item.key} item={item} />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

function CredentialCard({ item }: { item: CredentialItem }) {
  return (
    <article className="clinic-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{item.label}</h3>
          <p className="mt-1 text-xs text-gray-500">Owner: {item.owner}</p>
        </div>
        <span className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${STATE_STYLE[item.state]}`}>
          {STATE_LABEL[item.state]}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-semibold text-gray-500">Last observed</dt>
          <dd className="mt-1 text-gray-900 dark:text-gray-100">{formatDate(item.lastObservedAt)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-gray-500">Frequency</dt>
          <dd className="mt-1 text-gray-900 dark:text-gray-100">{item.recommendedFrequency}</dd>
        </div>
      </dl>

      <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/50">
        <p className="text-xs font-semibold text-gray-500">Validation</p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{item.validation}</p>
      </div>

      <div className="mt-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800">
        <p className="text-xs font-semibold text-gray-500">Guidance</p>
        <p className="mt-1 text-sm text-gray-700 dark:text-gray-200">{item.guidance}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {item.rotationMode.map((mode) => (
          <span key={mode} className="rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {MODE_LABEL[mode]}
          </span>
        ))}
        {item.manualOnly ? (
          <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
            External rotation
          </span>
        ) : null}
      </div>
    </article>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'red' | 'sky' | 'gray' }) {
  const styles = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300',
    amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
    red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
    sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300',
    gray: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300',
  }[tone]
  return (
    <div className={`rounded-lg border p-4 ${styles}`}>
      <p className="text-xs font-semibold uppercase">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="clinic-card p-6 text-sm text-gray-500 dark:text-gray-400">
      {text}
    </div>
  )
}
