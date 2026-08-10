'use client'

// The "Guided" builder — a fill-in-the-blank / linear-steps alternative to the
// canvas, replacing the old "Classic" mode (which used to be the same React
// Flow canvas, just re-skinned). No drag, no free positioning, no drawn
// connections: the workflow is an ordered list of step cards. A non-branching
// step's "next step" is simply the next card in the list (recomputed
// automatically by resequenceLinearEdges as the list changes); a branching
// step (condition, interactive_menu, ai_classify_intent, ai_agent) instead
// gets one "go to step" dropdown per branch handle. Reuses the exact same
// NodeConfigPanel as the Enhanced canvas so the two editors can never drift
// apart on what fields a node type exposes.
//
// Same controlled contract as WorkflowCanvas ({ nodes, edges, onChange,
// clinicId, workflowId }) so the parent can swap between the two freely
// without losing in-progress edits.
import { useState } from 'react'
import { useI18n } from '../hooks/useI18n'
import type { WorkflowNode as WfNode, WorkflowEdge as WfEdge } from '../types'
import { WORKFLOW_NODE_TYPES, nodeDef, NODE_KIND_TONE, NODE_KIND_BADGE, branchRows, type NodeTypeDef } from '../workflowNodes'
import { isBranchingNode, resequenceLinearEdges } from '../workflowLinearEdges'
import { NodeConfigPanel } from './NodeConfigPanel'

const TRIGGER_DEFS = WORKFLOW_NODE_TYPES.filter((d) => d.kind === 'trigger')
const ADDABLE_DEFS = WORKFLOW_NODE_TYPES.filter((d) => d.kind !== 'trigger')

function nextNodeId(existing: WfNode[], def: NodeTypeDef): string {
  const base = def.type.split('.')[1] ?? 'node'
  let n = existing.length + 1
  while (existing.some((x) => x.id === `${base}_${n}`)) n++
  return `${base}_${n}`
}

export function WorkflowLinearEditor({
  nodes,
  edges,
  onChange,
  clinicId,
  workflowId,
}: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
  clinicId?: string
  workflowId?: string
}) {
  const { t } = useI18n()
  const [addPickerOpen, setAddPickerOpen] = useState(false)

  const trigger = nodes.find((n) => n.kind === 'trigger') ?? null
  const bodySteps = nodes.filter((n) => n.kind !== 'trigger')
  const steps = trigger ? [trigger, ...bodySteps] : bodySteps

  const label = (type: string) => t((nodeDef(type)?.labelKey ?? type) as Parameters<typeof t>[0])

  const addTrigger = (def: NodeTypeDef) => {
    const newTrigger: WfNode = { id: nextNodeId(nodes, def), kind: def.kind, type: def.type, config: {}, x: 0, y: 0 }
    const nextNodes = [newTrigger, ...nodes]
    const nextSteps = [newTrigger, ...bodySteps]
    onChange({ nodes: nextNodes, edges: resequenceLinearEdges(nextSteps, edges) })
  }

  const addStep = (def: NodeTypeDef) => {
    const newStep: WfNode = { id: nextNodeId(nodes, def), kind: def.kind, type: def.type, config: {}, x: 0, y: 0 }
    const nextNodes = [...nodes, newStep]
    const nextBody = [...bodySteps, newStep]
    const nextSteps = trigger ? [trigger, ...nextBody] : nextBody
    onChange({ nodes: nextNodes, edges: resequenceLinearEdges(nextSteps, edges) })
    setAddPickerOpen(false)
  }

  const removeStep = (id: string) => {
    const nextNodes = nodes.filter((n) => n.id !== id)
    const nextBody = bodySteps.filter((n) => n.id !== id)
    const nextSteps = trigger ? [trigger, ...nextBody] : nextBody
    // Drop every edge touching the removed step -- both its own outgoing
    // edges and any branch dropdown elsewhere that was pointed at it (which
    // resequenceLinearEdges alone would otherwise leave dangling, since it
    // only prunes by SOURCE, not target).
    const prunedEdges = edges.filter((e) => e.source !== id && e.target !== id)
    onChange({ nodes: nextNodes, edges: resequenceLinearEdges(nextSteps, prunedEdges) })
  }

  const moveStep = (id: string, direction: 'up' | 'down') => {
    const i = bodySteps.findIndex((n) => n.id === id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (i < 0 || j < 0 || j >= bodySteps.length) return
    const nextBody = [...bodySteps]
    ;[nextBody[i], nextBody[j]] = [nextBody[j]!, nextBody[i]!]
    const nextNodes = trigger ? [trigger, ...nextBody] : [...nextBody]
    const nextSteps = trigger ? [trigger, ...nextBody] : nextBody
    onChange({ nodes: nextNodes, edges: resequenceLinearEdges(nextSteps, edges) })
  }

  const patchNodeConfig = (id: string, key: string, value: string) => {
    onChange({ nodes: nodes.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n)), edges })
  }

  const setBranchTarget = (sourceId: string, handleKey: string, targetId: string) => {
    const withoutOld = edges.filter((e) => !(e.source === sourceId && e.sourceHandle === handleKey))
    const nextEdges = targetId
      ? [...withoutOld, { id: `e_${sourceId}_${targetId}_${handleKey}`, source: sourceId, target: targetId, sourceHandle: handleKey }]
      : withoutOld
    onChange({ nodes, edges: nextEdges })
  }

  const branchLabel = (row: { key: string; label?: string }) =>
    row.label ?? t(`wf.branch.${row.key}` as Parameters<typeof t>[0])

  // Valid "go to step" targets: every body step except the source itself. The
  // trigger is intentionally excluded -- it's the workflow's entry point, not
  // a step anything can route back into.
  const targetOptions = (excludeId: string) => bodySteps.filter((s) => s.id !== excludeId)

  return (
    <div className="h-full min-h-[34rem] overflow-y-auto rounded-lg border border-gray-200 p-4 dark:border-gray-800">
      <div className="mx-auto max-w-xl space-y-3">
        {/* Trigger card — fixed as step 0, never removable from Guided mode. */}
        {trigger ? (
          <div className={`rounded-lg border-l-4 bg-white p-3 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE.trigger}`}>
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${NODE_KIND_BADGE.trigger}`}>
                {t('wf.linear.start')}
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">{label(trigger.type)}</span>
            </div>
            <NodeConfigPanel node={trigger} allNodes={nodes} clinicId={clinicId} workflowId={workflowId} onPatchConfig={(key, value) => patchNodeConfig(trigger.id, key, value)} />
            <StepFooter step={trigger} steps={steps} bodySteps={bodySteps} edges={edges} t={t} branchLabel={branchLabel} targetOptions={targetOptions} setBranchTarget={setBranchTarget} />
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-300 p-3 text-xs dark:border-gray-700">
            <p className="mb-2 font-medium text-gray-600 dark:text-gray-300">{t('wf.linear.addTriggerTitle')}</p>
            <p className="mb-2 text-gray-400">{t('wf.linear.addTriggerHint')}</p>
            <div className="space-y-1">
              {TRIGGER_DEFS.map((def) => (
                <button
                  key={def.type}
                  type="button"
                  onClick={() => addTrigger(def)}
                  className="block w-full rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-left hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
                >
                  <span className="font-medium text-gray-800 dark:text-gray-100">{t(def.labelKey as Parameters<typeof t>[0])}</span>
                  <span className="mt-0.5 block text-[10px] text-gray-400">{t(def.descKey as Parameters<typeof t>[0])}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Body steps. */}
        {bodySteps.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 px-3 py-4 text-center text-xs text-gray-400 dark:border-gray-700">
            {t('wf.linear.empty')}
          </p>
        ) : (
          bodySteps.map((step, i) => (
            <div key={step.id} className={`rounded-lg border-l-4 bg-white p-3 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[step.kind]}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${NODE_KIND_BADGE[step.kind]}`}>
                    {t('wf.linear.stepLabel', { n: i + 1 })}
                  </span>
                  <span className="font-semibold text-gray-800 dark:text-gray-100">{label(step.type)}</span>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => moveStep(step.id, 'up')}
                    title={t('wf.linear.moveUp')}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={i === bodySteps.length - 1}
                    onClick={() => moveStep(step.id, 'down')}
                    title={t('wf.linear.moveDown')}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeStep(step.id)}
                    title={t('wf.linear.removeStep')}
                    className="rounded border border-red-300 px-1.5 py-0.5 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
              <NodeConfigPanel node={step} allNodes={nodes} clinicId={clinicId} workflowId={workflowId} onPatchConfig={(key, value) => patchNodeConfig(step.id, key, value)} />
              <StepFooter step={step} steps={steps} bodySteps={bodySteps} edges={edges} t={t} branchLabel={branchLabel} targetOptions={targetOptions} setBranchTarget={setBranchTarget} />
            </div>
          ))
        )}

        {/* Add step */}
        {addPickerOpen ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.linear.addStepPickerTitle')}</p>
              <button type="button" onClick={() => setAddPickerOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                ✕
              </button>
            </div>
            {(['logic', 'action'] as const).map((kind) => {
              const items = ADDABLE_DEFS.filter((d) => d.kind === kind)
              return (
                <div key={kind} className="mb-2">
                  <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
                  <div className="space-y-1">
                    {items.map((def) => (
                      <button
                        key={def.type}
                        type="button"
                        onClick={() => addStep(def)}
                        className={`block w-full rounded border-l-2 bg-white px-2 py-1.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 ${NODE_KIND_TONE[def.kind]}`}
                      >
                        <span className="font-medium text-gray-800 dark:text-gray-100">{t(def.labelKey as Parameters<typeof t>[0])}</span>
                        <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">{t(def.descKey as Parameters<typeof t>[0])}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddPickerOpen(true)}
            className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs font-medium text-teal-700 hover:bg-teal-50 dark:border-gray-700 dark:text-teal-300 dark:hover:bg-teal-950/30"
          >
            + {t('wf.linear.addStep')}
          </button>
        )}
      </div>
    </div>
  )
}

/** The "what happens next" chrome under a step's fields: an auto-derived
 *  read-only line for a linear step, or one "go to step" dropdown per branch
 *  handle for a branching step. */
function StepFooter({
  step,
  steps,
  bodySteps,
  edges,
  t,
  branchLabel,
  targetOptions,
  setBranchTarget,
}: {
  step: WfNode
  steps: WfNode[]
  bodySteps: WfNode[]
  edges: WfEdge[]
  t: ReturnType<typeof useI18n>['t']
  branchLabel: (row: { key: string; label?: string }) => string
  targetOptions: (excludeId: string) => WfNode[]
  setBranchTarget: (sourceId: string, handleKey: string, targetId: string) => void
}) {
  const nodeDefLabel = (n: WfNode) => t((nodeDef(n.type)?.labelKey ?? n.type) as Parameters<typeof t>[0])

  if (isBranchingNode(step)) {
    const rows = branchRows(step)
    return (
      <div className="mt-2 space-y-1.5 border-t border-gray-100 pt-2 dark:border-gray-800">
        {rows.map((row) => {
          const currentTarget = edges.find((e) => e.source === step.id && e.sourceHandle === row.key)?.target ?? ''
          return (
            <label key={row.key} className="flex items-center gap-1.5">
              <span className="w-28 shrink-0 truncate text-[10px] text-gray-500 dark:text-gray-400" title={branchLabel(row)}>
                {t('wf.linear.goTo', { branch: branchLabel(row) })}
              </span>
              <select
                value={currentTarget}
                onChange={(e) => setBranchTarget(step.id, row.key, e.target.value)}
                className="w-full rounded border border-gray-300 bg-white p-1 text-[10px] dark:border-gray-700 dark:bg-gray-800"
              >
                <option value="">{t('wf.linear.notSet')}</option>
                {targetOptions(step.id).map((s) => {
                  const idx = bodySteps.findIndex((b) => b.id === s.id)
                  return (
                    <option key={s.id} value={s.id}>
                      {t('wf.linear.stepLabel', { n: idx + 1 })} · {nodeDefLabel(s)}
                    </option>
                  )
                })}
              </select>
            </label>
          )
        })}
      </div>
    )
  }

  const stepIndex = steps.findIndex((s) => s.id === step.id)
  const isLast = stepIndex === steps.length - 1
  return (
    <p className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-400 dark:border-gray-800">
      {isLast
        ? t('wf.linear.endsWorkflow')
        : t('wf.linear.continuesToStep', { n: bodySteps.findIndex((b) => b.id === steps[stepIndex + 1]!.id) + 1 })}
    </p>
  )
}
