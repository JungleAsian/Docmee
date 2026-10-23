'use client'

import { useEffect, useId, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { LayaDiagnosticStatus, LayaDiagnosticTest, LayaObservationSummary } from '@docmee/shared'
import { api, ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useI18n } from '@/shared/hooks/useI18n'

// Per-browser convenience only: whether the card was left open.
const OPEN_KEY = 'docmee.laya-diagnostics.open'

export function LayaStatusPanel({ clinicId, defaultOpen = false }: { clinicId: string; defaultOpen?: boolean }) {
  const user = useAuthStore(s => s.user)
  if (user?.role !== 'ia_studio_admin') return null
  // Unmount results on clinic/operator changes, including in-flight old requests.
  return <Diagnostics key={`${clinicId}:${user.id}`} clinicId={clinicId} userId={user.id} defaultOpen={defaultOpen} />
}

function Diagnostics({ clinicId, userId, defaultOpen }: { clinicId: string; userId: string; defaultOpen: boolean }) {
  const { t } = useI18n()
  const headingId = useId()
  const bodyId = useId()
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(OPEN_KEY)
      if (saved === '1' || saved === '0') setOpen(saved === '1')
    } catch { /* storage unavailable: keep the default */ }
  }, [])
  const toggle = () => setOpen(value => {
    try { window.localStorage.setItem(OPEN_KEY, value ? '0' : '1') } catch { /* ignore */ }
    return !value
  })
  // Collapsed cards load nothing; opening fetches fresh status.
  const status = useQuery({
    queryKey: ['laya-status', clinicId, userId],
    queryFn: () => api.get<LayaDiagnosticStatus>(`/clinics/${clinicId}/laya/status`),
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const observations = useQuery({
    queryKey: ['laya-observations', clinicId, userId],
    queryFn: () => api.get<LayaObservationSummary>(`/clinics/${clinicId}/laya/observations`),
    enabled: open,
    retry: false,
    refetchOnWindowFocus: false,
  })
  const test = useMutation({
    mutationFn: (language: 'en' | 'es') => api.post<LayaDiagnosticTest>(`/clinics/${clinicId}/laya/test`, { language }),
    retry: false,
  })
  // Never present a cached success as a current status after a failed refresh.
  const current = !status.isError ? status.data : undefined
  const result = !test.isPending && !test.isError ? test.data : undefined
  const button = 'rounded border px-3 py-2 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'

  return (
    <section className="clinic-card space-y-4 p-4" aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-base font-semibold">{t('laya.title')}</h2>
        <div className="flex flex-wrap gap-2">
          {open && <button type="button" className={button} disabled={status.isFetching || test.isPending} onClick={() => void status.refetch()}>{t('laya.refresh')}</button>}
          <button type="button" className={button} aria-expanded={open} aria-controls={bodyId} onClick={toggle}>{t(open ? 'laya.hide' : 'laya.show')}</button>
        </div>
      </div>
      {open && (
      <div id={bodyId} className="space-y-4">
      <p className="text-sm">{t('laya.description')}</p>
      <p className="rounded border p-3 text-sm">{t('laya.warning')}</p>
      <div aria-live="polite" aria-busy={status.isFetching}>
        {status.isError ? <p role="status">{t('laya.loadError')}</p> : status.isPending ? <p>{t('laya.loading')}</p> : null}
        {current && (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="font-medium">{t('laya.service')}</dt><dd>{t(`laya.${current.service}`)}</dd></div>
              <div><dt className="font-medium">{t('laya.model')}</dt><dd>{t(`laya.${current.model}`)}</dd></div>
              <div><dt className="font-medium">{t('laya.optIn')}</dt><dd>{t(`laya.${current.clinicOptIn}`)}</dd></div>
              <div><dt className="font-medium">{t('laya.patientDecisions')}</dt><dd>{t(current.patientDecisions === 'live' ? 'laya.live' : 'laya.blocked')}</dd></div>
              {current.mode && <div><dt className="font-medium">{t('laya.mode')}</dt><dd>{t(`laya.mode.${current.mode}`)}</dd></div>}
              {current.qualificationRecord && <div><dt className="font-medium">{t('laya.record')}</dt><dd>{t(`laya.record.${current.qualificationRecord}`)}</dd></div>}
              {current.capture && <div><dt className="font-medium">{t('laya.capture')}</dt><dd>{t(`laya.capture.${current.capture}`)}</dd></div>}
            </dl>
            <p className="mt-3 text-xs">{t('laya.checkedAt')}: <time dateTime={current.checkedAt}>{current.checkedAt}</time></p>
          </>
        )}
      </div>
      <p className="text-sm"><span className="font-medium">{t('laya.qualification')}: </span>{t(current?.qualification === 'reviewed' ? 'laya.reviewed' : 'laya.unqualified')}</p>
      <Measurement summary={!observations.isError && isSummary(observations.data) ? observations.data : undefined} failed={observations.isError} loading={observations.isPending} />
      <div className="space-y-3 border-t pt-3">
        <p className="text-sm">{t('laya.syntheticOnly')}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={test.isPending} onClick={() => test.mutate('en')}>{t('laya.testEnglish')}</button>
          <button type="button" className={button} disabled={test.isPending} onClick={() => test.mutate('es')}>{t('laya.testSpanish')}</button>
        </div>
        <div aria-live="polite" aria-busy={test.isPending} className="space-y-2 text-sm">
          {test.isPending && <p>{t('laya.running')}</p>}
          {test.isError && <p role="status">{t(test.error instanceof ApiError && test.error.status === 429 ? 'laya.cooldown' : 'laya.testError')}</p>}
          {result && (
            <>
              <p>{t(result.outcome === 'response'
                ? result.matchesExpected ? 'laya.matched' : result.choice === null ? 'laya.abstained' : 'laya.mismatched'
                : `laya.test.${result.outcome}`)}</p>
              <p>{t(result.language === 'en' ? 'laya.english' : 'laya.spanish')} · {result.durationMs} ms · <time dateTime={result.checkedAt}>{result.checkedAt}</time></p>
              <p>{t('laya.testNotQualification')}</p>
            </>
          )}
        </div>
      </div>
      </div>
      )}
    </section>
  )
}

function isSummary(value: unknown): value is LayaObservationSummary {
  return !!value && typeof value === 'object' && Array.isArray((value as LayaObservationSummary).groups)
    && Array.isArray((value as LayaObservationSummary).reasons)
}

function Measurement({ summary, failed, loading }: { summary?: LayaObservationSummary; failed: boolean; loading: boolean }) {
  const { t } = useI18n()
  const headingId = useId()
  const cell = 'border-b px-2 py-1 text-left'
  return (
    <div className="space-y-2 border-t pt-3" aria-labelledby={headingId}>
      <h3 id={headingId} className="text-sm font-semibold">{t('laya.obs.title')}</h3>
      <p className="text-xs">{t('laya.obs.description')}</p>
      {failed ? <p role="status" className="text-sm">{t('laya.obs.loadError')}</p> : loading ? <p className="text-sm">{t('laya.loading')}</p> : null}
      {summary && (summary.groups.length === 0 ? <p className="text-sm">{t('laya.obs.empty')}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className={cell}>{t('laya.obs.task')}</th>
                <th className={cell}>{t('laya.obs.language')}</th>
                <th className={cell}>{t('laya.obs.typed')}</th>
                <th className={cell}>{t('laya.obs.labeled')}</th>
                <th className={cell}>{t('laya.obs.answered')}</th>
                <th className={cell}>{t('laya.obs.agreement')}</th>
              </tr>
            </thead>
            <tbody>
              {summary.groups.map(group => (
                <tr key={`${group.task}:${group.language}`}>
                  <td className={cell}>{t(`laya.obs.task.${group.task}`)}</td>
                  <td className={cell}>{group.language}</td>
                  <td className={cell}>{group.total}</td>
                  <td className={cell}>{group.labeled}</td>
                  <td className={cell}>{group.answered}</td>
                  <td className={cell}>{group.comparable > 0 ? `${Math.round((group.agreed / group.comparable) * 100)}% (${group.agreed}/${group.comparable})` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {summary && summary.reasons.length > 0 && (
        <p className="text-xs"><span className="font-medium">{t('laya.obs.reasons')}: </span>{summary.reasons.map(row => `${row.reason} ${row.count}`).join(' · ')}</p>
      )}
      <p className="text-xs">{t('laya.obs.note')}</p>
    </div>
  )
}
