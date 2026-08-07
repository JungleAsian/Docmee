'use client'

// IA Studio — N8N-style automation workflows (Rev 3). A clinic builds a typed node
// graph (trigger → logic → action) on the visual canvas; active workflows run via
// the workflow-runner worker when their trigger fires. List / create / edit /
// activate / delete.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/shared/workflowTemplates'
import { canRedo, canUndo, createHistory, pushHistory, redoHistory, replacePresent, undoHistory } from '@/shared/workflowHistory'
import { layoutWorkflow } from '@/shared/workflowLayout'
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

export default function WorkflowsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // CRE-69: confirm before the irreversible delete.
  const [pendingDelete, setPendingDelete] = useState<Workflow | null>(null)

  const key = ['workflows', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ workflows: Workflow[] }>(`/clinics/${clinicId}/workflows`),
  })
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
    mutationFn: (tpl: WorkflowTemplate) =>
      api.post<{ workflow: Workflow }>(`/clinics/${clinicId}/workflows`, {
        name: t(tpl.nameKey as Parameters<typeof t>[0]),
        status: 'draft',
        nodes: tpl.nodes,
        edges: tpl.edges,
      }),
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
        createFromTemplate.mutate(tpl)
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
          <Link href="/studio/automations" className="text-xs font-medium text-cyan-700 hover:underline dark:text-cyan-300">
            ← {t('hub.backToHub')}
          </Link>
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
          <button type="button" onClick={() => setEditing('new')} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-700`}>
            + {t('wf.new')}
          </button>

          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">{t('wf.templates')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {WORKFLOW_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.key}
                  type="button"
                  disabled={createFromTemplate.isPending}
                  onClick={() => createFromTemplate.mutate(tpl)}
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
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800">
              {workflows.map((wf) => (
                <li key={wf.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <div>
                    <p className="font-medium text-gray-800 dark:text-gray-100">{wf.name}</p>
                    <p className="text-xs text-gray-500">
                      {wf.nodes.length} {t('wf.nodes')} ·{' '}
                      <span className={wf.status === 'active' ? 'text-emerald-600' : 'text-gray-400'}>{t(`wf.status.${wf.status}`)}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <button
                      type="button"
                      onClick={() => toggleMutation.mutate({ id: wf.id, status: wf.status === 'active' ? 'draft' : 'active' })}
                      className={`${btn} border ${wf.status === 'active' ? 'border-gray-300 text-gray-600' : 'border-emerald-300 text-emerald-700'}`}
                    >
                      {wf.status === 'active' ? t('wf.deactivate') : t('wf.activate')}
                    </button>
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
                </li>
              ))}
            </ul>
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
  const { t } = useI18n()
  const seed = useMemo(() => (workflow ? { nodes: workflow.nodes, edges: workflow.edges } : seedNodes()), [workflow])
  const [name, setName] = useState(workflow?.name ?? '')
  const [status, setStatus] = useState<WorkflowStatus>(workflow?.status ?? 'draft')
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
      onClose()
    },
  })

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-900">
        <button type="button" onClick={requestClose} className={`${btn} border border-gray-300 text-gray-700 dark:text-gray-200`}>
          ← {t('wf.backToWorkflows')}
        </button>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setDirty(true)
          }}
          placeholder={t('wf.namePlaceholder')}
          className="min-w-40 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
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
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50`}>
          {t('common.save')}
        </button>
      </div>
      <p className="px-4 pt-2 text-xs text-gray-500">{t('wf.canvasHint')}</p>
      <div className="min-h-0 flex-1 p-4 pt-2">
        <WorkflowCanvas
          nodes={nodes}
          edges={edges}
          onChange={applyCanvasChange}
          clinicId={clinicId}
        />
      </div>
    </>
  )
}
