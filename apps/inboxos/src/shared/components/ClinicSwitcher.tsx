'use client'

// Screen 6 — tenant separation + clinic switching, rendered in the clinic shell
// header. It always names the clinic the operator is working in, so a secretary or
// doctor can never lose track of which tenant they are acting on. For an
// ia_studio_admin it becomes a switcher that re-scopes the whole operational panel
// (inbox, calendar, contextual panels) to any clinic, with an unmistakable warning
// while they are operating outside their own clinic.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { useClinics } from './ClinicSelect'
import type { Clinic } from '../types'

function ClinicIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0" fill="currentColor">
      <path d="M3 17V5a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v12h2v-7a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v7h1v1.5H1V17h2Zm3-9h3V6.5H6V8Zm0 3h3V9.5H6V11Zm0 3h3v-1.5H6V14Z" />
    </svg>
  )
}

/** Non-admin tenant chip: the read-only clinic the user belongs to. */
function TenantChip() {
  const { t } = useI18n()
  const { data, isError, refetch } = useQuery({
    queryKey: ['clinic-current'],
    queryFn: () => api.get<{ clinic: Clinic }>('/clinics/current'),
    staleTime: 5 * 60_000,
  })
  const name = data?.clinic.name
  // Don't silently fall back to "unknown" if the lookup fails — surface a
  // retryable error so the operator knows the tenant name didn't load.
  if (isError) {
    return (
      <button
        type="button"
        onClick={() => void refetch()}
        title={t('common.error')}
        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-2.5 py-1 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300 sm:max-w-[14rem]"
      >
        <ClinicIcon />
        <span className="truncate">{t('common.retry')}</span>
      </button>
    )
  }
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1 text-sm font-medium text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 sm:max-w-[14rem]"
      title={name ?? undefined}
    >
      <ClinicIcon />
      <span className="truncate">{name ?? t('tenant.unknown')}</span>
    </span>
  )
}

/** Admin switcher: a dropdown over every clinic + a cross-tenant warning. */
function AdminClinicSwitcher() {
  const { t } = useI18n()
  const { clinicId, isHome, switchClinic, homeClinicId } = useActiveClinic()
  const { data, isLoading, isError, refetch } = useClinics()
  const clinics = data?.clinics ?? []
  const current = clinics.find((c) => c.id === clinicId)

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <label className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-sm">
        <span
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            isHome
              ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              : 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
          }`}
        >
          {t('tenant.adminBadge')}
        </span>
        <span className="sr-only">{t('tenant.switch')}</span>
        <select
          value={clinicId}
          onChange={(e) => switchClinic(e.target.value)}
          disabled={isLoading}
          aria-label={t('tenant.switch')}
          style={{ fontSize: '12px' }}
          className={`min-w-0 max-w-full truncate rounded-md border px-2 py-1 text-sm font-medium outline-none focus:border-teal-500 sm:max-w-[14rem] dark:bg-gray-800 ${
            isHome
              ? 'border-gray-300 text-gray-700 dark:border-gray-700 dark:text-gray-200'
              : 'border-amber-400 text-amber-900 dark:border-amber-600 dark:text-amber-100'
          }`}
        >
          {isLoading && !current && <option value={clinicId}>{t('common.loading')}</option>}
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      {isError && (
        <button
          type="button"
          onClick={() => void refetch()}
          title={t('common.error')}
          className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
        >
          ⚠ {t('common.retry')}
        </button>
      )}

      {!isHome && (
        <>
          <span
            className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
            title={t('tenant.crossTenantHint', { clinic: current?.name ?? t('tenant.unknown') })}
          >
            ⚠ {t('tenant.crossTenant')}
          </span>
          <button
            type="button"
            onClick={() => switchClinic(homeClinicId)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('tenant.returnHome')}
          </button>
        </>
      )}
    </div>
  )
}

export function ClinicSwitcher() {
  const { canSwitch } = useActiveClinic()
  return canSwitch ? <AdminClinicSwitcher /> : <TenantChip />
}
