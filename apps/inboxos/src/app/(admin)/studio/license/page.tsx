'use client'

// Admin Studio — License Management (P11). Per-clinic license status across the whole
// platform, with inline add/renew. Status is decoded by the API (display-only);
// per THE ONE RULE, nothing here ever interrupts a live clinic.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { LicenseBadge } from '@/shared/components/LicenseBadge'
import { BackButton } from '@/shared/components/BackButton'
import { useI18n } from '@/shared/hooks/useI18n'
import { useAuthStore } from '@/shared/store/auth'
import { formatDateTime } from '@/shared/format'
import type { Clinic, ClinicLicense } from '@/shared/types'

export default function LicensePage() {
  const { t } = useI18n()
  const user = useAuthStore((state) => state.user)
  const isSuperuser = user?.role === 'ia_studio_admin'
  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    enabled: isSuperuser,
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })
  const clinics = clinicsQuery.data?.clinics ?? []

  if (!isSuperuser) {
    return (
      <div className="clinic-page clinic-page-md space-y-6">
        <div className="clinic-card p-6">
          <BackButton href="/studio" label={t('nav.studio')} />
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Limited access</p>
          <h1 className="mt-2 text-xl font-bold">{t('license.title')}</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            License controls are managed by super users. Clinic admins can configure their clinic channels and integrations, but cannot add or renew licenses.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <BackButton href="/studio" label={t('nav.studio')} />
      <h1 className="mb-1 text-xl font-bold">{t('license.title')}</h1>
      <p className="mb-4 text-xs text-gray-400">{t('license.never')}</p>

      {clinicsQuery.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : clinics.length === 0 ? (
        <p className="text-sm text-gray-400">{t('studio.clinics.empty')}</p>
      ) : (
        <div className="clinic-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-900">
              <tr>
                <th className="px-3 py-2">{t('license.clinic')}</th>
                <th className="px-3 py-2">{t('license.status')}</th>
                <th className="px-3 py-2">{t('license.seats')}</th>
                <th className="px-3 py-2">{t('license.expiresAt')}</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {clinics.map((c) => (
                <LicenseRow key={c.id} clinic={c} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function LicenseRow({ clinic }: { clinic: Clinic }) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['license', clinic.id],
    queryFn: () => api.get<{ license: ClinicLicense }>(`/clinics/${clinic.id}/license`),
  })
  const license = query.data?.license

  const save = useMutation({
    mutationFn: () => api.post(`/clinics/${clinic.id}/license`, { licenseKey: key.trim() }),
    onSuccess: () => {
      setKey('')
      setError(null)
      setEditing(false)
      qc.invalidateQueries({ queryKey: ['license', clinic.id] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (key.trim()) save.mutate()
  }

  const hasLicense = license && license.state !== 'none'

  return (
    <>
      <tr className="border-t border-gray-100 dark:border-gray-800">
        <td className="px-3 py-2 font-medium">{clinic.name}</td>
        <td className="px-3 py-2">
          {query.isLoading ? (
            <span className="text-xs text-gray-400">{t('common.loading')}</span>
          ) : license ? (
            <LicenseBadge state={license.state} />
          ) : null}
        </td>
        <td className="px-3 py-2 text-gray-500">{license?.seats ?? '—'}</td>
        <td className="px-3 py-2 text-gray-500">
          {license?.expiresAt ? formatDateTime(license.expiresAt, language) : '—'}
          {license?.issuedAt && (
            <span className="mt-0.5 block text-[11px] text-gray-400">
              {t('license.issuedAt')}: {formatDateTime(license.issuedAt, language)}
            </span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {hasLicense ? t('license.renew') : t('license.add')}
          </button>
        </td>
      </tr>
      <tr className="border-t border-gray-100 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/30">
        <td colSpan={5} className="px-3 py-2">
          <LicenseOperations license={license} loading={query.isLoading} />
        </td>
      </tr>
      {editing && (
        <tr className="border-t border-gray-100 bg-gray-50 dark:border-gray-800 dark:bg-gray-900/50">
          <td colSpan={5} className="px-3 py-2">
            <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t('license.keyPlaceholder')}
                className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
              />
              <button
                type="submit"
                disabled={save.isPending || !key.trim()}
                className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {t('license.add')}
              </button>
              {error && <span className="text-xs text-red-600">{error}</span>}
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

function LicenseOperations({
  license,
  loading,
}: {
  license: ClinicLicense | undefined
  loading: boolean
}) {
  const { t } = useI18n()
  if (loading) return <span className="text-xs text-gray-400">{t('common.loading')}</span>

  const state = license?.state ?? 'none'
  const healthy = state === 'active'
  const warning = state === 'expired' || state === 'invalid' || state === 'none'

  return (
    <div className="grid gap-2 text-xs md:grid-cols-3">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
        <p className="font-semibold">{t('license.ops.continuityTitle')}</p>
        <p className="mt-0.5">{t('license.ops.continuityBody')}</p>
      </div>
      <div
        className={`rounded-md border p-2 ${
          warning
            ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300'
            : 'border-gray-200 bg-white text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300'
        }`}
      >
        <p className="font-semibold">{t('license.ops.growthTitle')}</p>
        <p className="mt-0.5">
          {healthy ? t('license.ops.growthOpen') : t('license.ops.growthRestricted')}
        </p>
      </div>
      <div
        className={`rounded-md border p-2 ${
          healthy
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300'
            : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
        }`}
      >
        <p className="font-semibold">{t('license.ops.heartbeatTitle')}</p>
        <p className="mt-0.5">
          {healthy ? t('license.ops.heartbeatOk') : t('license.ops.heartbeatWarn')}
        </p>
      </div>
    </div>
  )
}
