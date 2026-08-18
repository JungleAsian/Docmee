'use client'

// IA Studio — Custom flow management (Gap #34 / Rev1 #28). Keyword-triggered
// flows that bypass intent classification / the LLM. Single-shot OR multi-step
// with conditions (executed by the flow engine). List / create / edit / delete /
// enable, plus one-click instantiation of the prebuilt templates.
import { useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { PillToggle } from '@/shared/components/PillToggle'
import { formatDateTime } from '@/shared/format'
import type {
  CustomFlow,
  CustomFlowAction,
  CustomFlowBranchOp,
  CustomFlowLanguage,
  CustomFlowStep,
  FlowTemplate,
} from '@/shared/types'

const field =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

// R15: lazy-load the React Flow canvas — the list/form view doesn't need the
// @xyflow/react bundle until the user switches to the canvas view.
function CanvasLoading() {
  const { t } = useI18n()
  return (
    <div className="flex min-h-[16rem] items-center justify-center rounded-md border border-dashed border-gray-300 text-sm text-gray-500 dark:border-gray-700">
      {t('common.loading')}
    </div>
  )
}

const FlowCanvas = dynamic(
  () => import('@/shared/components/FlowCanvas').then((m) => m.FlowCanvas),
  { ssr: false, loading: () => <CanvasLoading /> },
)

// ── Editable models (string-backed for inputs) ──────────────────────────────────
interface EditableBranch {
  op: CustomFlowBranchOp
  keywords: string
  next: string
}
interface EditableStep {
  id: string
  messages: string
  collect: string
  next: string
  action: '' | CustomFlowAction
  branches: EditableBranch[]
  x?: number
  y?: number
  /** The original step, kept so Single Choice-only fields (options, header,
   *  renderMode, etc. — the Form view has no inputs for these; Canvas view
   *  does) survive a save made from this view instead of being stripped. */
  raw?: CustomFlowStep
}
interface EditableFlow {
  name: string
  keywords: string
  language: CustomFlowLanguage
  steps: EditableStep[]
  startStepId?: string
}

function emptyStep(id: string): EditableStep {
  return { id, messages: '', collect: '', next: '', action: '', branches: [] }
}

function stepToEditable(s: CustomFlowStep): EditableStep {
  return {
    id: s.id,
    messages: s.messages.join('\n'),
    collect: s.collect ?? '',
    next: s.next ?? '',
    action: s.action ?? '',
    branches: (s.branches ?? []).map((b) => ({
      op: b.op,
      keywords: (b.keywords ?? []).join(', '),
      next: b.next,
    })),
    x: s.x,
    y: s.y,
    raw: s,
  }
}

function flowToEditable(flow?: CustomFlow): EditableFlow {
  if (!flow) {
    return { name: '', keywords: '', language: 'both', steps: [emptyStep('step1')] }
  }
  const steps =
    flow.steps && flow.steps.length > 0
      ? flow.steps.map(stepToEditable)
      : [
          {
            ...emptyStep('step1'),
            messages: flow.messages.join('\n'),
            action: (flow.action ?? '') as '' | CustomFlowAction,
          },
        ]
  return {
    name: flow.name,
    keywords: flow.triggerKeywords.join(', '),
    language: flow.language,
    steps,
    startStepId: flow.startStepId ?? undefined,
  }
}

function templateToEditable(t: FlowTemplate): EditableFlow {
  return {
    name: t.name,
    keywords: t.triggerKeywords.join(', '),
    language: t.language,
    steps: t.steps.map(stepToEditable),
    startStepId: t.startStepId,
  }
}

const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
const splitLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

/** EditableStep[] -> canonical CustomFlowStep[] (preserves canvas x/y). */
function editableStepsToCustom(steps: EditableStep[]): CustomFlowStep[] {
  return steps.map((s, i) => {
    const branches = s.branches
      .filter((b) => b.next.trim())
      .map((b) => ({
        op: b.op,
        ...(b.op === 'contains' || b.op === 'equals' ? { keywords: splitCsv(b.keywords) } : {}),
        next: b.next.trim(),
      }))
    const base = {
      id: s.id.trim() || `step${i + 1}`,
      messages: splitLines(s.messages),
      ...(s.collect.trim() ? { collect: s.collect.trim() } : {}),
      ...(s.next.trim() ? { next: s.next.trim() } : {}),
      ...(s.action ? { action: s.action } : {}),
      ...(branches.length ? { branches } : {}),
      ...(typeof s.x === 'number' ? { x: s.x } : {}),
      ...(typeof s.y === 'number' ? { y: s.y } : {}),
    }
    // Single Choice fields (type/header/footer/renderMode/listButtonLabel/
    // options/storeAs/retryMessage/maxRetries/onFailNext) have no Form-view
    // inputs — carry them through from the original step so a save made from
    // this view doesn't silently drop them. `base`'s fields win on overlap.
    const extra = { ...(s.raw ?? {}) } as Partial<CustomFlowStep>
    delete extra.id
    delete extra.messages
    delete extra.collect
    delete extra.next
    delete extra.action
    delete extra.branches
    delete extra.x
    delete extra.y
    return { ...extra, ...base } as CustomFlowStep
  })
}

/** CustomFlowStep[] (from the canvas) -> EditableStep[] for the form model. */
function customStepsToEditable(steps: CustomFlowStep[]): EditableStep[] {
  return steps.map((s) => ({ ...stepToEditable(s), x: s.x, y: s.y }))
}

/** Build the API payload, or null when nothing meaningful was entered. */
function editableToPayload(e: EditableFlow): Record<string, unknown> | null {
  // drop fully-empty rows (no messages, no branches)
  const steps = editableStepsToCustom(e.steps).filter(
    (s) =>
      s.messages.length > 0 ||
      Boolean(s.collect) ||
      Boolean(s.next) ||
      Boolean(s.action) ||
      (s.branches?.length ?? 0) > 0 ||
      (s.options?.length ?? 0) > 0,
  )
  if (steps.length === 0) return null
  const startStepId = e.startStepId && steps.some((s) => s.id === e.startStepId) ? e.startStepId : steps[0]!.id
  return {
    name: e.name.trim(),
    triggerKeywords: splitCsv(e.keywords),
    language: e.language,
    steps,
    startStepId,
  }
}

export default function CustomFlowsPage() {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  // null = closed; flow = editing; initial = a template-backed unsaved draft.
  const [editor, setEditor] = useState<{ flow?: CustomFlow; initial?: EditableFlow } | null>(null)
  // CRE-69: confirm before the irreversible delete.
  const [pendingDelete, setPendingDelete] = useState<CustomFlow | null>(null)

  const key = ['custom-flows', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ flows: CustomFlow[] }>(`/clinics/${clinicId}/custom-flows`),
  })

  const templatesQuery = useQuery({
    queryKey: ['custom-flow-templates', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ templates: FlowTemplate[] }>(`/clinics/${clinicId}/custom-flows/templates`),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/clinics/${clinicId}/custom-flows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch(`/clinics/${clinicId}/custom-flows/${id}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const flows = query.data?.flows ?? []
  const templates = templatesQuery.data?.templates ?? []
  const bookingTemplate = templates.find((template) => template.key === 'schedule')

  // R5 deep links from the Automations hub gallery:
  //   ?template=<key>  → open the editor pre-filled from that template
  //   ?new=1           → open a blank editor
  const deepLinkHandledRef = useRef(false)
  useEffect(() => {
    if (deepLinkHandledRef.current || !clinicId) return
    const params = new URLSearchParams(window.location.search)
    if (!params.toString()) return
    const clear = () => window.history.replaceState(null, '', window.location.pathname)
    if (params.get('new') === '1') {
      deepLinkHandledRef.current = true
      setEditor({})
      clear()
      return
    }
    const tplKey = params.get('template')
    if (tplKey && templates.length > 0) {
      const tpl = templates.find((x) => x.key === tplKey)
      if (tpl) {
        deepLinkHandledRef.current = true
        setEditor({ initial: templateToEditable(tpl) })
        clear()
      }
    }
  }, [templates, clinicId])

  return (
    <div className="clinic-page space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t('studio.customFlows.title')}</h1>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('analytics.selectClinic')} />
      </div>

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.customFlows.selectClinic')}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setEditor({})}
              className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-700"
            >
              + {t('studio.customFlows.new')}
            </button>
          </div>

          {!editor && bookingTemplate ? (
            <section className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                {t('studio.customFlows.bookingGuideTitle')}
              </p>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
                {t('studio.customFlows.bookingGuideDesc')}
              </p>
              <ol className="mt-3 grid gap-2 text-xs text-gray-600 dark:text-gray-300 sm:grid-cols-3">
                <li>1. {t('studio.customFlows.bookingGuideStep1')}</li>
                <li>2. {t('studio.customFlows.bookingGuideStep2')}</li>
                <li>3. {t('studio.customFlows.bookingGuideStep3')}</li>
              </ol>
              <button
                type="button"
                onClick={() => setEditor({ initial: templateToEditable(bookingTemplate) })}
                className="mt-3 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                {t('studio.customFlows.bookingGuideStart')}
              </button>
            </section>
          ) : null}

          {/* Template gallery (Rev 2): one click opens a prebuilt flow in the
              editable copy — the no-blank-canvas starting point. */}
          {!editor && templates.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-medium text-gray-500">{t('studio.customFlows.fromTemplate')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((tpl) => (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => setEditor({ initial: templateToEditable(tpl) })}
                    className="group rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-cyan-400 hover:shadow-sm disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900"
                  >
                    <p className="text-sm font-medium group-hover:text-cyan-600 dark:group-hover:text-cyan-400">{tpl.name}</p>
                    <p className="mt-1 truncate text-[11px] text-gray-500">{tpl.triggerKeywords.slice(0, 4).join(', ')}</p>
                    <span className="mt-2 inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                      {tpl.steps.length} {t('studio.customFlows.stepCount')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {editor && (
            <FlowEditor
              key={editor.flow?.id ?? `draft-${editor.initial?.name ?? 'new'}`}
              clinicId={clinicId}
              flow={editor.flow}
              initial={editor.initial}
              onClose={() => setEditor(null)}
              onSaved={() => {
                setEditor(null)
                qc.invalidateQueries({ queryKey: key })
              }}
            />
          )}

          {query.isLoading ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : flows.length === 0 ? (
            <p className="text-sm text-gray-400">{t('studio.customFlows.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-950/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('studio.customFlows.colName')}</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('studio.customFlows.keywords')}</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('studio.customFlows.colUpdated')}</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('studio.customFlows.colActive')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {flows.map((flow) => {
                    const stepCount = flow.steps?.length ?? 0
                    return (
                      <tr key={flow.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900 dark:text-gray-100">{flow.name}</p>
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {stepCount > 0
                              ? `${stepCount} ${t('studio.customFlows.stepCount')}`
                              : t('studio.customFlows.singleStep')}
                          </span>
                        </td>
                        <td className="max-w-xs truncate px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                          {flow.triggerKeywords.join(', ')}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                          {formatDateTime(flow.updatedAt, language)}
                        </td>
                        <td className="px-3 py-2">
                          <PillToggle
                            checked={flow.enabled}
                            label={flow.enabled ? t('studio.customFlows.disable') : t('studio.customFlows.enable')}
                            onChange={(next) => toggleMutation.mutate({ id: flow.id, enabled: next })}
                            size="sm"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditor({ flow })}
                              className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                            >
                              {t('common.edit')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setPendingDelete(flow)}
                              className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                            >
                              {t('common.delete')}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('common.delete')}
        message={t('studio.customFlows.deleteConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

function FlowEditor({
  clinicId,
  flow,
  initial,
  onClose,
  onSaved,
}: {
  clinicId: string
  flow?: CustomFlow
  initial?: EditableFlow
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [model, setModel] = useState<EditableFlow>(() => initial ?? flowToEditable(flow))
  const [error, setError] = useState('')
  const [view, setView] = useState<'form' | 'canvas'>('form')

  const payload = useMemo(() => editableToPayload(model), [model])

  const save = useMutation({
    mutationFn: () => {
      if (!payload) throw new Error('empty')
      return flow
        ? api.patch(`/clinics/${clinicId}/custom-flows/${flow.id}`, payload)
        : api.post(`/clinics/${clinicId}/custom-flows`, payload)
    },
    onSuccess: onSaved,
  })

  function patchStep(i: number, patch: Partial<EditableStep>) {
    setModel((m) => ({ ...m, steps: m.steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) }))
  }
  function patchBranch(si: number, bi: number, patch: Partial<EditableBranch>) {
    setModel((m) => ({
      ...m,
      steps: m.steps.map((s, idx) =>
        idx === si ? { ...s, branches: s.branches.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : s,
      ),
    }))
  }

  function onSave() {
    if (!model.name.trim() || splitCsv(model.keywords).length === 0 || !payload) {
      setError(t('studio.customFlows.needStep'))
      return
    }
    setError('')
    save.mutate()
  }

  return (
    <div className="mb-6 space-y-3 rounded-lg border-2 border-cyan-300 bg-white p-4 dark:border-cyan-800 dark:bg-gray-900">
      <h2 className="font-semibold">{flow ? t('studio.customFlows.edit') : t('studio.customFlows.new')}</h2>

      <input
        value={model.name}
        onChange={(e) => setModel((m) => ({ ...m, name: e.target.value }))}
        placeholder={t('studio.customFlows.name')}
        className={field}
      />
      <input
        value={model.keywords}
        onChange={(e) => setModel((m) => ({ ...m, keywords: e.target.value }))}
        placeholder={t('studio.customFlows.triggerKeywords')}
        className={field}
      />
      <label className="flex items-center gap-2 text-xs text-gray-500">
        {t('studio.customFlows.language')}
        <select
          value={model.language}
          onChange={(e) => setModel((m) => ({ ...m, language: e.target.value as CustomFlowLanguage }))}
          className={`${field} max-w-[10rem]`}
        >
          <option value="both">{t('studio.customFlows.langBoth')}</option>
          <option value="es">{t('studio.customFlows.langEs')}</option>
          <option value="en">{t('studio.customFlows.langEn')}</option>
        </select>
      </label>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{t('studio.customFlows.steps')}</p>
          <div className="inline-flex overflow-hidden rounded-md border border-gray-300 text-xs dark:border-gray-700">
            <button type="button" onClick={() => setView('form')} className={`px-2.5 py-1 ${view === 'form' ? 'bg-cyan-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}>
              {t('studio.customFlows.viewForm')}
            </button>
            <button type="button" onClick={() => setView('canvas')} className={`px-2.5 py-1 ${view === 'canvas' ? 'bg-cyan-600 text-white' : 'text-gray-600 dark:text-gray-300'}`}>
              {t('studio.customFlows.viewCanvas')}
            </button>
          </div>
        </div>
        {view === 'canvas' ? (
          <FlowCanvas
            steps={editableStepsToCustom(model.steps)}
            startStepId={model.startStepId ?? model.steps[0]?.id ?? null}
            onChange={({ steps, startStepId }) =>
              setModel((m) => ({ ...m, steps: customStepsToEditable(steps), startStepId: startStepId ?? undefined }))
            }
          />
        ) : (
          <>
        {model.steps.map((step, si) => (
          <div key={si} className="space-y-2 rounded-md border border-gray-200 p-3 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <input
                value={step.id}
                onChange={(e) => patchStep(si, { id: e.target.value })}
                placeholder={t('studio.customFlows.stepId')}
                className={`${field} max-w-[12rem] font-mono`}
              />
              {si === 0 && (
                <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                  {t('studio.customFlows.startStep')}
                </span>
              )}
              {step.raw?.type === 'single_choice' && (
                <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                  {t('flows.canvas.singleChoiceFormNote', { count: step.raw.options?.length ?? 0 })}
                </span>
              )}
              {model.steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setModel((m) => ({ ...m, steps: m.steps.filter((_, idx) => idx !== si) }))}
                  className="ml-auto text-xs text-red-600 hover:underline"
                >
                  {t('studio.customFlows.removeStep')}
                </button>
              )}
            </div>
            <textarea
              value={step.messages}
              onChange={(e) => patchStep(si, { messages: e.target.value })}
              rows={2}
              placeholder={t('studio.customFlows.stepMessages')}
              className={`${field} resize-none`}
            />
            <div className="flex flex-wrap gap-2">
              <input
                value={step.collect}
                onChange={(e) => patchStep(si, { collect: e.target.value })}
                placeholder={t('studio.customFlows.collect')}
                className={`${field} max-w-[16rem]`}
              />
              <input
                value={step.next}
                onChange={(e) => patchStep(si, { next: e.target.value })}
                placeholder={t('studio.customFlows.defaultNext')}
                className={`${field} max-w-[20rem]`}
              />
              <select
                value={step.action}
                onChange={(e) => patchStep(si, { action: e.target.value as '' | CustomFlowAction })}
                className={`${field} max-w-[10rem]`}
              >
                <option value="">{t('studio.customFlows.actionNone')}</option>
                <option value="book">{t('studio.customFlows.actionBook')}</option>
                <option value="handoff">{t('studio.customFlows.actionHandoff')}</option>
                <option value="end">{t('studio.customFlows.actionEnd')}</option>
              </select>
            </div>

            {/* Conditions */}
            <div className="space-y-1.5 rounded bg-gray-50 p-2 dark:bg-gray-800/50">
              <p className="text-[11px] font-medium text-gray-500">{t('studio.customFlows.conditions')}</p>
              {step.branches.map((b, bi) => (
                <div key={bi} className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-gray-500">{t('studio.customFlows.condIf')}</span>
                  <select
                    value={b.op}
                    onChange={(e) => patchBranch(si, bi, { op: e.target.value as CustomFlowBranchOp })}
                    className={`${field} max-w-[9rem]`}
                  >
                    <option value="contains">{t('studio.customFlows.opContains')}</option>
                    <option value="equals">{t('studio.customFlows.opEquals')}</option>
                    <option value="yes">{t('studio.customFlows.opYes')}</option>
                    <option value="no">{t('studio.customFlows.opNo')}</option>
                    <option value="any">{t('studio.customFlows.opAny')}</option>
                  </select>
                  {(b.op === 'contains' || b.op === 'equals') && (
                    <input
                      value={b.keywords}
                      onChange={(e) => patchBranch(si, bi, { keywords: e.target.value })}
                      placeholder={t('studio.customFlows.condKeywords')}
                      className={`${field} max-w-[14rem]`}
                    />
                  )}
                  <input
                    value={b.next}
                    onChange={(e) => patchBranch(si, bi, { next: e.target.value })}
                    placeholder={t('studio.customFlows.condNext')}
                    className={`${field} max-w-[16rem]`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      patchStep(si, { branches: step.branches.filter((_, j) => j !== bi) })
                    }
                    className="text-xs text-red-600 hover:underline"
                  >
                    {t('studio.customFlows.removeCondition')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  patchStep(si, { branches: [...step.branches, { op: 'contains', keywords: '', next: '' }] })
                }
                className="text-xs text-cyan-600 hover:underline"
              >
                + {t('studio.customFlows.addCondition')}
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setModel((m) => ({ ...m, steps: [...m.steps, emptyStep(`step${m.steps.length + 1}`)] }))
          }
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          + {t('studio.customFlows.addStep')}
        </button>
          </>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={save.isPending}
          className="rounded-md bg-cyan-600 px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-60"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </div>
  )
}
