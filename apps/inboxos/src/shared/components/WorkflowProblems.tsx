'use client'

// Workflow editor "Problems": a toolbar chip with live error/warning counts and a
// panel that explains each problem in plain language and jumps to the step.
// Errors block publishing; warnings will not, but the workflow will likely
// misbehave for patients (see packages/agents/src/workflows/workflow-lint.ts).
import type { ApiIssue } from '../api/client'
import type { WorkflowCheckResult } from '../hooks/useWorkflowCheck'

type Language = 'es' | 'en'

const COPY = {
  en: {
    checking: 'Checking…',
    noProblems: 'No problems found',
    errors: (n: number) => `${n} must fix`,
    warnings: (n: number) => `${n} warning${n === 1 ? '' : 's'}`,
    title: 'Problems in this workflow',
    errorsHeading: 'Must fix before publishing',
    warningsHeading: 'Might not work as expected for patients',
    allClear: 'Nothing to fix. This workflow looks ready.',
    where: 'Step',
    whatHappened: 'What happens',
    howToFix: 'How to fix it',
    showStep: 'Show step',
    close: 'Close',
    unavailable: 'The live check is unavailable right now. Problems will still be shown when you save.',
    technical: 'Technical details',
  },
  es: {
    checking: 'Revisando…',
    noProblems: 'Sin problemas',
    errors: (n: number) => `${n} por corregir`,
    warnings: (n: number) => `${n} advertencia${n === 1 ? '' : 's'}`,
    title: 'Problemas en este flujo',
    errorsHeading: 'Corrige antes de publicar',
    warningsHeading: 'Podría no funcionar como esperas para los pacientes',
    allClear: 'Nada por corregir. Este flujo se ve listo.',
    where: 'Paso',
    whatHappened: 'Qué pasa',
    howToFix: 'Cómo arreglarlo',
    showStep: 'Ver paso',
    close: 'Cerrar',
    unavailable: 'La revisión en vivo no está disponible ahora. Los problemas se mostrarán igualmente al guardar.',
    technical: 'Detalles técnicos',
  },
} as const

function text(issue: ApiIssue, field: 'title' | 'whatHappened' | 'howToFix', language: Language): string {
  if (language === 'es') return issue.translations?.es?.[field] ?? issue[field] ?? ''
  return issue[field] ?? ''
}

export function WorkflowProblemsButton({
  result,
  checking,
  failed,
  open,
  language,
  onToggle,
}: {
  result: WorkflowCheckResult | undefined
  checking: boolean
  failed: boolean
  open: boolean
  language: Language
  onToggle: () => void
}) {
  const copy = COPY[language]
  const errors = result?.errors.length ?? 0
  const warnings = result?.warnings.length ?? 0
  const tone = errors > 0
    ? 'border-red-300 text-red-700 dark:border-red-800 dark:text-red-300'
    : warnings > 0
      ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300'
      : 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
  const parts = [errors > 0 ? copy.errors(errors) : '', warnings > 0 ? copy.warnings(warnings) : ''].filter(Boolean)
  const label = !result && checking ? copy.checking : failed && !result ? '—' : parts.length > 0 ? parts.join(' · ') : copy.noProblems
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${copy.title}: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold ${tone}`}
    >
      <span aria-hidden>{errors > 0 ? '⛔' : warnings > 0 ? '⚠' : '✓'}</span>
      {label}
    </button>
  )
}

function IssueCard({ issue, severity, language, onShowStep }: { issue: ApiIssue; severity: 'error' | 'warning'; language: Language; onShowStep: (issue: ApiIssue) => void }) {
  const copy = COPY[language]
  const tone = severity === 'error' ? 'border-red-200 dark:border-red-900' : 'border-amber-200 dark:border-amber-900'
  const titleTone = severity === 'error' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
  const whatHappened = text(issue, 'whatHappened', language)
  const howToFix = text(issue, 'howToFix', language)
  return (
    <li className={`rounded-md border bg-white p-3 text-gray-800 dark:bg-gray-950 dark:text-gray-100 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-semibold ${titleTone}`}>{text(issue, 'title', language)}</p>
          {issue.where && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{copy.where}: {issue.where}</p>}
        </div>
        {(issue.nodeId || issue.edgeId) && (
          <button
            type="button"
            onClick={() => onShowStep(issue)}
            className="shrink-0 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {copy.showStep}
          </button>
        )}
      </div>
      {whatHappened && <p className="mt-2 text-sm"><span className="font-medium">{copy.whatHappened}:</span> {whatHappened}</p>}
      {howToFix && <p className="mt-1 text-sm"><span className="font-medium">{copy.howToFix}:</span> {howToFix}</p>}
      {issue.technicalDetails && (
        <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          <summary className="cursor-pointer font-medium">{copy.technical}</summary>
          <p className="mt-1 break-words font-mono">{issue.technicalDetails}</p>
        </details>
      )}
    </li>
  )
}

export function WorkflowProblemsPanel({
  result,
  failed,
  language,
  onClose,
  onShowStep,
}: {
  result: WorkflowCheckResult | undefined
  failed: boolean
  language: Language
  onClose: () => void
  onShowStep: (issue: ApiIssue) => void
}) {
  const copy = COPY[language]
  const errors = result?.errors ?? []
  const warnings = result?.warnings ?? []
  return (
    <section aria-label={copy.title} className="mx-4 mt-2 max-h-[45vh] overflow-y-auto rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{copy.title}</h2>
        <button type="button" onClick={onClose} className="rounded border border-gray-300 px-2 py-0.5 text-xs dark:border-gray-700">{copy.close}</button>
      </div>
      {failed && !result && <p className="text-sm text-gray-500">{copy.unavailable}</p>}
      {result && errors.length === 0 && warnings.length === 0 && <p className="text-sm text-emerald-700 dark:text-emerald-300">{copy.allClear}</p>}
      {errors.length > 0 && (
        <>
          <p className="mb-1 mt-1 text-xs font-semibold uppercase tracking-wide text-red-600 dark:text-red-300">{copy.errorsHeading}</p>
          <ul className="space-y-2">
            {errors.map((issue, i) => <IssueCard key={`e-${issue.nodeId ?? issue.edgeId ?? ''}-${i}`} issue={issue} severity="error" language={language} onShowStep={onShowStep} />)}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">{copy.warningsHeading}</p>
          <ul className="space-y-2">
            {warnings.map((issue, i) => <IssueCard key={`w-${issue.nodeId ?? issue.edgeId ?? ''}-${i}`} issue={issue} severity="warning" language={language} onShowStep={onShowStep} />)}
          </ul>
        </>
      )}
    </section>
  )
}
