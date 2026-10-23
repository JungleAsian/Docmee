'use client'

import { useId } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { LayaDiagnosticStatus, LayaDiagnosticTest } from '@docmee/shared'
import { api, ApiError } from '@/shared/api/client'
import { useAuthStore } from '@/shared/store/auth'
import { useI18n } from '@/shared/hooks/useI18n'

export function LayaStatusPanel({ clinicId }: { clinicId: string }) {
  const user = useAuthStore(s => s.user)
  if (user?.role !== 'ia_studio_admin') return null
  // Unmount results on clinic/operator changes, including in-flight old requests.
  return <Diagnostics key={`${clinicId}:${user.id}`} clinicId={clinicId} userId={user.id} />
}

function Diagnostics({ clinicId, userId }: { clinicId: string; userId: string }) {
  const { t } = useI18n()
  const headingId = useId()
  const status = useQuery({
    queryKey: ['laya-status', clinicId, userId],
    queryFn: () => api.get<LayaDiagnosticStatus>(`/clinics/${clinicId}/laya/status`),
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
        <button type="button" className={button} disabled={status.isFetching || test.isPending} onClick={() => void status.refetch()}>{t('laya.refresh')}</button>
      </div>
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
              <div><dt className="font-medium">{t('laya.patientDecisions')}</dt><dd>{t('laya.blocked')}</dd></div>
            </dl>
            <p className="mt-3 text-xs">{t('laya.checkedAt')}: <time dateTime={current.checkedAt}>{current.checkedAt}</time></p>
          </>
        )}
      </div>
      <p className="text-sm"><span className="font-medium">{t('laya.qualification')}: </span>{t('laya.unqualified')}</p>
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
    </section>
  )
}
