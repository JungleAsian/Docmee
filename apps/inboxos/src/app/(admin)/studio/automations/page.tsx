'use client'

// IA Studio — Automation & follow-ups (Screen 12 / Rev1 #14, #28, #38).
// The automation BUILDER: per-clinic follow-up automations with a schedule preview
// and WhatsApp 24-hour-window compliance warnings, review-request configuration with
// a patient-friendly message preview, and a compact view of the custom-flow library
// (full editor lives at /studio/custom-flows).
//
// The follow-up/review SCHEDULES are owned by the workers (apps/workers); this page
// configures clinic.settings.automations (which the workers honour at fire time) and
// clinic.settings.reviewLink (where the review-request worker points patients).
import { useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { PillToggle } from '@/shared/components/PillToggle'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import {
  AUTOMATION_DEFS,
  PROACTIVE_CAP_PER_DAY,
  readAutomations,
  isFollowUpEnabled,
  isReviewEnabled,
  requiresApproval,
  activeCount,
  type AutomationDef,
  type ScheduleOffset,
  type AutomationsConfig,
} from '@/shared/automations'
import type { Clinic, ClinicSettings, CustomFlow, Workflow } from '@/shared/types'
import { CreateAutomationGallery } from './CreateAutomationGallery'

const field =
  'w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

type Translate = ReturnType<typeof useI18n>['t']

// ── Schedule + compliance presentation helpers ────────────────────────────────────
function scheduleLabel(t: Translate, o: ScheduleOffset): string {
  const unitKey =
    o.unit === 'hour'
      ? o.amount === 1
        ? 'automations.unit.hour'
        : 'automations.unit.hours'
      : o.amount === 1
        ? 'automations.unit.day'
        : 'automations.unit.days'
  const unit = t(unitKey as Parameters<Translate>[0])
  if (o.anchor === 'silence') return t('automations.schedule.afterSilence', { amount: o.amount, unit })
  return t(
    o.direction === 'before' ? 'automations.schedule.before' : 'automations.schedule.after',
    { amount: o.amount, unit },
  )
}

function WindowBadge({ def }: { def: AutomationDef }) {
  const { t } = useI18n()
  const ok = def.window === 'template_fallback'
  return (
    <span
      title={t(`automations.window.${def.window}.hint` as Parameters<Translate>[0])}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
      }`}
    >
      {ok ? '✓' : '⚠'} {t(`automations.window.${def.window}` as Parameters<Translate>[0])}
    </span>
  )
}

export default function AutomationsPage() {
  const { t } = useI18n()
  const { clinicId, switchClinic } = useActiveClinic()

  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('automations.center.nav')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('automations.center.desc')}</p>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('analytics.selectClinic')} />
      </div>

      {clinicId ? <CreateAutomationGallery clinicId={clinicId} /> : null}

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('automations.selectClinic')}</p>
      ) : clinicQuery.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : clinicQuery.isError || !clinicQuery.data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950">
          <p className="text-red-700 dark:text-red-300">{t('common.error')}</p>
          <button
            type="button"
            onClick={() => clinicQuery.refetch()}
            className="mt-2 rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900"
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <AutomationSections clinic={clinicQuery.data.clinic} clinicId={clinicId} />
      )}
    </div>
  )
}

function AutomationSections({ clinic, clinicId }: { clinic: Clinic; clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const settings = clinic.settings as ClinicSettings
  const config = readAutomations(settings)
  const health = useQuery({
    queryKey: ['automation-health', clinicId],
    queryFn: () => api.get<{
      state: 'ready' | 'attention'
      issues: Array<{ code: string; count: number; message: string }>
      checkedAt: string
    }>(`/clinics/${clinicId}/automation-health`),
  })

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/clinics/${clinicId}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clinic', clinicId] })
      qc.invalidateQueries({ queryKey: ['clinics'] })
      qc.invalidateQueries({ queryKey: ['automation-health', clinicId] })
    },
  })

  /** Merge an automations patch onto the existing settings blob and persist. */
  function patchAutomations(next: AutomationsConfig) {
    save.mutate({ settings: { ...clinic.settings, automations: { ...config, ...next } } })
  }

  const { active, total } = activeCount(config)

  return (
    <div className="space-y-8">
      {health.data && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          health.data.state === 'ready'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'
        }`}>
          <p className="font-semibold">
            Automation status: {health.data.state === 'ready' ? 'Ready' : 'Needs attention'}
          </p>
          {health.data.issues.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
              {health.data.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
            </ul>
          )}
        </div>
      )}
      {save.isError && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
          {t('automations.saveError')}
        </p>
      )}

      {/* AI Assistant (J.zel) configuration moved to Studio → AI Settings
          (items 3/9/16 of the 25-item batch). */}
      <Link
        href="/studio/ai-settings"
        className="flex items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/70"
      >
        <span>{t('automations.aiAssistantMoved')}</span>
        <span aria-hidden>→</span>
      </Link>

      {/* ── Section A: Follow-up automation (Req 14) ─────────────────────────── */}
      <section id="follow-ups">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('automations.section.followUps')}</h2>
          <span className="text-xs text-gray-400">
            {active}/{total} configured
            {save.isPending && <span className="ml-2">· {t('automations.saving')}</span>}
          </span>
        </div>
        <p className="mb-3 text-xs text-gray-500">{t('automations.section.followUps.desc')}</p>

        {/* 24h-window + anti-spam compliance note */}
        <div className="mb-3 rounded-md border border-blue-100 bg-blue-50/60 px-3 py-2 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
          {t('automations.windowNote', { cap: PROACTIVE_CAP_PER_DAY })}
        </div>

        <ul className="space-y-2">
          {AUTOMATION_DEFS.map((def) => {
            const on = isFollowUpEnabled(config, def.type)
            return (
              <li
                key={def.type}
                className={`rounded-lg border p-3 transition-colors ${
                  on
                    ? 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900'
                    : 'border-gray-200 bg-gray-50 opacity-70 dark:border-gray-800 dark:bg-gray-900/50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {t(`automations.type.${def.type}` as Parameters<Translate>[0])}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {t(`automations.type.${def.type}.desc` as Parameters<Translate>[0])}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        🕑 {scheduleLabel(t, def.offset)}
                      </span>
                      <WindowBadge def={def} />
                      {on && (
                        <label className="inline-flex items-center gap-1 text-[11px] text-gray-500" title={t('automations.requireApproval.hint')}>
                          <input
                            type="checkbox"
                            checked={requiresApproval(config, def.type)}
                            disabled={save.isPending}
                            onChange={(e) =>
                              patchAutomations({ requireApproval: { ...config.requireApproval, [def.type]: e.target.checked } })
                            }
                            className="h-3 w-3 rounded border-gray-300"
                          />
                          {t('automations.requireApproval')}
                        </label>
                      )}
                    </div>
                  </div>
                  <PillToggle
                    checked={on}
                    disabled={save.isPending}
                    label={t(`automations.type.${def.type}` as Parameters<Translate>[0])}
                    onChange={(next) =>
                      patchAutomations({ followUps: { ...config.followUps, [def.type]: next } })
                    }
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {/* ── Approval queue (Rev 2): drafts awaiting secretary sign-off ────────── */}
      <PendingApprovals clinicId={clinicId} />

      {/* Recent activity moved to /studio/activities (merged with the audit log). */}
      <Link
        href="/studio/activities"
        className="flex items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-950/70"
      >
        <span>{t('automations.activityMoved')}</span>
        <span aria-hidden>→</span>
      </Link>

      {/* ── Section B: Review requests (Req 38) ──────────────────────────────── */}
      <ReviewSection
        clinic={clinic}
        config={config}
        saving={save.isPending}
        onToggle={(enabled) => patchAutomations({ reviewRequest: { enabled } })}
        onSaveLink={(reviewLink) => save.mutate({ settings: { ...clinic.settings, reviewLink } })}
      />

      {/* ── Section C: Custom flows (Req 28) ─────────────────────────────────── */}
      <CustomFlowsSummary clinicId={clinicId} />

      {/* ── Section D: graph workflows ───────────────────────────────────────── */}
      <WorkflowsSummary clinicId={clinicId} />
    </div>
  )
}

function ReviewSection({
  clinic,
  config,
  saving,
  onToggle,
  onSaveLink,
}: {
  clinic: Clinic
  config: AutomationsConfig
  saving: boolean
  onToggle: (enabled: boolean) => void
  onSaveLink: (link: string) => void
}) {
  const { t } = useI18n()
  const settings = clinic.settings as ClinicSettings
  const savedLink = settings.reviewLink ?? ''
  const [link, setLink] = useState(savedLink)
  const on = isReviewEnabled(config)
  const dirty = link.trim() !== savedLink

  const doctor = t('automations.review.sampleDoctor')
  const shown = (savedLink || t('automations.review.samplePlaceholder')) as string

  return (
    <section id="review">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('automations.section.review')}</h2>
        <PillToggle checked={on} disabled={saving} label={t('automations.section.review')} onChange={onToggle} />
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('automations.section.review.desc')}</p>

      <div
        className={`space-y-3 rounded-lg border p-3 ${
          on ? 'border-gray-200 dark:border-gray-800' : 'border-gray-200 opacity-70 dark:border-gray-800'
        }`}
      >
        <p className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          🕑 {t('automations.review.trigger')}
        </p>

        {/* No-link warning mirrors the worker, which skips when reviewLink is unset. */}
        {!savedLink && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            ⚠ {t('automations.review.noLink')}
          </p>
        )}

        <label className="block text-xs font-medium text-gray-500">
          {t('automations.review.linkLabel')}
          <div className="mt-1 flex gap-2">
            <input
              type="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={t('automations.review.linkPlaceholder')}
              className={field}
            />
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={() => onSaveLink(link.trim())}
              className="shrink-0 rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {t('common.save')}
            </button>
          </div>
        </label>
        <p className="text-[11px] text-gray-400">{t('automations.review.linkHint')}</p>

        {/* Patient-friendly preview (the message the patient receives) — ES + EN. */}
        <div className="rounded-md bg-gray-50 p-2.5 dark:bg-gray-800/50">
          <p className="mb-1.5 text-[11px] font-medium text-gray-500">
            {t('automations.review.previewTitle')}
          </p>
          <div className="space-y-1.5">
            {(['es', 'en'] as const).map((lang) => (
              <div
                key={lang}
                className="rounded-lg rounded-bl-sm bg-emerald-100 px-2.5 py-1.5 text-xs text-gray-800 dark:bg-emerald-900/40 dark:text-gray-100"
              >
                <span className="mr-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
                  {lang}
                </span>
                {lang === 'en'
                  ? `How was your experience with ${doctor}? Leave us your feedback: ${shown}`
                  : `¿Cómo fue tu experiencia con ${doctor}? Déjanos tu opinión: ${shown}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function CustomFlowsSummary({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['custom-flows', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ flows: CustomFlow[] }>(`/clinics/${clinicId}/custom-flows`),
  })
  const flows = query.data?.flows ?? []

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('automations.section.flows')}</h2>
        <Link
          href="/studio/custom-flows"
          className="text-xs font-medium text-cyan-600 hover:underline dark:text-cyan-400"
        >
          {t('automations.flows.manage')}
        </Link>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('automations.section.flows.desc')}</p>

      {query.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : query.isError ? (
        <button
          type="button"
          onClick={() => query.refetch()}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.retry')}
        </button>
      ) : flows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('automations.flows.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {flows.map((flow) => (
            <li key={flow.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{flow.name}</p>
                <p className="truncate text-[11px] text-gray-500">
                  {t('automations.flows.keywords')}: {flow.triggerKeywords.join(', ') || '—'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  flow.enabled
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {flow.enabled ? t('automations.flows.on') : t('automations.flows.off')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function WorkflowsSummary({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['workflows', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ workflows: Workflow[] }>(`/clinics/${clinicId}/workflows`),
  })
  const workflows = query.data?.workflows ?? []

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t('wf.title')}</h2>
        <Link
          href="/studio/workflows"
          className="text-xs font-medium text-cyan-600 hover:underline dark:text-cyan-400"
        >
          {t('automations.flows.manage')}
        </Link>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('automations.center.workflowsDesc')}</p>

      {query.isLoading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : query.isError ? (
        <button
          type="button"
          onClick={() => query.refetch()}
          className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.retry')}
        </button>
      ) : workflows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-sm text-gray-400 dark:border-gray-700">
          {t('wf.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
          {workflows.map((workflow) => (
            <li key={workflow.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{workflow.name}</p>
                <p className="truncate text-[11px] text-gray-500">
                  {workflow.nodes.filter((node) => node.kind === 'trigger').map((node) => node.type).join(', ') || '—'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  workflow.status === 'active'
                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {workflow.status === 'active' ? t('wf.activeToggle') : t('automations.flows.off')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Rev 2 Approval node: drafts the worker parked for a secretary to sign off ──────
type PendingFollowUp = { id: string; type: string; draft: string; createdAt: string }

function PendingApprovals({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const key = ['follow-up-approvals', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ pending: PendingFollowUp[] }>(`/clinics/${clinicId}/follow-ups/pending`),
  })
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      api.post(`/clinics/${clinicId}/follow-ups/${id}/${action}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const pending = query.data?.pending ?? []
  // Hide the section entirely when there's nothing to approve.
  if (!query.isLoading && pending.length === 0) return null

  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {t('automations.approvals.title')}
        {pending.length > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900 dark:text-amber-200">
            {pending.length}
          </span>
        )}
      </h2>
      <p className="mb-3 text-xs text-gray-500">{t('automations.approvals.desc')}</p>
      <ul className="space-y-2">
        {pending.map((p) => (
          <li key={p.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {t(`automations.type.${p.type}` as Parameters<Translate>[0])}
            </p>
            <p className="mt-1 whitespace-pre-wrap rounded-md bg-white px-2.5 py-1.5 text-sm dark:bg-gray-900">{p.draft}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => act.mutate({ id: p.id, action: 'approve' })}
                disabled={act.isPending}
                className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {t('automations.approvals.approve')}
              </button>
              <button
                type="button"
                onClick={() => act.mutate({ id: p.id, action: 'reject' })}
                disabled={act.isPending}
                className="rounded-md border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
              >
                {t('automations.approvals.reject')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// Recent follow-up activity now lives on /studio/activities (merged with the
// audit log) — see FollowUpActivitySection in studio/activities/page.tsx.
