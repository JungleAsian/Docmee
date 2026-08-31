'use client'

// IA Studio — N8N-style automation workflows (Rev 3). A clinic builds a typed node
// graph (trigger → logic → action) on the visual canvas; active workflows run via
// the workflow-runner worker when their trigger fires. List / create / edit /
// activate / delete.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, type ApiIssue } from '@/shared/api/client'
import { ClinicSelect, useClinics } from '@/shared/components/ClinicSelect'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { BackButton } from '@/shared/components/BackButton'
import { PillToggle } from '@/shared/components/PillToggle'
import { formatDateTime } from '@/shared/format'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { WORKFLOW_TEMPLATES, personalizeWorkflowTemplate, type WorkflowTemplate } from '@/shared/workflowTemplates'
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, replacePresent, undoHistory } from '@/shared/workflowHistory'
import { layoutWorkflow } from '@/shared/workflowLayout'
import { serializeWorkflowExport, parseWorkflowExport } from '@/shared/workflowImport'
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowStatus } from '@/shared/types'

const btn = 'rounded-md px-3 py-1.5 text-sm font-medium'

// R15: the React Flow editor bundle (@xyflow/react) is heavy — split it out and
// fetch it only when a workflow is actually opened for editing, so the workflow
// list page stays lean.
function CanvasLoading() {
  const { t } = useI18n()
  return (
    <div className="flex h-full min-h-[16rem] items-center justify-center rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 dark:border-gray-700">
      {t('common.loading')}
    </div>
  )
}

const WorkflowCanvas = dynamic(
  () => import('@/shared/components/WorkflowCanvas').then((m) => m.WorkflowCanvas),
  { ssr: false, loading: () => <CanvasLoading /> },
)

// Builder mode is owned by the editor toolbar (item 16) and passed to the canvas.
// Type-only import — erased at build, so it never eager-loads the (dynamic) canvas.
type CanvasMode = 'enhanced' | 'classic'
const CANVAS_MODE_KEY = 'docmee.canvas.mode'
function readCanvasMode(): CanvasMode {
  if (typeof window === 'undefined') return 'enhanced'
  const stored = window.localStorage.getItem(CANVAS_MODE_KEY)
  return stored === 'classic' || stored === 'bp' ? 'classic' : 'enhanced'
}

function workflowIssueText(issue: ApiIssue, field: 'title' | 'whatHappened' | 'howToFix', language: 'es' | 'en'): string {
  if (language === 'es') return issue.translations?.es?.[field] ?? issue[field] ?? ''
  return issue[field] ?? ''
}

function workflowIssueCopy(language: 'es' | 'en', issueCount: number) {
  if (language === 'es') {
    return {
      summary:
        issueCount === 1
          ? '1 cosa necesita atención antes de guardar este flujo.'
          : `${issueCount} cosas necesitan atención antes de guardar este flujo.`,
      defaultTitle: 'Un elemento del flujo necesita atención',
      where: 'Dónde',
      whatHappened: 'Qué pasó',
      howToFix: 'Cómo arreglarlo',
      goToProblem: 'Ir al problema',
      showTechnicalDetails: 'Mostrar detalles técnicos',
    }
  }
  return {
    summary:
      issueCount === 1
        ? '1 thing needs attention before this workflow can be saved.'
        : `${issueCount} things need attention before this workflow can be saved.`,
    defaultTitle: 'One workflow item needs attention',
    where: 'Where',
    whatHappened: 'What happened',
    howToFix: 'How to fix it',
    goToProblem: 'Go to problem',
    showTechnicalDetails: 'Show technical details',
  }
}

export default function WorkflowsPage() {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // CRE-69: confirm before the irreversible delete.
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null)
  // Item 25 of the 25-item batch: the Q&A wizard entry point.
  const [wizardOpen, setWizardOpen] = useState(false)

  const key = ['workflows', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ workflows: Workflow[] }>(`/clinics/${clinicId}/workflows`),
  })
  const clinicsQuery = useClinics()
  const activeClinic = clinicsQuery.data?.clinics.find((clinic) => clinic.id === clinicId)
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/clinics/${clinicId}/workflows/${id}`),
    onMutate: () => setDeleteError(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (error: Error) => setDeleteError(error.message || t('common.error')),
  })
  const toggleMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: WorkflowStatus }) =>
      api.patch(`/clinics/${clinicId}/workflows/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const createFromTemplate = useMutation({
    // Re-run the same auto-layout the toolbar's "Auto Layout" button uses, so
    // a new workflow starts in the canonical organized arrangement instead of
    // depending on the template author having hand-placed non-overlapping
    // coordinates (harmless when they did, but not something future template
    // edits should have to get right by hand).
    //
    // The AI wizard can pass an override name and an opening greeting; the
    // greeting is written into the first send_message node's text (best-effort —
    // if the template has none, it's simply ignored, keeping the graph valid).
    mutationFn: ({ tpl, name, greeting }: { tpl: WorkflowTemplate; name?: string; greeting?: string }) => {
      let nodes = personalizeWorkflowTemplate(tpl, activeClinic)
      if (greeting && greeting.trim()) {
        let applied = false
        nodes = nodes.map((nd) => {
          if (!applied && nd.type === 'action.send_message') {
            applied = true
            return { ...nd, config: { ...nd.config, text: greeting.trim() } }
          }
          return nd
        })
      }
      return api.post<{ workflow: Workflow }>(`/clinics/${clinicId}/workflows`, {
        name: name?.trim() || t(tpl.nameKey as Parameters<typeof t>[0]),
        status: 'draft',
        nodes: layoutWorkflow(nodes, tpl.edges),
        edges: tpl.edges,
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: key })
      setEditing(res.workflow)
    },
  })

  const workflows = query.data?.workflows ?? []

  // R5 deep links from the Automations hub gallery (client-side read avoids a
  // useSearchParams Suspense requirement on this statically rendered page):
  //   ?template=<key>  → create from that template, then open the editor
  //   ?new=1           → open a blank (pre-seeded) editor
  //   ?edit=<id>       → open that workflow's editor
  const deepLinkHandledRef = useRef(false)
  useEffect(() => {
    if (deepLinkHandledRef.current || !clinicId) return
    const params = new URLSearchParams(window.location.search)
    if (!params.toString()) return
    const clear = () => window.history.replaceState(null, '', window.location.pathname)
    const tplKey = params.get('template')
    if (tplKey) {
      const tpl = WORKFLOW_TEMPLATES.find((x) => x.key === tplKey)
      if (tpl) {
        deepLinkHandledRef.current = true
        createFromTemplate.mutate({ tpl })
        clear()
      }
      return
    }
    if (params.get('new') === '1') {
      deepLinkHandledRef.current = true
      setEditing('new')
      clear()
      return
    }
    const editId = params.get('edit')
    if (editId && workflows.length > 0) {
      const wf = workflows.find((w) => w.id === editId)
      if (wf) {
        deepLinkHandledRef.current = true
        setEditing(wf)
        clear()
      }
    }
  }, [workflows, clinicId])

  return (
    <div className="clinic-page space-y-6">
      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('wf.deleteConfirmTitle')}
        message={t('wf.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t('wf.title')}</h1>
          <p className="text-sm text-gray-500">{t('wf.subtitle')}</p>
        </div>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('analytics.selectClinic')} />
      </header>

      {deleteError && (
        <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {deleteError}
        </p>
      )}

      {!clinicId ? (
        <p className="text-sm text-gray-500">{t('analytics.selectClinicPrompt')}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing('new')} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-700`}>
              + {t('wf.new')}
            </button>
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className={`${btn} border border-cyan-300 text-cyan-700 hover:bg-cyan-50 dark:border-cyan-800 dark:text-cyan-200 dark:hover:bg-cyan-950/40`}
            >
              ✨ {t('wf.wizard.start')}
            </button>
          </div>

          <AutomationWizard
            open={wizardOpen}
            onClose={() => setWizardOpen(false)}
            clinicId={clinicId}
            onApply={(tpl, opts) => {
              setWizardOpen(false)
              createFromTemplate.mutate({ tpl, name: opts.name, greeting: opts.greeting })
            }}
            pending={createFromTemplate.isPending}
          />

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('wf.templates')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  disabled={createFromTemplate.isPending}
                  onClick={() => createFromTemplate.mutate({ tpl })}
                  className="rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-cyan-300 hover:bg-cyan-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:hover:bg-gray-800"
                >
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{t(tpl.nameKey as Parameters<typeof t>[0])}</p>
                  <p className="mt-0.5 text-xs text-gray-500">{t(tpl.descKey as Parameters<typeof t>[0])}</p>
                </button>
              ))}
            </div>
          </section>
          {query.isLoading ? (
            <p className="text-sm text-gray-500">{t('common.loading')}</p>
          ) : workflows.length === 0 ? (
            <p className="text-sm text-gray-500">{t('wf.empty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-gray-800">
                <thead className="bg-gray-50 dark:bg-gray-950/50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('wf.colName')}</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('wf.colUpdated')}</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">{t('wf.colActive')}</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {workflows.map((wf) => (
                    <tr key={wf.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-800 dark:text-gray-100">{wf.name}</p>
                        <p className="text-xs text-gray-500">{wf.nodes.length} {t('wf.nodes')}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
                        {formatDateTime(wf.updatedAt, language)}
                      </td>
                      <td className="px-3 py-2">
                        <PillToggle
                          checked={wf.status === 'active'}
                          label={wf.status === 'active' ? t('wf.deactivate') : t('wf.activate')}
                          onChange={(next) => toggleMutation.mutate({ id: wf.id, status: next ? 'active' : 'draft' })}
                          size="sm"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => setEditing(wf)} className={`${btn} border border-gray-300 text-gray-700 dark:text-gray-200`}>
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(wf)}
                            className={`${btn} border border-red-300 text-red-600`}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Full-viewport editor surface (R1): the canvas gets the whole screen,
          free of the overview page content. */}
      {editing && clinicId && (
        <div className="fixed inset-0 z-50 flex flex-col bg-gray-50 dark:bg-gray-950">
          <WorkflowEditor
            clinicId={clinicId}
            workflow={editing === 'new' ? undefined : editing}
            onClose={() => {
              setEditing(null)
              qc.invalidateQueries({ queryKey: key })
            }}
          />
        </div>
      )}
    </div>
  )
}

// Item 25 of the 25-item batch: a Q&A wizard that picks the closest-matching
// entry from WORKFLOW_TEMPLATES and lands the admin in the editor with a
// pre-filled starter graph instead of a blank canvas. One question (goal) —
// the template library only has three entries today, so a longer
// questionnaire would outrun what it can actually branch to.
type WizardKey = Parameters<ReturnType<typeof useI18n>['t']>[0]

// Guided-Q&A options. The chosen value is sent to the clinic AI as context and
// also drives the deterministic fallback template when the AI is unavailable, so
// the wizard always produces a valid workflow.
const WIZARD_GOAL_OPTIONS: { value: string; labelKey: WizardKey; fallback: string }[] = [
  { value: 'book_confirm', labelKey: 'wf.wizard.goalOpt.booking', fallback: 'guided_whatsapp_booking' },
  { value: 'quick_book', labelKey: 'wf.wizard.goalOpt.quick', fallback: 'single_turn_booking' },
  { value: 'urgent_triage', labelKey: 'wf.wizard.goalOpt.urgent', fallback: 'urgent_keyword' },
  { value: 'other', labelKey: 'wf.wizard.goalOpt.other', fallback: 'guided_whatsapp_booking' },
]
const WIZARD_TONE_OPTIONS: { value: string; labelKey: WizardKey }[] = [
  { value: 'professional', labelKey: 'wf.wizard.toneOpt.professional' },
  { value: 'friendly', labelKey: 'wf.wizard.toneOpt.friendly' },
  { value: 'brief', labelKey: 'wf.wizard.toneOpt.brief' },
]

const wizardFieldCls =
  'w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-cyan-500 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950'

// "Start with a wizard" — a guided Q&A that hands the operator's answers + the
// clinic's context to the clinic AI (POST /workflows/wizard), which picks the
// best-fit template and drafts a tailored name + opening greeting. Falls back to
// a deterministic template for the chosen goal if the AI is off or errors, so it
// never dead-ends. The actual (already-valid) graph is built from the template.
function AutomationWizard({
  open,
  onClose,
  clinicId,
  onApply,
  pending,
}: {
  open: boolean
  onClose: () => void
  clinicId: string
  onApply: (tpl: WorkflowTemplate, opts: { name?: string; greeting?: string }) => void
  pending: boolean
}) {
  const { t } = useI18n()
  const [goal, setGoal] = useState('book_confirm')
  const [tone, setTone] = useState('professional')
  const [detail, setDetail] = useState('')
  const [generating, setGenerating] = useState(false)
  const [failedSoft, setFailedSoft] = useState(false)
  if (!open) return null

  const busy = generating || pending

  const pickFallback = (): WorkflowTemplate => {
    const opt = WIZARD_GOAL_OPTIONS.find((o) => o.value === goal)
    return (
      WORKFLOW_TEMPLATES.find((x) => x.key === (opt?.fallback ?? WORKFLOW_TEMPLATES[0].key)) ??
      WORKFLOW_TEMPLATES[0]
    )
  }

  async function onGenerate() {
    setGenerating(true)
    setFailedSoft(false)
    const templates = WORKFLOW_TEMPLATES.map((tpl) => ({
      key: tpl.key,
      name: t(tpl.nameKey as WizardKey),
      description: t(tpl.descKey as WizardKey),
    }))
    try {
      const res = await api.post<{ templateKey: string; name?: string; greeting?: string }>(
        `/clinics/${clinicId}/workflows/wizard`,
        { answers: { goal, tone, detail: detail.trim() }, templates },
      )
      const tpl = WORKFLOW_TEMPLATES.find((x) => x.key === res.templateKey) ?? pickFallback()
      onApply(tpl, { name: res.name, greeting: res.greeting })
    } catch {
      // Never dead-end — fall back to a deterministic template for the goal.
      setFailedSoft(true)
      onApply(pickFallback(), {})
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{t('wf.wizard.title')}</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{t('wf.wizard.subtitle')}</p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('wf.wizard.goalLabel')}</span>
            <select value={goal} onChange={(e) => setGoal(e.target.value)} disabled={busy} className={wizardFieldCls}>
              {WIZARD_GOAL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('wf.wizard.toneLabel')}</span>
            <select value={tone} onChange={(e) => setTone(e.target.value)} disabled={busy} className={wizardFieldCls}>
              {WIZARD_TONE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">{t('wf.wizard.detailLabel')}</span>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              rows={3}
              disabled={busy}
              placeholder={t('wf.wizard.detailPlaceholder')}
              className={`${wizardFieldCls} resize-none`}
            />
          </label>
        </div>

        {failedSoft && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{t('wf.wizard.error')}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={busy}
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {busy ? t('wf.wizard.generating') : `✨ ${t('wf.wizard.generate')}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Starter chain for a blank workflow (R4): trigger → ask → wait, so the
    canvas never opens empty. */
function seedNodes(): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  return {
    nodes: [
      { id: 'message_keyword_1', kind: 'trigger', type: 'trigger.message_keyword', config: {}, x: 40, y: 140 },
      { id: 'ask_capture_1', kind: 'action', type: 'action.ask_capture', config: {}, x: 320, y: 140 },
      { id: 'wait_for_reply_1', kind: 'logic', type: 'logic.wait_for_reply', config: {}, x: 600, y: 140 },
    ],
    edges: [
      { id: 'e_seed_1', source: 'message_keyword_1', target: 'ask_capture_1' },
      { id: 'e_seed_2', source: 'ask_capture_1', target: 'wait_for_reply_1' },
    ],
  }
}

function WorkflowEditor({
  clinicId,
  workflow,
  onClose,
}: {
  clinicId: string
  workflow?: Workflow
  onClose: () => void
}) {
  const { t, language } = useI18n()
  const seed = useMemo(() => (workflow ? { nodes: workflow.nodes, edges: workflow.edges } : seedNodes()), [workflow])
  const [name, setName] = useState(workflow?.name ?? '')
  const [status, setStatus] = useState<WorkflowStatus>(workflow?.status ?? 'draft')
  // Builder mode (Enhanced / Guided) — lifted here so its toggle lives in the
  // toolbar (item 16); persisted per-browser.
  const [mode, setMode] = useState<CanvasMode>(() => readCanvasMode())
  const changeMode = useCallback((next: CanvasMode) => {
    setMode(next)
    try {
      window.localStorage.setItem(CANVAS_MODE_KEY, next)
    } catch {
      /* private mode — pref simply won't persist */
    }
  }, [])
  // Dirty guard (R17): unsaved edits survive neither an accidental close nor a
  // full page unload.
  const [dirty, setDirty] = useState(false)
  // Canvas state lives in an undo history; every canvas mutation flows through
  // the single onChange below. Keystroke bursts within 600 ms coalesce into one
  // step so typing a sentence is one undo, not thirty.
  const [hist, setHist] = useState(() => createHistory({ nodes: seed.nodes, edges: seed.edges }))
  const lastPushAtRef = useRef(0)
  const nodes = hist.present.nodes
  const edges = hist.present.edges
  const [importError, setImportError] = useState<string | null>(null)
  const [focusedIssue, setFocusedIssue] = useState<ApiIssue | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const applyCanvasChange = useCallback((next: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => {
    const now = Date.now()
    setHist((h) => (now - lastPushAtRef.current > 600 ? pushHistory(h, next) : replacePresent(h, next)))
    lastPushAtRef.current = now
    setDirty(true)
  }, [])

  const undo = useCallback(() => {
    let changed = false
    setHist((h) => {
      const next = undoHistory(h)
      changed = next !== h
      return next
    })
    if (changed) setDirty(true)
    lastPushAtRef.current = 0
  }, [])

  const redo = useCallback(() => {
    let changed = false
    setHist((h) => {
      const next = redoHistory(h)
      changed = next !== h
      return next
    })
    if (changed) setDirty(true)
    lastPushAtRef.current = 0
  }, [])

  const autoLayout = useCallback(() => {
    setHist((h) => pushHistory(h, { nodes: layoutWorkflow(h.present.nodes, h.present.edges), edges: h.present.edges }))
    lastPushAtRef.current = Date.now()
    setDirty(true)
  }, [])

  const handleExport = useCallback(() => {
    const raw = serializeWorkflowExport(name.trim() || t('wf.untitled'), nodes, edges)
    const blob = new Blob([raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const filename = `${(name.trim() || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'workflow'}.json`
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [name, nodes, edges, t])

  const handleImportFile = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = '' // allow re-importing the same filename twice in a row
      if (!file) return
      const raw = await file.text()
      const result = parseWorkflowExport(raw)
      if (!result.ok) {
        setImportError(t(result.error))
        return
      }
      setImportError(null)
      setHist((h) => pushHistory(h, { nodes: layoutWorkflow(result.nodes, result.edges), edges: result.edges }))
      lastPushAtRef.current = Date.now()
      setDirty(true)
      // Only prefill the name if the admin hasn't already typed one -- never
      // clobber an in-progress rename with whatever the imported file was called.
      if (result.name && !name.trim()) setName(result.name)
    },
    [name, t],
  )

  // Ctrl/Cmd+Z, Ctrl+Shift+Z, Ctrl+Y — skipped while typing in a form field so
  // native text undo keeps working there.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
      if (typing || !(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const requestClose = useCallback(() => {
    if (dirty && !window.confirm(t('wf.unsavedChanges'))) return
    onClose()
  }, [dirty, onClose, t])

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim() || t('wf.untitled'), status, nodes, edges }
      return workflow
        ? api.patch(`/clinics/${clinicId}/workflows/${workflow.id}`, payload)
        : api.post(`/clinics/${clinicId}/workflows`, payload)
    },
    onSuccess: () => {
      setDirty(false)
      setFocusedIssue(null)
      onClose()
    },
  })

  const saveIssues = save.error instanceof ApiError ? save.error.issues ?? [] : []
  const issueCopy = workflowIssueCopy(language, saveIssues.length)

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <BackButton onClick={requestClose} label={t('wf.backToWorkflows')} className={`${btn} border border-gray-300 text-gray-700 dark:text-gray-200`} />
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          placeholder={t('wf.namePlaceholder')}
          className="w-56 min-w-40 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <span className="flex-1" />
        {/* Enhanced / Guided builder toggle — moved here from the canvas overlay
            (item 16), sitting just before Undo. */}
        <div className="flex overflow-hidden rounded-md border border-gray-300 text-xs font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300">
          {(['enhanced', 'classic'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => changeMode(m)}
              className={`px-2.5 py-1 ${mode === m ? 'bg-teal-600 text-white' : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700'}`}
            >
              {m === 'enhanced' ? t('wf.enhancedBuilder') : t('wf.guidedBuilder')}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input
            type="checkbox"
            checked={status === 'active'}
            onChange={(e) => {
              setStatus(e.target.checked ? 'active' : 'draft')
              setDirty(true)
            }}
          />
          {t('wf.activeToggle')}
        </label>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo(hist)}
          title="Ctrl+Z"
          className={`${btn} border border-gray-300 text-gray-700 disabled:opacity-40 dark:text-gray-200`}
        >
          ↶ {t('wf.undo')}
        </button>
        <button
          type="button"
          onClick={redo}
          disabled={!canRedo(hist)}
          title="Ctrl+Shift+Z"
          className={`${btn} border border-gray-300 text-gray-700 disabled:opacity-40 dark:text-gray-200`}
        >
          ↷ {t('wf.redo')}
        </button>
        <button
          type="button"
          onClick={autoLayout}
          disabled={nodes.length === 0}
          className={`${btn} border border-gray-300 text-gray-700 disabled:opacity-40 dark:text-gray-200`}
        >
          ▦ {t('wf.autoLayout')}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={nodes.length === 0}
          className={`${btn} border border-gray-300 text-gray-700 disabled:opacity-40 dark:text-gray-200`}
        >
          ⭳ {t('wf.export')}
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`${btn} border border-gray-300 text-gray-700 dark:text-gray-200`}
        >
          ⭱ {t('wf.import')}
        </button>
        <input ref={fileInputRef} type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50`}>
          {t('common.save')}
        </button>
      </div>
      {importError && (
        <div role="alert" className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {importError}
        </div>
      )}
      {save.isError && (
        <div role="alert" className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          <p className="font-medium">
            {t('wf.saveFailed')}: {save.error instanceof ApiError ? save.error.message : t('common.error')}
          </p>
          {saveIssues.length > 0 ? (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-500 dark:text-red-300">
                {issueCopy.summary}
              </p>
              {saveIssues.map((issue, i) => {
                const title = workflowIssueText(issue, 'title', language) || issueCopy.defaultTitle
                const whatHappened = workflowIssueText(issue, 'whatHappened', language)
                const howToFix = workflowIssueText(issue, 'howToFix', language)
                return (
                  <div key={`${issue.edgeId ?? issue.nodeId ?? issue.code ?? 'issue'}-${i}`} className="rounded-md border border-red-200 bg-white p-3 text-gray-800 shadow-sm dark:border-red-900 dark:bg-gray-950 dark:text-gray-100">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-red-700 dark:text-red-300">{title}</p>
                        {issue.where && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{issueCopy.where}: {issue.where}</p>}
                      </div>
                      {(issue.nodeId || issue.edgeId) && (
                        <button
                          type="button"
                          onClick={() => setFocusedIssue(issue)}
                          className="rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-200 dark:hover:bg-red-950"
                        >
                          {issueCopy.goToProblem}
                        </button>
                      )}
                    </div>
                    {whatHappened && (
                      <p className="mt-2 text-sm"><span className="font-medium">{issueCopy.whatHappened}:</span> {whatHappened}</p>
                    )}
                    {howToFix && (
                      <p className="mt-1 text-sm"><span className="font-medium">{issueCopy.howToFix}:</span> {howToFix}</p>
                    )}
                    {issue.technicalDetails && (
                      <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        <summary className="cursor-pointer font-medium">{issueCopy.showTechnicalDetails}</summary>
                        <p className="mt-1 break-words font-mono">{issue.technicalDetails}</p>
                      </details>
                    )}
                  </div>
                )
              })}
            </div>
          ) : save.error instanceof ApiError && save.error.details && save.error.details.length > 0 && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer font-medium">{issueCopy.showTechnicalDetails}</summary>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {save.error.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <p className="px-4 pt-2 text-xs text-gray-500">{t('wf.canvasHint')}</p>
      <div className="min-h-0 flex-1 p-4 pt-2">
        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          onChange={applyCanvasChange}
          clinicId={clinicId}
          workflowId={workflow?.id}
          mode={mode}
          focusIssue={focusedIssue}
        />
      </div>
    </>
  )
}
