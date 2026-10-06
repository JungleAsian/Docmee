'use client'

// Superuser change log: every change made to a workflow, setting or configuration
// across all clinics — who made it, when, and exactly what changed. Entries are
// recorded server-side by the API's change-log hooks; GET /change-log is
// ia_studio_admin only, and this page hides itself from everyone else too.
import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import type { TranslationKey } from '@/shared/i18n'
import { ChangeLogEntryRow, type ChangeLogEntry } from '@/shared/components/ChangeLogEntry'
import { useAuthStore } from '@/shared/store/auth'

type Clinic = { id: string; name: string }

interface ChangeLogPage {
  entries: ChangeLogEntry[]
  areas: string[]
  nextBefore: string | null
}

const PAGE_SIZE = 50

export default function ChangeLogPage() {
  const { t } = useI18n()
  const role = useAuthStore((state) => state.user?.role)
  const isSuperuser = role === 'ia_studio_admin'
  const [clinicId, setClinicId] = useState('')
  const [area, setArea] = useState('')
  const [outcome, setOutcome] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    enabled: isSuperuser,
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })

  const params = useMemo(() => {
    const p = new URLSearchParams({ limit: String(PAGE_SIZE) })
    if (clinicId) p.set('clinic_id', clinicId)
    if (area) p.set('area', area)
    if (outcome) p.set('outcome', outcome)
    if (query) p.set('q', query)
    return p
  }, [area, clinicId, outcome, query])

  const log = useInfiniteQuery({
    queryKey: ['change-log', params.toString()],
    enabled: isSuperuser,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams(params)
      if (pageParam) p.set('before', pageParam)
      return api.get<ChangeLogPage>(`/change-log?${p.toString()}`)
    },
    getNextPageParam: (last) => last.nextBefore,
  })

  if (!isSuperuser) {
    return (
      <div className="clinic-surface">
        <div className="clinic-page clinic-page-lg">
          <div className="clinic-card p-6 text-sm text-gray-500">{t('changeLog.superuserOnly')}</div>
        </div>
      </div>
    )
  }

  const entries = log.data?.pages.flatMap((page) => page.entries) ?? []
  const areas = log.data?.pages[0]?.areas ?? []
  const selectCls = 'rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900'

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-lg space-y-4">
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">{t('changeLog.eyebrow')}</p>
            <h1 className="clinic-title">{t('changeLog.title')}</h1>
            <p className="clinic-subtitle">{t('changeLog.subtitle')}</p>
          </div>
        </div>

        <form
          className="clinic-card flex flex-col gap-2 p-3 sm:flex-row sm:flex-wrap sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            setQuery(search.trim())
          }}
        >
          <select aria-label={t('changeLog.clinic')} value={clinicId} onChange={(e) => setClinicId(e.target.value)} className={selectCls}>
            <option value="">{t('changeLog.allClinics')}</option>
            {(clinicsQuery.data?.clinics ?? []).map((clinic) => (
              <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
            ))}
          </select>
          <select aria-label={t('changeLog.areaLabel')} value={area} onChange={(e) => setArea(e.target.value)} className={selectCls}>
            <option value="">{t('changeLog.allAreas')}</option>
            {areas.map((value) => (
              <option key={value} value={value}>{t(`changeLog.area.${value}` as TranslationKey)}</option>
            ))}
          </select>
          <select aria-label={t('changeLog.outcome')} value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectCls}>
            <option value="">{t('changeLog.allOutcomes')}</option>
            <option value="succeeded">{t('changeLog.succeeded')}</option>
            <option value="failed">{t('changeLog.failed')}</option>
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('changeLog.searchPlaceholder')}
            aria-label={t('changeLog.searchPlaceholder')}
            className={`${selectCls} min-w-0 flex-1`}
          />
          <button type="submit" className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700">
            {t('changeLog.search')}
          </button>
        </form>

        <section className="clinic-card overflow-hidden">
          {log.isLoading ? (
            <div className="p-6 text-sm text-gray-500">{t('changeLog.loading')}</div>
          ) : log.isError ? (
            <div className="p-6 text-sm text-red-600">{t('changeLog.loadError')}</div>
          ) : entries.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">{t('changeLog.empty')}</div>
          ) : (
            <ul className="divide-y divide-gray-100 dark:divide-gray-800">
              {entries.map((entry) => (
                <ChangeLogEntryRow key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
          {log.hasNextPage && (
            <div className="border-t border-gray-100 p-3 text-center dark:border-gray-800">
              <button
                type="button"
                onClick={() => log.fetchNextPage()}
                disabled={log.isFetchingNextPage}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {log.isFetchingNextPage ? t('changeLog.loading') : t('changeLog.loadMore')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
