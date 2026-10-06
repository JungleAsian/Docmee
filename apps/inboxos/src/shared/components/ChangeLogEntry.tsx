'use client'

// One change-log entry: summary line plus an expandable before/after view that
// renders whichever change shape the API recorded (workflow step diff, settings
// field diff, or the redacted submission). Used by /studio/change-log.
import { useState } from 'react'
import { formatDateTime } from '../format'
import { useI18n } from '../hooks/useI18n'
import type { TranslationKey } from '../i18n'

interface FieldChange {
  path: string
  before: unknown
  after: unknown
}

interface StepRef {
  id: string
  type: string
  label: string
  fields?: FieldChange[]
}

export interface ChangeLogEntry {
  id: string
  createdAt: string
  clinicId: string | null
  clinicName: string | null
  actorEmail: string | null
  actorRole: string | null
  area: string
  action: string
  method: string
  route: string
  resourceType: string
  resourceId: string | null
  resourceName: string | null
  outcome: 'succeeded' | 'failed'
  statusCode: number
  summary: string
  changes: Record<string, unknown>
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 1)
}

function FieldTable({ fields }: { fields: FieldChange[] }) {
  const { t } = useI18n()
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-xs">
        <thead className="text-gray-500">
          <tr>
            <th className="py-1 pr-3 font-medium">{t('changeLog.field')}</th>
            <th className="py-1 pr-3 font-medium">{t('changeLog.before')}</th>
            <th className="py-1 font-medium">{t('changeLog.after')}</th>
          </tr>
        </thead>
        <tbody className="align-top">
          {fields.map((field) => (
            <tr key={field.path} className="border-t border-gray-100 dark:border-gray-800">
              <td className="py-1 pr-3 font-mono text-[11px] text-gray-600 dark:text-gray-300">{field.path}</td>
              <td className="max-w-xs whitespace-pre-wrap break-words py-1 pr-3 text-red-700 dark:text-red-300">{formatValue(field.before)}</td>
              <td className="max-w-xs whitespace-pre-wrap break-words py-1 text-emerald-700 dark:text-emerald-300">{formatValue(field.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StepList({ title, steps, tone }: { title: string; steps: StepRef[]; tone: 'add' | 'remove' | 'edit' }) {
  const color = tone === 'add' ? 'text-emerald-700 dark:text-emerald-300' : tone === 'remove' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'
  return (
    <div>
      <p className={`text-xs font-semibold ${color}`}>{title}</p>
      <ul className="mt-1 space-y-2">
        {steps.map((step) => (
          <li key={step.id} className="text-xs">
            <span className="font-medium">{step.label}</span>
            <span className="ml-1 font-mono text-[11px] text-gray-400">{step.type}</span>
            {step.fields && step.fields.length > 0 && (
              <div className="mt-1 pl-3">
                <FieldTable fields={step.fields} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Renders whichever change shape the server recorded (workflow diff, settings diff, or submission). */
export function ChangeDetails({ entry }: { entry: ChangeLogEntry }) {
  const { t } = useI18n()
  const c = entry.changes
  const asSteps = (key: string) => (Array.isArray(c[key]) ? (c[key] as StepRef[]) : [])
  const fields = Array.isArray(c['fields']) ? (c['fields'] as FieldChange[]) : []
  const scalar: FieldChange[] = []
  for (const key of ['name', 'status'] as const) {
    const value = c[key] as { before?: unknown; after?: unknown } | undefined
    if (value && typeof value === 'object' && 'after' in value) scalar.push({ path: key, before: value.before, after: value.after })
  }
  const counts: string[] = []
  if (typeof c['connectionsAdded'] === 'number') counts.push(t('changeLog.connectionsAdded', { count: c['connectionsAdded'] as number }))
  if (typeof c['connectionsRemoved'] === 'number') counts.push(t('changeLog.connectionsRemoved', { count: c['connectionsRemoved'] as number }))
  if (typeof c['stepsMoved'] === 'number') counts.push(t('changeLog.stepsMoved', { count: c['stepsMoved'] as number }))
  const hasStructured =
    scalar.length > 0 || fields.length > 0 || counts.length > 0 ||
    asSteps('stepsAdded').length + asSteps('stepsRemoved').length + asSteps('stepsChanged').length > 0

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/60">
      {scalar.length > 0 && <FieldTable fields={scalar} />}
      {asSteps('stepsAdded').length > 0 && <StepList title={t('changeLog.stepsAdded')} steps={asSteps('stepsAdded')} tone="add" />}
      {asSteps('stepsRemoved').length > 0 && <StepList title={t('changeLog.stepsRemoved')} steps={asSteps('stepsRemoved')} tone="remove" />}
      {asSteps('stepsChanged').length > 0 && <StepList title={t('changeLog.stepsChanged')} steps={asSteps('stepsChanged')} tone="edit" />}
      {counts.length > 0 && <p className="text-xs text-gray-500">{counts.join(' · ')}</p>}
      {fields.length > 0 && <FieldTable fields={fields} />}
      {!hasStructured && Object.keys(c).length > 0 && (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-[11px] text-gray-600 dark:text-gray-300">
          {JSON.stringify(c['submitted'] ?? c, null, 2)}
        </pre>
      )}
      {Object.keys(c).length === 0 && <p className="text-xs text-gray-500">{t('changeLog.noDetails')}</p>}
      <p className="font-mono text-[10px] text-gray-400">
        {entry.method} {entry.route} · HTTP {entry.statusCode}
        {entry.resourceId ? ` · ${entry.resourceType}:${entry.resourceId}` : ''}
      </p>
    </div>
  )
}

export function ChangeLogEntryRow({ entry }: { entry: ChangeLogEntry }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const failed = entry.outcome === 'failed'
  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className={`text-sm font-medium ${failed ? 'text-red-700 dark:text-red-300' : ''}`}>{entry.summary}</p>
          <p className="mt-0.5 text-xs text-gray-500">
            {entry.actorEmail ?? t('changeLog.system')}
            {entry.actorRole ? ` (${entry.actorRole})` : ''}
            {' · '}
            {entry.clinicName ?? entry.clinicId ?? t('changeLog.platform')}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {t(`changeLog.area.${entry.area}` as TranslationKey)}
          </span>
          {failed && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
              {t('changeLog.failed')}
            </span>
          )}
          <time dateTime={entry.createdAt} className="whitespace-nowrap text-xs text-gray-500">
            {formatDateTime(entry.createdAt, language)}
          </time>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="mt-2 text-xs font-medium text-teal-700 hover:underline dark:text-teal-300"
      >
        {open ? t('changeLog.hideChanges') : t('changeLog.showChanges')}
      </button>
      {open && (
        <div className="mt-2">
          <ChangeDetails entry={entry} />
        </div>
      )}
    </li>
  )
}
