'use client'

// Screen 4 (Quick replies & templates) — Admin Studio WhatsApp message templates.
// Pick a clinic, register the templates submitted to Meta and track approval
// status (submission to Meta is manual; this records status only). This pass adds
// the design-map depth: a collapsible WhatsApp-template guidance panel, live
// variable + Meta-rule validation in the editor (shared/templateGuidance.ts),
// search + category/language/status filters over the bilingual library, and the
// error+retry / empty-for-filter states the global brief requires.
import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { StudioMessagingTabs } from '@/shared/components/StudioMessagingTabs'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import {
  analyzeTemplate,
  suggestTemplateName,
  CATEGORY_META_TYPE,
  TEMPLATE_BODY_MAX,
  type TemplateAnalysis,
} from '@/shared/templateGuidance'
import type { TranslationKey } from '@/shared/i18n'
import type {
  MessageTemplate,
  MessageTemplateCategory,
  MessageTemplateStatus,
} from '@/shared/types'

const CATEGORIES: MessageTemplateCategory[] = [
  'appointment_confirmation',
  'appointment_reminder',
  'human_handoff_notification',
  'review_request',
]
const STATUSES: MessageTemplateStatus[] = ['pending', 'approved', 'rejected']
const LANGUAGES = ['es', 'en']

// Endonyms for the raw 'es'/'en' language codes stored on templates — a clinic
// receptionist shouldn't have to know what an ISO language code is.
const LANGUAGE_NAME: Record<string, { es: string; en: string }> = {
  es: { es: 'Español', en: 'Spanish' },
  en: { es: 'Inglés', en: 'English' },
}
function languageName(code: string, panelLanguage: string): string {
  const entry = LANGUAGE_NAME[code]
  if (!entry) return code
  return panelLanguage === 'en' ? entry.en : entry.es
}

const STATUS_BADGE: Record<MessageTemplateStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

// WhatsApp's raw Cloud API template-status enum, mapped to a plain-language label.
// Falls back to the raw value for any status Meta adds that we haven't mapped yet,
// rather than hiding it.
const META_STATUS_KEY: Record<string, TranslationKey> = {
  APPROVED: 'studio.templates.metaStatus.APPROVED',
  PENDING: 'studio.templates.metaStatus.PENDING',
  REJECTED: 'studio.templates.metaStatus.REJECTED',
  PAUSED: 'studio.templates.metaStatus.PAUSED',
  IN_APPEAL: 'studio.templates.metaStatus.IN_APPEAL',
  DISABLED: 'studio.templates.metaStatus.DISABLED',
}

// Plain-language role of each numbered placeholder in a starter template, in
// order — shown as a glossary under the preview so "{{1}}, {{2}}…" isn't just
// abstract syntax. Purely explanatory; has no effect on the saved template body.
type VarRole = 'patientName' | 'clinicName' | 'date' | 'time' | 'reviewLink'
const VAR_ROLE_KEY: Record<VarRole, TranslationKey> = {
  patientName: 'studio.templates.varRole.patientName',
  clinicName: 'studio.templates.varRole.clinicName',
  date: 'studio.templates.varRole.date',
  time: 'studio.templates.varRole.time',
  reviewLink: 'studio.templates.varRole.reviewLink',
}

interface StarterTemplate {
  key: string
  name: string
  category: MessageTemplateCategory
  language: string
  body: string
  variableRoles: VarRole[]
}

const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    key: 'appointment_confirmation_es',
    name: 'confirmacion_de_cita',
    category: 'appointment_confirmation',
    language: 'es',
    body:
      'Hola {{1}}, tu cita en {{2}} está confirmada para el {{3}} a las {{4}}. Responde CONFIRMAR para confirmar o CAMBIAR para pedir otro horario.',
    variableRoles: ['patientName', 'clinicName', 'date', 'time'],
  },
  {
    key: 'appointment_reminder_es',
    name: 'recordatorio_de_cita',
    category: 'appointment_reminder',
    language: 'es',
    body:
      'Hola {{1}}, te recordamos tu cita en {{2}} mañana a las {{3}}. Si no puedes asistir, responde CAMBIAR para ayudarte.',
    variableRoles: ['patientName', 'clinicName', 'time'],
  },
  {
    key: 'handoff_es',
    name: 'equipo_clinico_responde',
    category: 'human_handoff_notification',
    language: 'es',
    body:
      'Hola {{1}}, gracias por escribir a {{2}}. Un miembro del equipo revisará tu mensaje y te responderá pronto. Para emergencias, llama a servicios de emergencia.',
    variableRoles: ['patientName', 'clinicName'],
  },
  {
    key: 'review_request_es',
    name: 'solicitud_de_resena',
    category: 'review_request',
    language: 'es',
    body:
      'Hola {{1}}, gracias por visitar {{2}}. Si deseas compartir tu experiencia, puedes dejar una reseña aquí: {{3}}. Responde STOP para no recibir estos mensajes.',
    variableRoles: ['patientName', 'clinicName', 'reviewLink'],
  },
  {
    key: 'appointment_confirmation_en',
    name: 'appointment_confirmation',
    category: 'appointment_confirmation',
    language: 'en',
    body:
      'Hi {{1}}, your appointment at {{2}} is confirmed for {{3}} at {{4}}. Reply CONFIRM to confirm or CHANGE to request another time.',
    variableRoles: ['patientName', 'clinicName', 'date', 'time'],
  },
  {
    key: 'appointment_reminder_en',
    name: 'appointment_reminder',
    category: 'appointment_reminder',
    language: 'en',
    body:
      "Hi {{1}}, this is a reminder for your appointment at {{2}} tomorrow at {{3}}. If you can't make it, reply CHANGE and we'll help you reschedule.",
    variableRoles: ['patientName', 'clinicName', 'time'],
  },
  {
    key: 'non_emergency_en',
    name: 'non_emergency_clinic_reply',
    category: 'human_handoff_notification',
    language: 'en',
    body:
      'Hi {{1}}, thanks for contacting {{2}}. Our team will review your message and reply soon. For emergencies, please call emergency services.',
    variableRoles: ['patientName', 'clinicName'],
  },
  {
    key: 'review_request_en',
    name: 'review_request',
    category: 'review_request',
    language: 'en',
    body:
      "Hi {{1}}, thank you for visiting {{2}}. If you'd like to share your experience, you can leave a review here: {{3}}. Reply STOP to stop receiving these messages.",
    variableRoles: ['patientName', 'clinicName', 'reviewLink'],
  },
]

export default function TemplatesPage() {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<MessageTemplateCategory | ''>('')
  const [languageFilter, setLanguageFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<MessageTemplateStatus | ''>('')

  const key = ['message-templates', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ templates: MessageTemplate[] }>(`/clinics/${clinicId}/message-templates`),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: MessageTemplateStatus }) =>
      api.patch(`/clinics/${clinicId}/message-templates/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const syncMutation = useMutation({
    mutationFn: (id: string) => api.post(`/clinics/${clinicId}/message-templates/${id}/sync`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const all = query.data?.templates ?? []
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return all.filter((tpl) => {
      if (categoryFilter && tpl.category !== categoryFilter) return false
      if (languageFilter && tpl.language !== languageFilter) return false
      if (statusFilter && tpl.status !== statusFilter) return false
      if (term && !`${tpl.name} ${tpl.body}`.toLowerCase().includes(term)) return false
      return true
    })
  }, [all, search, categoryFilter, languageFilter, statusFilter])

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('studio.templates.title')}</h1>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('studio.usage.selectClinic')} />
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.templates.selectClinic')}</p>
      ) : (
        <>
          <StudioMessagingTabs />
          <GuidancePanel />
          <p className="mb-3 text-xs text-gray-400">{t('studio.templates.note')}</p>
          <NewTemplateForm clinicId={clinicId} />

          {/* Filter bar over the bilingual library. */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('studio.templates.search')}
              className="min-w-[10rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as MessageTemplateCategory | '')}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">{t('studio.templates.filter.allCategories')}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`studio.templates.category.${c}` as const)}
                </option>
              ))}
            </select>
            <select
              value={languageFilter}
              onChange={(e) => setLanguageFilter(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">{t('studio.templates.filter.allLanguages')}</option>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {languageName(l, language)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as MessageTemplateStatus | '')}
              className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="">{t('studio.templates.filter.allStatuses')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`studio.templates.status.${s}` as const)}
                </option>
              ))}
            </select>
          </div>

          {query.isLoading ? (
            <div className="space-y-2" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                />
              ))}
            </div>
          ) : query.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/40">
              <p className="text-red-700 dark:text-red-300">{t('common.error')}</p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="mt-2 rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : all.length === 0 ? (
            <div className="clinic-empty-state text-sm">
              <p className="font-semibold text-gray-700 dark:text-gray-200">{t('studio.templates.empty')}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('studio.templates.emptyHelp')}</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="clinic-empty-state text-sm">
              <p className="font-semibold text-gray-700 dark:text-gray-200">{t('studio.templates.emptyFilter')}</p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t('studio.templates.emptyFilterHelp')}</p>
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-gray-400">
                {t('studio.templates.count', { n: filtered.length, m: all.length })}
              </p>
              <ul className="space-y-2">
                {filtered.map((tpl) => (
                  <TemplateRow
                    key={tpl.id}
                    template={tpl}
                    onStatus={(status) => statusMutation.mutate({ id: tpl.id, status })}
                    statusBusy={statusMutation.isPending}
                    onSync={() => syncMutation.mutate(tpl.id)}
                    syncBusy={syncMutation.isPending}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}

function TemplateRow({
  template: tpl,
  onStatus,
  statusBusy,
  onSync,
  syncBusy,
}: {
  template: MessageTemplate
  onStatus: (status: MessageTemplateStatus) => void
  statusBusy: boolean
  onSync: () => void
  syncBusy: boolean
}) {
  const { t, language: panelLanguage } = useI18n()
  const analysis = useMemo(() => analyzeTemplate(tpl.body, tpl.name), [tpl.body, tpl.name])
  const metaStatusKey = tpl.metaStatus ? META_STATUS_KEY[tpl.metaStatus] : undefined

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium">{tpl.name}</p>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800">
          {t(`studio.templates.category.${tpl.category}` as const)}
        </span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800">
          {languageName(tpl.language, panelLanguage)}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[tpl.status]}`}>
          {t(`studio.templates.status.${tpl.status}` as const)}
        </span>
        {tpl.metaStatus && (
          <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
            {metaStatusKey ? t(metaStatusKey) : tpl.metaStatus}
          </span>
        )}
        {tpl.metaTemplateId && (
          <span
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500 dark:bg-gray-800"
            title={t('studio.templates.syncMetaHint')}
          >
            {tpl.metaTemplateId}
          </span>
        )}
        <button
          type="button"
          onClick={onSync}
          disabled={syncBusy}
          title={t('studio.templates.syncMetaHint')}
          className="rounded border border-gray-300 px-2 py-0.5 text-[10px] font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('studio.templates.syncMeta')}
        </button>
        <select
          value={tpl.status}
          onChange={(e) => onStatus(e.target.value as MessageTemplateStatus)}
          disabled={statusBusy}
          aria-label={t('studio.templates.status')}
          className="ml-auto rounded border border-gray-300 bg-transparent px-1 py-0.5 text-[10px] text-gray-500 dark:border-gray-700"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`studio.templates.status.${s}` as const)}
            </option>
          ))}
        </select>
      </div>

      <VariableChips analysis={analysis} />
      <IssueList analysis={analysis} />

      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-gray-500">{tpl.body}</p>
      {(tpl.metaLastSyncedAt || tpl.metaLastError) && (
        <p className={`mt-1.5 text-[11px] ${tpl.metaLastError ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>
          {tpl.metaLastError
            ? `${t('studio.templates.metaErrorPrefix')} ${tpl.metaLastError}`
            : `${t('studio.templates.lastSyncedPrefix')} ${new Date(tpl.metaLastSyncedAt!).toLocaleString()}`}
        </p>
      )}
    </li>
  )
}

// Variable chips ({{1}}, {{2}}) so the admin sees exactly what Meta will substitute.
function VariableChips({ analysis }: { analysis: TemplateAnalysis }) {
  const { t } = useI18n()
  if (analysis.variables.length === 0) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      <span
        className="text-[10px] uppercase tracking-wide text-gray-400"
        title={t('studio.templates.variablesHint')}
      >
        {t('studio.templates.variables')}
      </span>
      {analysis.variables.map((n) => (
        <span
          key={n}
          className="rounded bg-teal-100 px-1.5 py-0.5 font-mono text-[10px] text-teal-700 dark:bg-teal-900/40 dark:text-teal-300"
        >
          {`{{${n}}}`}
        </span>
      ))}
    </div>
  )
}

// Meta-rule issues (error = will be rejected, warning = fragile) surfaced inline.
function IssueList({ analysis }: { analysis: TemplateAnalysis }) {
  const { t } = useI18n()
  if (analysis.issues.length === 0) return null
  return (
    <ul className="mt-1.5 space-y-0.5">
      {analysis.issues.map((issue) => (
        <li
          key={issue.code}
          className={`flex items-start gap-1 text-[11px] ${
            issue.severity === 'error'
              ? 'text-red-600 dark:text-red-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          <span aria-hidden>{issue.severity === 'error' ? '⛔' : '⚠'}</span>
          <span>{t(`studio.templates.issue.${issue.code}` as const)}</span>
        </li>
      ))}
    </ul>
  )
}

// Collapsible explainer covering the rules that trip up first-time template authors.
function GuidancePanel() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const items: Array<{ title: string; body: string }> = [
    { title: t('studio.templates.guidance.window.title'), body: t('studio.templates.guidance.window.body') },
    { title: t('studio.templates.guidance.approval.title'), body: t('studio.templates.guidance.approval.body') },
    { title: t('studio.templates.guidance.vars.title'), body: t('studio.templates.guidance.vars.body') },
    { title: t('studio.templates.guidance.name.title'), body: t('studio.templates.guidance.name.body') },
  ]
  return (
    <div className="mb-3 rounded-lg border border-teal-200 bg-teal-50/60 dark:border-teal-900 dark:bg-teal-950/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-teal-800 dark:text-teal-200"
      >
        <span>💡 {t('studio.templates.guidance.toggle')}</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <dl className="grid gap-3 border-t border-teal-200 px-3 py-3 dark:border-teal-900 sm:grid-cols-2">
          {items.map((it) => (
            <div key={it.title}>
              <dt className="text-xs font-semibold text-gray-700 dark:text-gray-200">{it.title}</dt>
              <dd className="mt-0.5 text-xs text-gray-500">{it.body}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function NewTemplateForm({ clinicId }: { clinicId: string }) {
  const { t, language: panelLanguage } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<MessageTemplateCategory>('appointment_confirmation')
  const [language, setLanguage] = useState('es')
  const [body, setBody] = useState('')

  const analysis = useMemo(() => analyzeTemplate(body, name), [body, name])
  const metaType = CATEGORY_META_TYPE[category]

  const mutation = useMutation({
    mutationFn: () => api.post(`/clinics/${clinicId}/message-templates`, { name, category, language, body }),
    onSuccess: () => {
      setName('')
      setBody('')
      qc.invalidateQueries({ queryKey: ['message-templates', clinicId] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim() && body.trim() && analysis.valid) mutation.mutate()
  }

  const overLimit = analysis.charCount > TEMPLATE_BODY_MAX
  const canSubmit = Boolean(name.trim() && body.trim() && analysis.valid)

  function applyStarter(template: StarterTemplate) {
    setName(template.name)
    setCategory(template.category)
    setLanguage(template.language)
    setBody(template.body)
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-6 space-y-2 p-3"
    >
      <StarterTemplateLibrary onApply={applyStarter} />

      {mutation.isError && (
        <p role="alert" className="text-xs text-red-600">
          {mutation.error instanceof ApiError ? mutation.error.message : t('common.error')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-1 items-center gap-1">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('studio.templates.name')}
            className="min-w-[8rem] flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
          />
          <button
            type="button"
            onClick={() => setName(suggestTemplateName(name))}
            disabled={!name.trim()}
            title={t('studio.templates.nameSuggest')}
            aria-label={t('studio.templates.nameSuggest')}
            className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            ✨
          </button>
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as MessageTemplateCategory)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`studio.templates.category.${c}` as const)}
            </option>
          ))}
        </select>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <option value="es">{languageName('es', panelLanguage)}</option>
          <option value="en">{languageName('en', panelLanguage)}</option>
        </select>
      </div>

      {/* Meta category type the chosen category maps to — explained, not just labeled. */}
      <p className="text-[11px] text-gray-400" title={t('studio.templates.metaTypeHint')}>
        {t('studio.templates.metaTypeLabel')}{' '}
        <span className="font-medium text-gray-500">{t(`studio.templates.metaType.${metaType}` as const)}</span>
      </p>

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder={t('studio.templates.body')}
        className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
      />

      {/* Live char counter + variable chips + Meta-rule validation for the draft. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <VariableChips analysis={analysis} />
        <span className={`text-[11px] ${overLimit ? 'text-red-600' : 'text-gray-400'}`}>
          {analysis.charCount} / {TEMPLATE_BODY_MAX}
        </span>
      </div>
      {body.trim() !== '' && <IssueList analysis={analysis} />}

      <button
        type="submit"
        disabled={mutation.isPending || !canSubmit}
        className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
      >
        {t('studio.templates.submit')}
      </button>
    </form>
  )
}

function StarterTemplateLibrary({ onApply }: { onApply: (template: StarterTemplate) => void }) {
  const { t, language: panelLanguage } = useI18n()
  const [open, setOpen] = useState(true)

  return (
    <div className="clinic-card bg-gray-50 dark:bg-gray-950/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium"
      >
        <span>{t('studio.templates.starter.title')}</span>
        <span aria-hidden>{open ? '-' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-200 p-3 dark:border-gray-800">
          <p className="text-xs text-gray-500">{t('studio.templates.starter.help')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {STARTER_TEMPLATES.map((template) => (
              <button
                type="button"
                key={template.key}
                onClick={() => onApply(template)}
                className="rounded-md border border-gray-200 bg-white p-2 text-left hover:border-teal-300 hover:bg-teal-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-teal-700 dark:hover:bg-teal-950/30"
              >
                <span className="block text-xs font-medium">{template.name}</span>
                <span className="mt-1 block text-[11px] text-gray-500">
                  {t(`studio.templates.category.${template.category}` as const)} · {languageName(template.language, panelLanguage)}
                </span>
                <span className="mt-1 block line-clamp-2 text-[11px] text-gray-400">
                  {template.body}
                </span>
                {template.variableRoles.length > 0 && (
                  <span className="mt-1 block text-[10px] text-teal-700 dark:text-teal-400">
                    {t('studio.templates.starter.variablesIntro')}{' '}
                    {template.variableRoles
                      .map((role, i) => `{{${i + 1}}} = ${t(VAR_ROLE_KEY[role])}`)
                      .join(' · ')}
                  </span>
                )}
                <span className="mt-2 inline-block rounded bg-teal-600 px-2 py-1 text-[11px] font-semibold text-white">
                  {t('studio.templates.starter.use')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
