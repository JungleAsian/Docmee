'use client'

// Rev 5 — BotPenguin-aligned automation canvas.
// - Self-documenting node cards: kind badge, live config preview, per-branch
//   output chips whose handles sit on the chip row (true/false, high/low/error,
//   interactive-menu options).
// - Searchable palette with one-line descriptions; dropping a loose connection
//   on the pane opens the same palette and auto-wires the picked node.
// - Branch-colored edges with translated labels; hover toolbar on nodes.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ReactFlow as ReactFlowBase,
  Background as BackgroundBase,
  Controls as ControlsBase,
  MiniMap as MiniMapBase,
  Handle as HandleBase,
  Position,
  MarkerType,
  ReactFlowProvider,
  useReactFlow,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type NodeChange,
  type EdgeChange,
  type FinalConnectionState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useI18n } from '../hooks/useI18n'
import type { WorkflowNode as WfNode, WorkflowEdge as WfEdge } from '../types'
import {
  WORKFLOW_NODE_TYPES,
  nodeDef,
  NODE_KIND_TONE,
  NODE_KIND_BADGE,
  NODE_KIND_RING,
  NODE_KIND_FILL,
  parseAiAgentScenarioList,
  branchRows,
  parseMenuOptionsSafe,
  resolveBranchColor,
  changeNodeType,
  nodeHasIssue,
  type NodeTypeDef,
} from '../workflowNodes'
import { findFreePosition, nextNodePosition } from '../workflowLayout'
import { NodeConfigPanel } from './NodeConfigPanel'
import { WorkflowLinearEditor } from './WorkflowLinearEditor'
import { WorkflowNodeIcon } from './WorkflowNodeIcon'
import { PencilSimple, CopySimple, TrashSimple } from '@phosphor-icons/react'

const ReactFlow = ReactFlowBase
const Background = BackgroundBase
const Controls = ControlsBase
const MiniMap = MiniMapBase
const Handle = HandleBase

type WfNodeData = {
  wf: WfNode
  label: string
  /** Canvas face + chrome mode: enhanced / classic / bp (BotPenguin). */
  mode: CanvasMode
  onConfigure: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  /** bp mode's "+" buttons: open the node picker and auto-wire from this node
   *  (and this exact output handle when given). */
  onAddFrom: (id: string, handleId?: string) => void
  /** Every edge in the workflow — used to resolve each branch row's CURRENT
   *  target for the "connect to existing node" dropdown. */
  edges: WfEdge[]
  /** Every other node in the workflow, for the same dropdown's option list. */
  allTargets: { id: string; label: string }[]
  onSetBranchTarget: (sourceId: string, handleKey: string | undefined, targetId: string) => void
}

const KIND_ICON: Record<string, string> = {
  trigger: '▶',
  logic: '◈',
  action: '⚡',
}

/** Custom drag-and-drop MIME key for palette → canvas node drops, distinct
 *  from `text/plain` to avoid ambiguity with the browser's own default drag
 *  behaviors (e.g. dragging selected text). */
const PALETTE_DRAG_MIME = 'application/x-docmee-node-type'

/** Edge stroke per branch tone (sequential default = teal-gray). */
function edgeColor(sourceHandle: string | null | undefined): string {
  switch (sourceHandle) {
    case 'true':
    case 'high':
      return '#10b981'
    case 'false':
    case 'error':
      return '#ef4444'
    case 'low':
      return '#f59e0b'
    case 'livechat':
      return '#0ea5e9'
    default:
      return '#94a3b8'
  }
}

function nodeFaceText(wf: WfNode): string | undefined {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'action.send_message':
      return String(cfg.text ?? '').trim() || undefined
    case 'action.interactive_menu': {
      const parts = [cfg.header, cfg.message, cfg.footer].filter((v) => typeof v === 'string' && v.trim())
      const fieldPart = cfg.field ? `→ ${cfg.field}` : undefined
      return [parts.join(' / '), fieldPart].filter(Boolean).join(' ') || undefined
    }
    case 'action.ai_draft':
    case 'logic.ai_classify_intent': {
      const ql = String(cfg.queryLimit ?? cfg.query_limit ?? '').trim()
      const rb = String(cfg.responseBuffer ?? cfg.response_buffer ?? '').trim()
      return [ql, rb].filter(Boolean).join(' ') || undefined
    }
    case 'trigger.message_keyword':
      return String(cfg.keywords ?? '').trim() || undefined
    case 'action.ask_capture':
      return String(cfg.question ?? '').trim() || undefined
    case 'action.ai_agent': {
      const style = String(cfg.communicationStyle ?? '').trim()
      const count = parseAiAgentScenarioList(cfg.scenarios).length
      return [style, `${count} scenario${count === 1 ? '' : 's'}`].filter(Boolean).join(' · ') || undefined
    }
    default:
      return undefined
  }
}

/** A builder mode: 'enhanced' renders the React Flow canvas below (unchanged).
 *  'classic' is the internal value name (kept for localStorage-preference
 *  compatibility) for what Studio now labels "Guided" -- WorkflowCanvasInner
 *  returns a <WorkflowLinearEditor> instead of ever reaching the canvas JSX
 *  when mode is 'classic', so the BotPenguin-face / mode-dependent styling
 *  further down this file only ever renders with mode === 'enhanced'. */
type CanvasMode = 'enhanced' | 'classic'

/** BotPenguin-style option row: left-aligned title, a per-row source handle
 *  floating on the card's right edge, and (in bp mode) a blue "+" button that
 *  opens the node picker and auto-wires the new node from this exact handle. */
function OptionRow({
  handleId,
  text,
  handleClass,
  textClass,
  dotColor,
  onAdd,
  targetValue,
  targetOptions,
  onSetTarget,
  notSetLabel,
}: {
  handleId: string
  text: string
  handleClass: string
  textClass?: string
  /** Inline background color for the row's connection dot -- when given,
   *  this wins over `handleClass`'s own background (the dot then matches
   *  this branch's configured/resolved routing-line color, same as the
   *  edge it anchors). Callers that don't care about per-branch color
   *  (e.g. the Classic card's neutral ring handles) simply omit this. */
  dotColor?: string
  onAdd?: (handleId: string) => void
  /** "Connect to existing node" dropdown -- additive to hand-drawn
   *  connections, not a replacement. Omitted entirely (Classic mode) when
   *  any of these three props is missing. */
  targetValue?: string
  targetOptions?: { id: string; label: string }[]
  onSetTarget?: (targetId: string) => void
  notSetLabel?: string
}) {
  return (
    <div
      className={`relative flex flex-wrap items-center gap-x-2 border-t border-gray-100 py-1.5 pl-1.5 dark:border-gray-800 ${dotColor ? 'border-l-2' : ''}`}
      style={dotColor ? { borderLeftColor: dotColor } : undefined}
    >
      <span className={`truncate text-[10px] ${textClass ?? 'text-gray-600 dark:text-gray-300'}`}>{text}</span>
      {targetOptions && onSetTarget && (
        <select
          value={targetValue ?? ''}
          onChange={(e) => onSetTarget(e.target.value)}
          className="nodrag ml-auto w-24 shrink-0 rounded border border-gray-200 bg-white p-0.5 text-[9px] dark:border-gray-700 dark:bg-gray-800"
        >
          <option value="">{notSetLabel}</option>
          {targetOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {onAdd && (
        <button
          type="button"
          title={handleId}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(handleId)
          }}
          className={`nodrag ${targetOptions ? '' : 'ml-auto'} mr-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold leading-none text-white shadow-sm hover:bg-blue-600`}
        >
          +
        </button>
      )}
      <Handle
        id={handleId}
        type="source"
        position={Position.Right}
        title={handleId}
        className={`!absolute !right-[-9px] !top-1/2 !h-2 !w-2 !-translate-y-1/2 ${dotColor ? '' : handleClass}`}
        style={dotColor ? { position: 'absolute', backgroundColor: dotColor } : { position: 'absolute' }}
      />
    </div>
  )
}

/** Section block: tiny gray caption above its value (BotPenguin's
 *  Header / Message / Footer blocks on a card). */
function SectionBlock({ caption, value }: { caption: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] text-gray-400 dark:text-gray-500">{caption}</p>
      <p className="line-clamp-2 text-[10px] font-medium text-gray-700 dark:text-gray-200">{value}</p>
    </div>
  )
}

/** White ring handle (classic cards). */
const RING_HANDLE = '!rounded-full !border !border-gray-300 !bg-white dark:!border-gray-600 dark:!bg-gray-700'

/** Solid teal handle (enhanced cards). */
const TEAL_HANDLE = '!bg-teal-500'

const WorkflowNodeView = memo(function WorkflowNodeView({ data, selected }: NodeProps<Node<WfNodeData>>) {
  const { wf, label, mode, onConfigure, onDuplicate, onDelete, onAddFrom, edges: allEdges, allTargets, onSetBranchTarget } = data
  const face = nodeFaceText(wf)
  const rows = branchRows(wf)
  const { t } = useI18n()
  const targetOf = (handleKey: string | undefined) => allEdges.find((e) => e.source === wf.id && (e.sourceHandle ?? undefined) === handleKey)?.target ?? ''

  const cfg = wf.config ?? {}
  const isMenu = wf.type === 'action.interactive_menu'
  const menuOpts = isMenu ? parseMenuOptionsSafe(cfg.options) : []
  const section = (key: string) => {
    const value = String(cfg[key] ?? '').trim()
    return value ? (
      <SectionBlock key={key} caption={t(`wf.field.${key}` as Parameters<typeof t>[0])} value={value} />
    ) : null
  }
  // A real option's title wins even for the three reserved ids (restart/
  // livechat/default) once the admin has turned one into a real, visible
  // button -- only an unconfigured reserved id falls back to the fixed i18n
  // branch label.
  const rowText = (key: string) => {
    if (isMenu) {
      const opt = menuOpts.find((o) => o.optionId === key)
      if (opt) return opt.title || key
    }
    return t(`wf.branch.${key}` as Parameters<typeof t>[0])
  }
  // The visible "Options" list on the card face should look exactly like
  // WhatsApp will render it -- i.e. only real, configured options -- so an
  // unconfigured reserved handle (restart/livechat/default) never appears as
  // if it were a tappable button by default. `rows` (the full branchRows()
  // set, including synthesized fallback entries for unconfigured reserved
  // handles) is still used everywhere else on this card for wiring purposes.
  const visibleRows = isMenu
    ? rows.filter((r) => !['restart', 'livechat', 'default'].includes(r.key) || menuOpts.some((o) => o.optionId === r.key))
    : rows

  // Classic Builder face — BotPenguin card anatomy on the themed canvas:
  // icon + type-name header, structured Header/Message/Footer sections,
  // left-aligned option rows with per-row handles, and blue "+" continue
  // buttons that auto-wire the picked node from that exact handle.
  if (mode === 'classic') {
    const add = (handleId: string) => onAddFrom(wf.id, handleId)
    return (
      <div
        className={`w-48 rounded-lg border border-gray-200 px-3 py-2 text-xs shadow-md dark:border-gray-700 ${NODE_KIND_FILL[wf.kind]} ${
          selected ? 'ring-2 ring-teal-300' : ''
        }`}
      >
        {wf.kind !== 'trigger' && (
          <Handle type="target" position={Position.Left} className={`!h-2 !w-2 ${RING_HANDLE}`} />
        )}

        {/* Type badge: colored icon + type name (BotPenguin card header) */}
        <div className="mb-1 flex items-center gap-1.5">
          <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${NODE_KIND_BADGE[wf.kind]}`}>{KIND_ICON[wf.kind] ?? '•'}</span>
          <span className="truncate text-[11px] font-semibold text-gray-700 dark:text-gray-200">{label}</span>
        </div>

        {isMenu ? (
          <div className="space-y-1.5">
            {section('header')}
            {section('message')}
            {section('footer')}
            {visibleRows.length > 0 && (
              <div>
                <p className="mt-1 text-[9px] text-gray-400 dark:text-gray-500">{t('wf.field.options')}</p>
                {visibleRows.map((r) => (
                  <OptionRow key={r.key} handleId={r.key} text={rowText(r.key)} handleClass={RING_HANDLE} onAdd={add} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {face && <p className="line-clamp-3 text-[10px] text-gray-500 dark:text-gray-400">{face}</p>}
            {visibleRows.length > 0 ? (
              <div className="mt-1">
                {visibleRows.map((r) => (
                  <OptionRow key={r.key} handleId={r.key} text={rowText(r.key)} handleClass={RING_HANDLE} onAdd={add} />
                ))}
              </div>
            ) : (
              wf.type !== 'action.end' && (
                <>
                  <Handle type="source" position={Position.Right} className={`!h-2 !w-2 ${RING_HANDLE}`} />
                  {/* Floating blue "+" continues the flow */}
                  <button
                    type="button"
                    title={t('wf.pickNodeTitle')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddFrom(wf.id, undefined)
                    }}
                    className="nodrag absolute -bottom-2 -right-2 flex h-5 w-5 items-center justify-center rounded-full bg-blue-500 text-sm font-bold leading-none text-white shadow-md hover:bg-blue-600"
                  >
                    +
                  </button>
                </>
              )
            )}
          </>
        )}
      </div>
    )
  }

  const nodeIcon = nodeDef(wf.type)?.icon ?? ''
  const customLabel = String(cfg.customLabel ?? '').trim()
  const displayLabel = customLabel || label
  const issueKey = nodeHasIssue(wf)
  const descKey = nodeDef(wf.type)?.descKey

  return (
    <div
      className={`group relative w-52 rounded-lg border-2 px-3 py-2 text-xs shadow-sm transition-shadow ${NODE_KIND_FILL[wf.kind]} ${NODE_KIND_TONE[wf.kind]} ${
        selected ? NODE_KIND_RING[wf.kind] : 'hover:shadow-md'
      }`}
    >
      {wf.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
      )}

      {/* Issue indicator: cheap, node-local validation hint (see nodeHasIssue) */}
      {issueKey && (
        <span
          title={t(issueKey as Parameters<typeof t>[0])}
          className="absolute -right-1 -top-1 flex h-3 w-3 items-center justify-center rounded-full bg-amber-400 shadow-sm ring-2 ring-white dark:ring-gray-900"
        />
      )}

      {/* Hover toolbar */}
      <div className="nodrag absolute -top-3 right-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          title={t('common.edit')}
          onClick={(e) => {
            e.stopPropagation()
            onConfigure(wf.id)
          }}
          className="rounded border border-gray-300 bg-white p-1 leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <PencilSimple className="h-2.5 w-2.5" weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          title={t('wf.duplicateNode')}
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate(wf.id)
          }}
          className="rounded border border-gray-300 bg-white p-1 leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          <CopySimple className="h-2.5 w-2.5" weight="bold" aria-hidden="true" />
        </button>
        <button
          type="button"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(wf.id)
          }}
          className="rounded border border-red-300 bg-white p-1 leading-none text-red-600 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-gray-800 dark:text-red-300"
        >
          <TrashSimple className="h-2.5 w-2.5" weight="bold" aria-hidden="true" />
        </button>
      </div>

      {/* Header: icon badge + kind label */}
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${NODE_KIND_BADGE[wf.kind]}`}>
          <WorkflowNodeIcon icon={nodeIcon} className="h-3 w-3" />
        </span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${wf.kind}` as Parameters<typeof t>[0])}</span>
        {/* Item 21 of the 25-item batch: hover the node type's existing
            one-line description (already used in the palette) on the card itself.
            Kept inline next to the kind label (not flush right) so it never sits
            under the hover toolbar's edit/duplicate/delete buttons, which occupy
            the top-right corner on hover. */}
        {descKey && (
          <span
            title={t(descKey as Parameters<typeof t>[0])}
            className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-gray-300 text-[8px] font-bold text-gray-400 dark:border-gray-600"
          >
            i
          </span>
        )}
      </div>
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{displayLabel}</p>

      {/* Full BotPenguin-style anatomy (R9): menu cards show structured
          Header/Message/Footer sections; options/branches are left-aligned
          rows with teal per-row handles; other nodes show their content. */}
      {isMenu ? (
        <div className="mt-1.5 space-y-1.5 border-t border-gray-200 pt-1.5 dark:border-gray-700">
          {section('header')}
          {section('message')}
          {section('footer')}
          {visibleRows.length > 0 && (
            <div>
              <p className="mt-1 text-[9px] text-gray-400 dark:text-gray-500">{t('wf.field.options')}</p>
              {visibleRows.map((r) => (
                <OptionRow
                  key={r.key}
                  handleId={r.key}
                  text={rowText(r.key)}
                  handleClass={TEAL_HANDLE}
                  dotColor={resolveBranchColor(wf, r.key)}
                  textClass={r.tone === 'red' ? 'text-red-600 dark:text-red-400' : r.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : undefined}
                  targetValue={targetOf(r.key)}
                  targetOptions={allTargets}
                  onSetTarget={(targetId) => onSetBranchTarget(wf.id, r.key, targetId)}
                  notSetLabel={t('wf.linear.notSet')}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {face && (
            <>
              <div className="my-1.5 border-t border-gray-200 dark:border-gray-700" />
              <p className="line-clamp-3 text-[10px] text-gray-500 dark:text-gray-400">{face}</p>
            </>
          )}
          {visibleRows.length > 0 && (
            <div className="mt-1">
              {visibleRows.map((r) => (
                <OptionRow
                  key={r.key}
                  handleId={r.key}
                  text={rowText(r.key)}
                  handleClass={TEAL_HANDLE}
                  dotColor={resolveBranchColor(wf, r.key)}
                  textClass={r.tone === 'red' ? 'text-red-600 dark:text-red-400' : r.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : undefined}
                  targetValue={targetOf(r.key)}
                  targetOptions={allTargets}
                  onSetTarget={(targetId) => onSetBranchTarget(wf.id, r.key, targetId)}
                  notSetLabel={t('wf.linear.notSet')}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Default single output -- a plain "connect to existing node" dropdown
          alongside the hand-drawn Handle, same as branching rows get. */}
      {wf.type !== 'action.end' && rows.length === 0 && (
        <div className="relative mt-1 flex items-center border-t border-gray-100 pt-1 dark:border-gray-800">
          <select
            value={targetOf(undefined)}
            onChange={(e) => onSetBranchTarget(wf.id, undefined, e.target.value)}
            className="nodrag w-full rounded border border-gray-200 bg-white p-0.5 text-[9px] dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="">{t('wf.linear.notSet')}</option>
            {allTargets.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
        </div>
      )}
    </div>
  )
})

const nodeTypes = { wf: WorkflowNodeView }

const CANVAS_MODE_KEY = 'docmee.canvas.mode'

interface PendingWire {
  nodeId: string
  handleId?: string
  at: { x: number; y: number }
}

/** Enhanced/Guided toggle, top-right — visible regardless of which mode is
 *  currently rendered so the admin can always switch back. 'classic' is the
 *  Guided (fill-in-the-blank / linear-steps) editor; the internal mode value
 *  and its localStorage key stay the literal string 'classic' to avoid
 *  resetting anyone's saved preference -- only the label copy changed. */
function BuilderModeSwitcher({
  mode,
  onSwitch,
  t,
}: {
  mode: CanvasMode
  onSwitch: (next: CanvasMode) => void
  t: ReturnType<typeof useI18n>['t']
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
      {(['enhanced', 'classic'] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onSwitch(m)}
          className={`px-2.5 py-1 ${mode === m ? 'bg-teal-600 text-white' : 'hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >
          {m === 'enhanced' ? t('wf.enhancedBuilder') : t('wf.guidedBuilder')}
        </button>
      ))}
    </div>
  )
}

function WorkflowCanvasInner({
  nodes,
  edges,
  onChange,
  clinicId,
  workflowId,
}: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
  /** Active clinic — enables entity pickers (doctor list for menu options). */
  clinicId?: string
  /** The workflow currently open — excluded from the AI Agent node's "route
   *  to another workflow" target picker so it can't route to itself. */
  workflowId?: string
}) {
  const { t } = useI18n()
  const { screenToFlowPosition } = useReactFlow()
  const label = useCallback((type: string) => t((nodeDef(type)?.labelKey ?? type) as Parameters<typeof t>[0]), [t])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [pendingWire, setPendingWire] = useState<PendingWire | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  // Builder-mode preference persists across sessions (BotPenguin-style switcher).
  const [mode, setMode] = useState<CanvasMode>(() => {
    if (typeof window === 'undefined') return 'enhanced'
    const stored = window.localStorage.getItem(CANVAS_MODE_KEY)
    // 'bp' was the short-lived BotPenguin mode — it IS the Classic Builder now.
    return stored === 'classic' || stored === 'bp' ? 'classic' : 'enhanced'
  })
  const switchMode = useCallback((next: CanvasMode) => {
    setMode(next)
    try {
      window.localStorage.setItem(CANVAS_MODE_KEY, next)
    } catch {
      /* private mode — pref simply won't persist */
    }
  }, [])

  const configureNode = useCallback((id: string) => setSelectedId(id), [])

  const deleteNodeById = useCallback(
    (id: string) => {
      onChange({
        nodes: nodes.filter((n) => n.id !== id),
        edges: edges.filter((e) => e.source !== id && e.target !== id),
      })
      setSelectedId((cur) => (cur === id ? null : cur))
    },
    [nodes, edges, onChange],
  )

  const duplicateNodeById = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id)
      if (!src) return
      const base = src.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const at = findFreePosition(nodes, { x: src.x + 40, y: src.y + 40 })
      const copy: WfNode = { ...src, id: `${base}_${n}`, config: { ...src.config }, x: at.x, y: at.y }
      onChange({ nodes: [...nodes, copy], edges })
      setSelectedId(copy.id)
    },
    [nodes, edges, onChange],
  )

  /** bp mode's "+" buttons: open the node picker positioned just right of the
   *  source node; picking a node auto-wires it from this handle (same
   *  pendingWire flow as dropping a loose connection on the pane). */
  const openAddFrom = useCallback(
    (id: string, handleId?: string) => {
      const from = nodes.find((n) => n.id === id)
      setPickerQuery('')
      setPendingWire({ nodeId: id, handleId, at: { x: (from?.x ?? 0) + 300, y: (from?.y ?? 0) + 40 } })
    },
    [nodes],
  )

  /** "Connect to existing node" dropdown, alongside hand-drawn connections —
   *  upserts (or, when targetId is empty, removes) the edge identified by
   *  (sourceId, handleKey). Mirrors WorkflowLinearEditor.tsx's setBranchTarget
   *  so the two editors behave identically for this operation. */
  const setBranchTarget = useCallback(
    (sourceId: string, handleKey: string | undefined, targetId: string) => {
      const withoutOld = edges.filter((e) => !(e.source === sourceId && (e.sourceHandle ?? undefined) === handleKey))
      const nextEdges = targetId
        ? [
            ...withoutOld,
            {
              id: `e_${sourceId}_${targetId}_${handleKey ?? 'default'}_${edges.length}`,
              source: sourceId,
              target: targetId,
              ...(handleKey ? { sourceHandle: handleKey } : {}),
            },
          ]
        : withoutOld
      onChange({ nodes, edges: nextEdges })
    },
    [nodes, edges, onChange],
  )

  const graph = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const allTargets = nodes.map((n) => ({ id: n.id, label: label(n.type) }))
    const rfNodes: Node[] = nodes.map((n) => ({
      id: n.id,
      type: 'wf',
      position: { x: n.x, y: n.y },
      data: {
        wf: n,
        label: label(n.type),
        mode,
        onConfigure: configureNode,
        onDuplicate: duplicateNodeById,
        onDelete: deleteNodeById,
        onAddFrom: openAddFrom,
        edges,
        allTargets: allTargets.filter((t) => t.id !== n.id),
        onSetBranchTarget: setBranchTarget,
      },
    }))
    const rfEdges: Edge[] = edges.map((e) => {
      if (mode !== 'enhanced') {
        // Classic / BotPenguin: plain thin gray beziers, no labels or colored markers.
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle ?? undefined,
          type: 'default',
          style: { stroke: '#9ca3af', strokeWidth: 1.5 },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#9ca3af', width: 14, height: 14 },
        }
      }
      // The admin's own routing-color override (resolveBranchColor) wins over
      // the tone-based default; a matched real option's own title (branchRows'
      // `label`) wins over the fixed i18n branch label for the same reason —
      // both fall back to the pre-existing generic behavior when the source
      // node can't be found or carries no override.
      const sourceNode = nodeById.get(e.source)
      const row = sourceNode && e.sourceHandle ? branchRows(sourceNode).find((r) => r.key === e.sourceHandle) : undefined
      const color = sourceNode && e.sourceHandle ? resolveBranchColor(sourceNode, e.sourceHandle) : edgeColor(e.sourceHandle)
      const edgeLabel = e.sourceHandle ? (row?.label ?? t(`wf.branch.${e.sourceHandle}` as Parameters<typeof t>[0])) : undefined
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        label: edgeLabel,
        type: 'smoothstep',
        style: { stroke: color, strokeWidth: 2 },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      }
    })
    return { nodes: rfNodes, edges: rfEdges }
  }, [nodes, edges, label, t, mode, configureNode, duplicateNodeById, deleteNodeById, openAddFrom, setBranchTarget])

  const [rfNodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

  // Item 23 of the 25-item batch: hovering an edge traces its connection with the
  // flow-dash animation @xyflow/react already ships (the CSS keyframe is in the
  // installed style.css) — just toggling `animated` per edge on hover/unhover,
  // local-only state, never persisted via onChange.
  const handleEdgeMouseEnter = useCallback(
    (_event: unknown, edge: Edge) => {
      setEdges((current) => current.map((e) => (e.id === edge.id ? { ...e, animated: true } : e)))
    },
    [setEdges],
  )
  const handleEdgeMouseLeave = useCallback(
    (_event: unknown, edge: Edge) => {
      setEdges((current) => current.map((e) => (e.id === edge.id ? { ...e, animated: false } : e)))
    },
    [setEdges],
  )

  // Both handlers below apply the raw change to React Flow's own local
  // node/edge state first (so dragging and selection stay snappy), THEN
  // propagate anything that should actually persist — position-drag-end and
  // removal — up to the parent via onChange. Any change NOT propagated here
  // is local-only and gets silently discarded the next time `graph`
  // recomputes and the sync effect below overwrites local state from the
  // (unaware) parent props — e.g. keyboard-deleting a node or edge used to
  // vanish only until the next edit, then reappear ("reverts to the old
  // configuration"), and an add right after such a phantom deletion would
  // read the still-stale, still-larger `nodes`/`edges` and resurrect the
  // "deleted" item alongside the new one ("multiple nodes added").
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes)
      const dragEnd = changes.filter((c): c is Extract<NodeChange, { type: 'position' }> => c.type === 'position' && c.dragging === false)
      const removed = changes.filter((c): c is Extract<NodeChange, { type: 'remove' }> => c.type === 'remove')
      if (dragEnd.length === 0 && removed.length === 0) return
      const removedIds = new Set(removed.map((c) => c.id))
      const moved = new Map(dragEnd.map((c) => [c.id, c.position]))
      onChange({
        nodes: nodes
          .filter((n) => !removedIds.has(n.id))
          .map((n) => (moved.has(n.id) ? { ...n, x: Math.round(moved.get(n.id)!.x), y: Math.round(moved.get(n.id)!.y) } : n)),
        edges: removedIds.size > 0 ? edges.filter((e) => !removedIds.has(e.source) && !removedIds.has(e.target)) : edges,
      })
      if (removedIds.size > 0) setSelectedId((cur) => (cur && removedIds.has(cur) ? null : cur))
    },
    [onNodesChange, nodes, edges, onChange],
  )

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes)
      const removed = changes.filter((c): c is Extract<EdgeChange, { type: 'remove' }> => c.type === 'remove')
      if (removed.length === 0) return
      const removedIds = new Set(removed.map((c) => c.id))
      onChange({ nodes, edges: edges.filter((e) => !removedIds.has(e.id)) })
    },
    [onEdgesChange, nodes, edges, onChange],
  )

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      onChange({
        nodes,
        edges: [...edges, {
          id: `e_${c.source}_${c.target}_${c.sourceHandle ?? 'default'}_${edges.length}`,
          source: c.source,
          target: c.target,
          ...(c.sourceHandle ? { sourceHandle: c.sourceHandle } : {}),
        }],
      })
    },
    [nodes, edges, onChange],
  )

  /** Dropping a loose connection on the pane opens the node picker, auto-wired. */
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return
      const from = connectionState.fromNode
      if (!from || connectionState.fromHandle?.type !== 'source') return
      const point = 'changedTouches' in event ? event.changedTouches[0] : event
      const at = screenToFlowPosition({ x: point.clientX, y: point.clientY })
      setPickerQuery('')
      setPendingWire({ nodeId: from.id, handleId: connectionState.fromHandle?.id ?? undefined, at })
    },
    [screenToFlowPosition],
  )

  const addNode = useCallback(
    (def: NodeTypeDef, wire?: PendingWire | null, dropAt?: { x: number; y: number }) => {
      const base = def.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const id = `${base}_${n}`
      // Wired adds (dropped-connection / bp "+" button) center the new card on
      // the drop point; a drag-and-drop from the palette (dropAt) centers on
      // the cursor's release point the same way; unwired palette clicks land
      // below the lowest existing node instead of the old nodes.length % 4/8
      // scatter, which wrapped back over earlier positions and guaranteed
      // overlap after a handful of adds. All three still run through
      // findFreePosition, which nudges clear of anything already there.
      const at = wire
        ? findFreePosition(nodes, { x: Math.round(wire.at.x - 104), y: Math.round(wire.at.y - 30) })
        : dropAt
          ? findFreePosition(nodes, { x: Math.round(dropAt.x - 104), y: Math.round(dropAt.y - 30) })
          : nextNodePosition(nodes)
      const nextEdges = wire
        ? [...edges, {
            id: `e_${wire.nodeId}_${id}_${wire.handleId ?? 'default'}_${edges.length}`,
            source: wire.nodeId,
            target: id,
            ...(wire.handleId ? { sourceHandle: wire.handleId } : {}),
          }]
        : edges
      onChange({
        nodes: [...nodes, { id, kind: def.kind, type: def.type, config: {}, x: Math.round(at.x), y: Math.round(at.y) }],
        edges: nextEdges,
      })
      setSelectedId(id)
      setPendingWire(null)
    },
    [nodes, edges, onChange],
  )

  const patchConfig = useCallback(
    (key: string, value: string) => {
      if (!selected) return
      onChange({ nodes: nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, [key]: value } } : n)), edges })
    },
    [selected, nodes, edges, onChange],
  )

  const changeSelectedNodeType = useCallback(
    (newType: string) => {
      if (!selected) return
      onChange({ nodes: nodes.map((n) => (n.id === selected.id ? changeNodeType(n, newType) : n)), edges })
    },
    [selected, nodes, edges, onChange],
  )

  const deleteSelected = useCallback(() => {
    if (!selected) return
    deleteNodeById(selected.id)
  }, [selected, deleteNodeById])

  const byKind = (kind: string) => WORKFLOW_NODE_TYPES.filter((d) => d.kind === kind)

  /** Palette entries filtered by the search box (label + description). */
  const paletteMatches = useCallback(
    (def: NodeTypeDef, query: string) => {
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      return (
        t(def.labelKey as Parameters<typeof t>[0]).toLowerCase().includes(q) ||
        t(def.descKey as Parameters<typeof t>[0]).toLowerCase().includes(q) ||
        def.type.toLowerCase().includes(q)
      )
    },
    [t],
  )

  const renderPaletteItem = (def: NodeTypeDef, onPick: (d: NodeTypeDef) => void) => (
    <button
      key={def.type}
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PALETTE_DRAG_MIME, def.type)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={() => onPick(def)}
      className={`block w-full cursor-grab rounded border-l-2 bg-white px-2 py-1.5 text-left hover:bg-gray-100 active:cursor-grabbing dark:bg-gray-800 dark:hover:bg-gray-700 ${NODE_KIND_TONE[def.kind]}`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${NODE_KIND_BADGE[def.kind]}`}>
          <WorkflowNodeIcon icon={def.icon} className="h-2.5 w-2.5" />
        </span>
        <span className="font-medium text-gray-800 dark:text-gray-100">{t(def.labelKey as Parameters<typeof t>[0])}</span>
      </span>
      <span className="mt-0.5 block text-[10px] leading-snug text-gray-400">{t(def.descKey as Parameters<typeof t>[0])}</span>
    </button>
  )

  if (mode === 'classic') {
    return (
      <div className="relative flex h-full min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
        <WorkflowLinearEditor nodes={nodes} edges={edges} onChange={onChange} clinicId={clinicId} workflowId={workflowId} />
        <BuilderModeSwitcher mode={mode} onSwitch={switchMode} t={t} />
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
      {/* Palette */}
      <div className="w-52 shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50 p-2 text-xs dark:border-gray-800 dark:bg-gray-900">
        <input
          value={paletteQuery}
          onChange={(e) => setPaletteQuery(e.target.value)}
          placeholder={t('wf.searchNodes')}
          className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
        />
        {(['trigger', 'logic', 'action'] as const).map((kind) => {
          const items = byKind(kind).filter((d) => paletteMatches(d, paletteQuery))
          if (items.length === 0) return null
          return (
            <div key={kind} className="mb-3">
              <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
              <div className="space-y-1">{items.map((def) => renderPaletteItem(def, (d) => addNode(d)))}</div>
            </div>
          )
        })}
      </div>

      {/* Canvas */}
      <div
        className="relative flex-1"
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PALETTE_DRAG_MIME)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(e) => {
          const type = e.dataTransfer.getData(PALETTE_DRAG_MIME)
          if (!type) return
          e.preventDefault()
          const def = WORKFLOW_NODE_TYPES.find((d) => d.type === type)
          if (!def) return
          addNode(def, undefined, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
        }}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onEdgeMouseEnter={handleEdgeMouseEnter}
          onEdgeMouseLeave={handleEdgeMouseLeave}
          onConnect={onConnect}
          onConnectEnd={onConnectEnd}
          onNodeClick={(_event: unknown, node: Node) => setSelectedId(node.id)}
          onPaneClick={() => setSelectedId(null)}
          nodeTypes={nodeTypes}
          fitView
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <MiniMap pannable className="!hidden sm:!block" />
        </ReactFlow>

        {/* Auto-wire node picker (opened by dropping a loose connection) */}
        {pendingWire && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40">
            <div className="max-h-[75%] w-80 overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 text-xs shadow-xl dark:border-gray-700 dark:bg-gray-900">
              <div className="mb-2 flex items-center justify-between">
                <p className="font-semibold text-gray-800 dark:text-gray-100">{t('wf.pickNodeTitle')}</p>
                <button type="button" onClick={() => setPendingWire(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                  ✕
                </button>
              </div>
              <input
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder={t('wf.searchNodes')}
                className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              {(['trigger', 'logic', 'action'] as const).map((kind) => {
                const items = byKind(kind).filter((d) => paletteMatches(d, pickerQuery))
                if (items.length === 0) return null
                return (
                  <div key={kind} className="mb-2">
                    <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{t(`wf.kind.${kind}` as Parameters<typeof t>[0])}</p>
                    <div className="space-y-1">{items.map((def) => renderPaletteItem(def, (d) => addNode(d, pendingWire)))}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Config panel */}
      {selected && (
        <aside className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-800 dark:bg-gray-900">
          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${selected.kind}` as Parameters<typeof t>[0])}</p>
          <p className="mb-3 font-semibold text-gray-800 dark:text-gray-100">
            {String(selected.config?.customLabel ?? '').trim() || label(selected.type)}
          </p>

          <NodeConfigPanel node={selected} allNodes={nodes} clinicId={clinicId} workflowId={workflowId} onPatchConfig={patchConfig} onChangeType={changeSelectedNodeType} />

          <button
            type="button"
            onClick={deleteSelected}
            className="w-full rounded border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
          >
            {t('wf.deleteNode')}
          </button>
        </aside>
      )}

      <BuilderModeSwitcher mode={mode} onSwitch={switchMode} t={t} />
    </div>
  )
}

export function WorkflowCanvas(props: {
  nodes: WfNode[]
  edges: WfEdge[]
  onChange: (next: { nodes: WfNode[]; edges: WfEdge[] }) => void
  /** Active clinic — enables entity pickers (doctor list for menu options). */
  clinicId?: string
  /** The workflow currently open — excluded from the AI Agent node's "route
   *  to another workflow" target picker so it can't route to itself. */
  workflowId?: string
}) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  )
}
