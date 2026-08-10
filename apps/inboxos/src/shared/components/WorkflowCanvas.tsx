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
  parseAiAgentScenarioList,
  branchRows,
  parseMenuOptionsSafe,
  resolveBranchColor,
  type NodeTypeDef,
} from '../workflowNodes'
import { findFreePosition, nextNodePosition } from '../workflowLayout'
import { NodeConfigPanel } from './NodeConfigPanel'
import { WorkflowLinearEditor } from './WorkflowLinearEditor'

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
}

const KIND_ICON: Record<string, string> = {
  trigger: '▶',
  logic: '◈',
  action: '⚡',
}

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
  onAdd,
}: {
  handleId: string
  text: string
  handleClass: string
  textClass?: string
  onAdd?: (handleId: string) => void
}) {
  return (
    <div className="relative flex items-center border-t border-gray-100 py-1 dark:border-gray-800">
      <span className={`truncate text-[10px] ${textClass ?? 'text-gray-600 dark:text-gray-300'}`}>{text}</span>
      {onAdd && (
        <button
          type="button"
          title={handleId}
          onClick={(e) => {
            e.stopPropagation()
            onAdd(handleId)
          }}
          className="nodrag ml-auto mr-1.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-blue-500 text-[10px] font-bold leading-none text-white shadow-sm hover:bg-blue-600"
        >
          +
        </button>
      )}
      <Handle
        id={handleId}
        type="source"
        position={Position.Right}
        title={handleId}
        className={`!absolute !right-[-9px] !top-1/2 !h-2 !w-2 !-translate-y-1/2 ${handleClass}`}
        style={{ position: 'absolute' }}
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
  const { wf, label, mode, onConfigure, onDuplicate, onDelete, onAddFrom } = data
  const face = nodeFaceText(wf)
  const rows = branchRows(wf)
  const { t } = useI18n()

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
        className={`w-48 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-md dark:border-gray-700 dark:bg-gray-900 ${
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

  return (
    <div
      className={`group w-52 rounded-lg border-2 bg-white px-3 py-2 text-xs shadow-sm dark:bg-gray-900 ${NODE_KIND_TONE[wf.kind]} ${
        selected ? 'ring-2 ring-teal-300' : ''
      }`}
    >
      {wf.kind !== 'trigger' && (
        <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-gray-400" />
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
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          ✎
        </button>
        <button
          type="button"
          title={t('wf.duplicateNode')}
          onClick={(e) => {
            e.stopPropagation()
            onDuplicate(wf.id)
          }}
          className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-gray-600 shadow-sm hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
        >
          ⧉
        </button>
        <button
          type="button"
          title={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation()
            onDelete(wf.id)
          }}
          className="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[10px] leading-none text-red-600 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-gray-800 dark:text-red-300"
        >
          ✕
        </button>
      </div>

      {/* Header: kind badge + type label */}
      <div className="mb-0.5 flex items-center gap-1.5">
        <span className={`rounded px-1 py-0.5 text-[10px] leading-none ${NODE_KIND_BADGE[wf.kind]}`}>{KIND_ICON[wf.kind] ?? '•'}</span>
        <span className="text-[9px] font-bold uppercase tracking-wide text-gray-400">{t(`wf.kind.${wf.kind}` as Parameters<typeof t>[0])}</span>
      </div>
      <p className="truncate font-semibold text-gray-800 dark:text-gray-100">{label}</p>

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
                  textClass={r.tone === 'red' ? 'text-red-600 dark:text-red-400' : r.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : undefined}
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
                  textClass={r.tone === 'red' ? 'text-red-600 dark:text-red-400' : r.tone === 'emerald' ? 'text-emerald-700 dark:text-emerald-300' : undefined}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Default single output */}
      {wf.type !== 'action.end' && rows.length === 0 && (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-teal-500" />
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

  const graph = useMemo(() => {
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const rfNodes: Node[] = nodes.map((n) => ({
      id: n.id,
      type: 'wf',
      position: { x: n.x, y: n.y },
      data: { wf: n, label: label(n.type), mode, onConfigure: configureNode, onDuplicate: duplicateNodeById, onDelete: deleteNodeById, onAddFrom: openAddFrom },
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
  }, [nodes, edges, label, t, mode, configureNode, duplicateNodeById, deleteNodeById, openAddFrom])

  const [rfNodes, setNodes, onNodesChange] = useNodesState(graph.nodes)
  const [rfEdges, setEdges, onEdgesChange] = useEdgesState(graph.edges)

  useEffect(() => {
    setNodes(graph.nodes)
    setEdges(graph.edges)
  }, [graph, setNodes, setEdges])

  const selected = nodes.find((n) => n.id === selectedId) ?? null

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
    (def: NodeTypeDef, wire?: PendingWire | null) => {
      const base = def.type.split('.')[1] ?? 'node'
      let n = nodes.length + 1
      while (nodes.some((x) => x.id === `${base}_${n}`)) n++
      const id = `${base}_${n}`
      // Wired adds (dropped-connection / bp "+" button) center the new card on
      // the drop point; unwired palette clicks land below the lowest existing
      // node instead of the old nodes.length % 4/8 scatter, which wrapped back
      // over earlier positions and guaranteed overlap after a handful of adds.
      // Either way, findFreePosition nudges clear of anything already there.
      const at = wire ? findFreePosition(nodes, { x: Math.round(wire.at.x - 104), y: Math.round(wire.at.y - 30) }) : nextNodePosition(nodes)
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
      onClick={() => onPick(def)}
      className={`block w-full rounded border-l-2 bg-white px-2 py-1.5 text-left hover:bg-gray-100 dark:bg-gray-800 dark:hover:bg-gray-700 ${NODE_KIND_TONE[def.kind]}`}
    >
      <span className="flex items-center gap-1.5">
        <span className={`rounded px-1 text-[10px] leading-none ${NODE_KIND_BADGE[def.kind]}`}>{KIND_ICON[def.kind] ?? '•'}</span>
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
      <div className="relative flex-1">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
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
          <p className="mb-3 font-semibold text-gray-800 dark:text-gray-100">{label(selected.type)}</p>

          <NodeConfigPanel node={selected} allNodes={nodes} clinicId={clinicId} workflowId={workflowId} onPatchConfig={patchConfig} />

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
