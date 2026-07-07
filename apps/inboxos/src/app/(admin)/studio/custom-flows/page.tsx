'use client'

// IA Studio — Custom flow management (Gap #34 / Rev1 #28). Keyword-triggered
// flows that bypass intent classification / the LLM. Single-shot OR multi-step
// with conditions (executed by the flow engine). List / create / edit / delete /
// enable, plus one-click instantiation of the prebuilt templates.
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { FlowCanvas } from '@/shared/components/FlowCanvas'
import { NoCodeBuilderGuide } from '@/shared/components/NoCodeBuilderGuide'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
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
    return {
      id: s.id.trim() || `step${i + 1}`,
      messages: splitLines(s.messages),
      ...(s.collect.trim() ? { collect: s.collect.trim() } : {}),
      ...(s.next.trim() ? { next: s.next.trim() } : {}),
      ...(s.action ? { action: s.action } : {}),
      ...(branches.length ? { branches } : {}),
      ...(typeof s.x === 'number' ? { x: s.x } : {}),
      ...(typeof s.y === 'number' ? { y: s.y } : {}),
    } as CustomFlowStep
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
      (s.branches?.length ?? 0) > 0,
  )
  if (steps.length === 0) return null
  const startStepId = e.startStepId && steps.some((s) => s.id === e.startStepId) ? e.startStepId : steps[0]!.id
  return {
    name: e.name.trim(),
    triggerKeywords: splitCsv(e.keywords),
    language: e.language,
    steps,
    startStepId,
    messages: [],
  }
}

export default function CustomFlowsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  // null = closed; { flow } = editing; {} = creating new
  const [editor, setEditor] = useState<{ flow?: CustomFlow } | null>(null)

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

  const createFromTemplate = useMutation({
    mutationFn: (tpl: FlowTemplate) =>
      api.post(`/clinics/${clinicId}/custom-flows`, editableToPayload(templateToEditable(tpl))),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const flows = query.data?.flows ?? []
  const templates = templatesQuery.data?.templates ?? []

  return (
    <div className="clinic-page space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('studio.customFlows.title')}</h1>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('analytics.selectClinic')} />
      </div>

      <NoCodeBuilderGuide active="custom_flows" />

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

          {/* Template gallery (Rev 2): one click instantiates a prebuilt flow into an
              editable copy — the no-blank-canvas starting point. */}
          {!editor && templates.length > 0 && (
            <div className="mb-5">
              <p className="mb-2 text-xs font-medium text-gray-500">{t('studio.customFlows.fromTemplate')}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {templates.map((tpl) => (
                  <button
                    key={tpl.key}
                    type="button"
                    onClick={() => createFromTemplate.mutate(tpl)}
                    disabled={createFromTemplate.isPending}
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
              clinicId={clinicId}
              flow={editor.flow}
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
            <ul className="space-y-2">
              {flows.map((flow) => {
                const stepCount = flow.steps?.length ?? 0
                return (
                  <li
                    key={flow.id}
                    className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {flow.name}
                          {!flow.enabled && (
                            <span className="ml-2 text-xs text-gray-400">({t('studio.customFlows.disable')})</span>
                          )}
                          <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-normal text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                            {stepCount > 0
                              ? `${stepCount} ${t('studio.customFlows.stepCount')}`
                              : t('studio.customFlows.singleStep')}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          {t('studio.customFlows.keywords')}: {flow.triggerKeywords.join(', ')}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => setEditor({ flow })}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          {t('common.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleMutation.mutate({ id: flow.id, enabled: !flow.enabled })}
                          className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        >
                          {flow.enabled ? t('studio.customFlows.disable') : t('studio.customFlows.enable')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(t('studio.customFlows.deleteConfirm'))) deleteMutation.mutate(flow.id)
                          }}
                          className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                        >
                          {t('common.delete')}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

function FlowEditor({
  clinicId,
  flow,
  onClose,
  onSaved,
}: {
  clinicId: string
  flow?: CustomFlow
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [model, setModel] = useState<EditableFlow>(() => flowToEditable(flow))
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
