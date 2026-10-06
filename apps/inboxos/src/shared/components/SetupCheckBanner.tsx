'use client'

// Banner at the top of every panel page (admins only) when the clinic has a
// configuration or live-workflow problem — e.g. business hours that silence every
// workflow. It reappears whenever the set of problems changes, so a new mistake
// is never hidden by an earlier "dismiss".
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import { useSetupCheck, type SetupIssue } from '../hooks/useSetupCheck'
import { ProblemCard } from './WorkflowProblems'

const DISMISS_KEY = 'docmee-setup-banner-dismissed'

export function setupProblemsSignature(issues: SetupIssue[]): string {
  return issues.map((issue) => issue.key).sort().join('|')
}

export function SetupCheckBannerView({
  issues,
  language,
  open,
  onToggle,
  onDismiss,
}: {
  issues: SetupIssue[]
  language: 'es' | 'en'
  open: boolean
  onToggle: () => void
  onDismiss: () => void
}) {
  const { t } = useI18n()
  const errors = issues.filter((issue) => issue.severity === 'error')
  const warnings = issues.filter((issue) => issue.severity === 'warning')
  if (issues.length === 0) return null
  const severe = errors.length > 0
  const tone = severe
    ? 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200'
    : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200'
  const headline = severe
    ? t('setup.banner.errors', { count: errors.length })
    : t('setup.banner.warnings', { count: warnings.length })
  return (
    <section role={severe ? 'alert' : 'status'} className={`mb-3 rounded-lg border px-3 py-2 text-sm ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>{severe ? '⛔' : '⚠'}</span>
        <p className="min-w-0 flex-1 font-medium">
          {headline}
          {severe && warnings.length > 0 ? ` ${t('setup.banner.andWarnings', { count: warnings.length })}` : ''}
        </p>
        <button type="button" onClick={onToggle} aria-expanded={open} className="rounded border border-current px-2 py-0.5 text-xs font-semibold">
          {open ? t('setup.banner.hide') : t('setup.banner.review')}
        </button>
        {!severe && (
          <button type="button" onClick={onDismiss} className="rounded px-2 py-0.5 text-xs underline">
            {t('setup.banner.dismiss')}
          </button>
        )}
      </div>
      {open && (
        <ul className="mt-2 space-y-2">
          {issues.map((issue) => (
            <ProblemCard
              key={issue.key}
              issue={issue}
              severity={issue.severity}
              language={language}
              action={issue.href ? (
                <Link href={issue.href} className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
                  {t('setup.banner.fix')}
                </Link>
              ) : null}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

export function SetupCheckBanner() {
  const { language } = useI18n()
  const check = useSetupCheck()
  const issues = useMemo(() => check.data?.issues ?? [], [check.data])
  const signature = setupProblemsSignature(issues)
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState<string | null>(null)

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY))
    } catch {
      /* storage unavailable: never dismissed */
    }
  }, [])

  // Errors can never be dismissed; warnings stay hidden until the problem set changes.
  const hasErrors = issues.some((issue) => issue.severity === 'error')
  if (!hasErrors && dismissed === signature) return null

  return (
    <SetupCheckBannerView
      issues={issues}
      language={language}
      open={open}
      onToggle={() => setOpen((value) => !value)}
      onDismiss={() => {
        setDismissed(signature)
        try {
          sessionStorage.setItem(DISMISS_KEY, signature)
        } catch {
          /* ignore */
        }
      }}
    />
  )
}
