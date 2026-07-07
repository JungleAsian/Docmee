'use client'

// IA Studio — N8N-style automation workflows (Rev 3). A clinic builds a typed node
// graph (trigger → logic → action) on the visual canvas; active workflows run via
// the workflow-runner worker when their trigger fires. List / create / edit /
// activate / delete.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { WorkflowCanvas } from '@/shared/components/WorkflowCanvas'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { NoCodeBuilderGuide } from '@/shared/components/NoCodeBuilderGuide'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/shared/workflowTemplates'
import type { Workflow, WorkflowNode, WorkflowEdge, WorkflowStatus } from '@/shared/types'

const btn = 'rounded-md px-3 py-1.5 text-sm font-medium'

export default function WorkflowsPage() {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { clinicId, switchClinic } = useActiveClinic()
  const [editing, setEditing] = useState<Workflow | 'new' | null>(null)
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
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
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

      <NoCodeBuilderGuide active="workflows" />

      {!clinicId ? (
        <p className="text-sm text-gray-500">{t('analytics.selectClinicPrompt')}</p>
      ) : editing ? (
        <WorkflowEditor
          clinicId={clinicId}
          workflow={editing === 'new' ? undefined : editing}
          onClose={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: key })
          }}
        />
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
    </div>
  )
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
  const [name, setName] = useState(workflow?.name ?? '')
  const [status, setStatus] = useState<WorkflowStatus>(workflow?.status ?? 'draft')
  const [nodes, setNodes] = useState<WorkflowNode[]>(workflow?.nodes ?? [])
  const [edges, setEdges] = useState<WorkflowEdge[]>(workflow?.edges ?? [])

  const save = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim() || t('wf.untitled'), status, nodes, edges }
      return workflow
        ? api.patch(`/clinics/${clinicId}/workflows/${workflow.id}`, payload)
        : api.post(`/clinics/${clinicId}/workflows`, payload)
    },
    onSuccess: onClose,
  })

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('wf.namePlaceholder')}
          className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
          <input type="checkbox" checked={status === 'active'} onChange={(e) => setStatus(e.target.checked ? 'active' : 'draft')} />
          {t('wf.activeToggle')}
        </label>
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className={`${btn} bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50`}>
          {t('common.save')}
        </button>
        <button type="button" onClick={onClose} className={`${btn} border border-gray-300 text-gray-700 dark:text-gray-200`}>
          {t('common.cancel')}
        </button>
      </div>
      <p className="text-xs text-gray-500">{t('wf.canvasHint')}</p>
      <WorkflowCanvas
        nodes={nodes}
        edges={edges}
        onChange={(next) => {
          setNodes(next.nodes)
          setEdges(next.edges)
        }}
      />
    </div>
  )
}
