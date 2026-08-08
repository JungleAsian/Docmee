'use client'

// Rev 5 — BotPenguin-aligned automation canvas.
// - Self-documenting node cards: kind badge, live config preview, per-branch
//   output chips whose handles sit on the chip row (true/false, high/low/error,
//   interactive-menu options).
// - Searchable palette with one-line descriptions; dropping a loose connection
//   on the pane opens the same palette and auto-wires the picked node.
// - Branch-colored edges with translated labels; hover toolbar on nodes.
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { api } from '../api/client'
import type { WorkflowNode as WfNode, WorkflowEdge as WfEdge, Doctor, MessageTemplate, Workflow } from '../types'
import {
  WORKFLOW_NODE_TYPES,
  nodeDef,
  NODE_KIND_TONE,
  NODE_KIND_BADGE,
  FIELD_REFERENCE_KEYS,
  collectWorkflowFields,
  collectWorkflowTags,
  collectFieldValueOptions,
  slugifyOptionId,
  uniqueOptionId,
  ENUM_FIELD_OPTIONS,
  parseAiAgentScenarioList,
  type NodeTypeDef,
  type AiAgentScenarioLike,
  type AiAgentScenarioAction,
} from '../workflowNodes'
import { TAG_TYPES, tagLabel } from '../tagTypes'
import { findFreePosition, nextNodePosition } from '../workflowLayout'

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

interface MenuOption {
  optionId: string
  title: string
  description?: string
}

function parseMenuOptionsSafe(raw: unknown): MenuOption[] {
  if (Array.isArray(raw)) return raw.filter((o): o is MenuOption => typeof o === 'object' && o !== null && typeof (o as MenuOption).optionId === 'string' && typeof (o as MenuOption).title === 'string')
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((o): o is MenuOption => typeof o === 'object' && o !== null && typeof o.optionId === 'string' && typeof o.title === 'string') : []
  } catch {
    return []
  }
}

const KIND_ICON: Record<string, string> = {
  trigger: '▶',
  logic: '◈',
  action: '⚡',
}

/** Branch output rows per node type. `key` is the sourceHandle id. */
function branchRows(wf: WfNode): { key: string; tone: string }[] {
  const cfg = wf.config ?? {}
  switch (wf.type) {
    case 'logic.condition':
      return [
        { key: 'true', tone: 'emerald' },
        { key: 'false', tone: 'red' },
      ]
    case 'logic.ai_classify_intent':
      return [
        { key: 'high', tone: 'emerald' },
        { key: 'low', tone: 'amber' },
        { key: 'error', tone: 'red' },
      ]
    case 'action.interactive_menu': {
      const opts = parseMenuOptionsSafe(cfg.options).map((o) => ({ key: o.optionId, tone: 'teal', label: o.title }))
      return [
        ...opts,
        { key: 'restart', tone: 'slate' },
        { key: 'livechat', tone: 'sky' },
        { key: 'default', tone: 'slate' },
      ]
    }
    case 'action.ai_agent':
      return [
        { key: 'replied', tone: 'emerald' },
        { key: 'handoff', tone: 'sky' },
        { key: 'no_match', tone: 'slate' },
        { key: 'error', tone: 'red' },
      ]
    default:
      return []
  }
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

function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** A canvas mode: Enhanced (Docmee chrome) or Classic Builder (BotPenguin
 *  anatomy cards + "+" auto-wire buttons + floating toolbar, on the themed
 *  canvas — same background as Enhanced). */
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
  const rowText = (key: string) =>
    isMenu && !['restart', 'livechat', 'default'].includes(key)
      ? menuOpts.find((o) => o.optionId === key)?.title || key
      : t(`wf.branch.${key}` as Parameters<typeof t>[0])

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
            {rows.length > 0 && (
              <div>
                <p className="mt-1 text-[9px] text-gray-400 dark:text-gray-500">{t('wf.field.options')}</p>
                {rows.map((r) => (
                  <OptionRow key={r.key} handleId={r.key} text={rowText(r.key)} handleClass={RING_HANDLE} onAdd={add} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {face && <p className="line-clamp-3 text-[10px] text-gray-500 dark:text-gray-400">{face}</p>}
            {rows.length > 0 ? (
              <div className="mt-1">
                {rows.map((r) => (
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
          {rows.length > 0 && (
            <div>
              <p className="mt-1 text-[9px] text-gray-400 dark:text-gray-500">{t('wf.field.options')}</p>
              {rows.map((r) => (
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
          {rows.length > 0 && (
            <div className="mt-1">
              {rows.map((r) => (
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

function nextMenuOptionId(existing: MenuOption[]): string {
  let n = existing.length + 1
  while (existing.some((o) => o.optionId === `option_${n}`)) n++
  return `option_${n}`
}

interface PendingWire {
  nodeId: string
  handleId?: string
  at: { x: number; y: number }
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
  const { t, language } = useI18n()
  const { screenToFlowPosition, zoomIn, zoomOut, fitView } = useReactFlow()
  const label = useCallback((type: string) => t((nodeDef(type)?.labelKey ?? type) as Parameters<typeof t>[0]), [t])

  // The clinic's active doctors, for the no-code optionId picker in the
  // interactive-menu options editor: picking a doctor fills the option with
  // the exact name the worker's resolveWorkflowDoctorId matches at runtime.
  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const activeDoctors = useMemo(
    () => (doctorsQuery.data?.doctors ?? []).filter((d) => d.isActive),
    [doctorsQuery.data],
  )
  // The clinic's message templates, for the send_template category dropdown:
  // the worker sends the APPROVED template of the chosen category, so the
  // panel marks which categories actually have one (anything else silently
  // no-ops at runtime — findApprovedByCategory returns null and skips).
  const templatesQuery = useQuery({
    queryKey: ['message-templates', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ templates: MessageTemplate[] }>(`/clinics/${clinicId}/message-templates`),
  })
  const approvedTemplateCategories = useMemo(
    () =>
      new Set(
        (templatesQuery.data?.templates ?? [])
          .filter((tpl) => tpl.status === 'approved')
          .map((tpl) => tpl.category),
      ),
    [templatesQuery.data],
  )
  // The clinic's other active workflows, for the AI Agent node's "route to a
  // specific workflow" scenario target picker. Reuses the SAME query key +
  // endpoint the Studio workflows list page already fetches with, so this is
  // free cache reuse rather than an extra request.
  const workflowsQuery = useQuery({
    queryKey: ['workflows', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ workflows: Workflow[] }>(`/clinics/${clinicId}/workflows`),
  })
  const routableWorkflows = useMemo(
    () => (workflowsQuery.data?.workflows ?? []).filter((wf) => wf.status === 'active' && wf.id !== workflowId),
    [workflowsQuery.data, workflowId],
  )

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
      const color = edgeColor(e.sourceHandle)
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        label: e.sourceHandle ? t(`wf.branch.${e.sourceHandle}` as Parameters<typeof t>[0]) : undefined,
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

  // --- interactive_menu options editor helpers --------------------------------
  const menuOptions = useMemo(() => {
    if (!selected || selected.type !== 'action.interactive_menu') return []
    return parseMenuOptionsSafe(selected.config.options)
  }, [selected])

  const setMenuOptions = useCallback(
    (next: MenuOption[]) => {
      if (!selected) return
      const value = JSON.stringify(next)
      onChange({
        nodes: nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, options: value } } : n)),
        edges,
      })
    },
    [selected, nodes, edges, onChange],
  )

  const patchMenuOption = useCallback(
    (index: number, patch: Partial<MenuOption>) => {
      const next = menuOptions.map((o, i) => (i === index ? { ...o, ...patch } : o))
      setMenuOptions(next)
    },
    [menuOptions, setMenuOptions],
  )

  const addMenuOption = useCallback(() => {
    setMenuOptions([...menuOptions, { optionId: nextMenuOptionId(menuOptions), title: '' }])
  }, [menuOptions, setMenuOptions])

  const removeMenuOption = useCallback(
    (index: number) => {
      setMenuOptions(menuOptions.filter((_, i) => i !== index))
    },
    [menuOptions, setMenuOptions],
  )

  const isMenu = selected?.type === 'action.interactive_menu'

  // --- action.ai_agent scenarios editor helpers -------------------------------
  const aiAgentScenarios = useMemo(() => {
    if (!selected || selected.type !== 'action.ai_agent') return []
    return parseAiAgentScenarioList(selected.config.scenarios)
  }, [selected])

  const setAiAgentScenarios = useCallback(
    (next: AiAgentScenarioLike[]) => {
      if (!selected) return
      const value = JSON.stringify(next)
      onChange({
        nodes: nodes.map((n) => (n.id === selected.id ? { ...n, config: { ...n.config, scenarios: value } } : n)),
        edges,
      })
    },
    [selected, nodes, edges, onChange],
  )

  const patchAiAgentScenario = useCallback(
    (index: number, patch: Partial<AiAgentScenarioLike>) => {
      const next = aiAgentScenarios.map((s, i) => (i === index ? { ...s, ...patch } : s))
      setAiAgentScenarios(next)
    },
    [aiAgentScenarios, setAiAgentScenarios],
  )

  const nextScenarioId = (existing: AiAgentScenarioLike[]): string => {
    let n = existing.length + 1
    while (existing.some((s) => s.id === `scenario_${n}`)) n++
    return `scenario_${n}`
  }

  const addAiAgentScenario = useCallback(() => {
    setAiAgentScenarios([...aiAgentScenarios, { id: nextScenarioId(aiAgentScenarios), description: '', action: 'reply' }])
  }, [aiAgentScenarios, setAiAgentScenarios])

  const removeAiAgentScenario = useCallback(
    (index: number) => {
      setAiAgentScenarios(aiAgentScenarios.filter((_, i) => i !== index))
    },
    [aiAgentScenarios, setAiAgentScenarios],
  )

  const isAiAgent = selected?.type === 'action.ai_agent'

  /** Translated field label; humanize if a key is still missing. */
  const fieldLabel = (key: string) => {
    const i18nKey = `wf.field.${key}`
    const out = t(i18nKey as Parameters<typeof t>[0])
    return out === i18nKey ? humanize(key) : out
  }

  // --- No-code Field / Tag selectors ---------------------------------------
  // Every field name any node in the workflow could plausibly have written,
  // and every tag value already used by an add_tag node, for the dropdowns
  // below. Recomputed as the graph changes.
  const availableFields = useMemo(() => collectWorkflowFields(nodes), [nodes])
  const availableTags = useMemo(() => collectWorkflowTags(nodes), [nodes])
  // Dependent value options for logic.condition: once the admin picks a
  // field, the literals that field can actually hold at runtime (menu option
  // titles, status enums, booleans) are offered as a dropdown. Empty when the
  // field takes free text — the panel keeps a plain input then.
  const conditionValueOptions = useMemo(
    () =>
      selected?.type === 'logic.condition'
        ? collectFieldValueOptions(nodes, String(selected.config?.['field'] ?? ''))
        : [],
    [nodes, selected],
  )
  // Config keys the admin has explicitly opted to type by hand instead of
  // picking from the list (e.g. a field no earlier node produces yet, or a
  // one-off tag outside the canonical palette). Scoped by `${nodeId}:${key}`
  // so switching nodes never carries it over.
  const [manualFieldKeys, setManualFieldKeys] = useState<Set<string>>(new Set())
  const setManualField = useCallback((manualKey: string, manual: boolean) => {
    setManualFieldKeys((prev) => {
      const next = new Set(prev)
      if (manual) next.add(manualKey)
      else next.delete(manualKey)
      return next
    })
  }, [])
  // A key is "pickable" when its value should come from a list of known
  // names rather than free text: field references, or add_tag's own `tag`
  // (picked from the canonical tag palette so it always renders with a
  // label/colour elsewhere in the app — see tagTypes.ts).
  const isPickableKey = (key: string) => FIELD_REFERENCE_KEYS.has(key) || key === 'tag'
  /** Options for a pickable key: canonical tag palette (+ any custom tags
   *  already used in this workflow) for `tag`, or the field pool otherwise.
   *  Human-readable labels — never the raw technical name — per option. */
  const pickableOptions = useCallback(
    (key: string): { value: string; label: string }[] => {
      if (key === 'tag') {
        const canonical = TAG_TYPES.map((tt) => ({ value: tt.name, label: tagLabel(tt.name, language) }))
        const extra = availableTags
          .filter((tag) => !TAG_TYPES.some((tt) => tt.name === tag))
          .map((tag) => ({ value: tag, label: humanize(tag) }))
        return [...canonical, ...extra]
      }
      return availableFields.map((f) => ({ value: f, label: humanize(f) }))
    },
    [availableFields, availableTags, language],
  )

  return (
    <div className="flex h-full min-h-[34rem] overflow-hidden rounded-lg border border-gray-200 dark:border-gray-800">
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

        {/* Builder-mode switcher (top-right) */}
        <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-md border border-gray-300 bg-white text-xs font-medium text-gray-600 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
          {(['enhanced', 'classic'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`px-2.5 py-1 ${
                mode === m
                  ? 'bg-teal-600 text-white'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {m === 'enhanced' ? t('wf.enhancedBuilder') : t('wf.classicBuilder')}
            </button>
          ))}
        </div>

        {/* Classic Builder floating toolbar (bottom-center): zoom / fit */}
        {mode === 'classic' && (
          <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-1 text-gray-600 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <button type="button" title="−" onClick={() => zoomOut()} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
              −
            </button>
            <button type="button" title="+" onClick={() => zoomIn()} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
              +
            </button>
            <button type="button" title="⤢" onClick={() => fitView()} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
              ⤢
            </button>
          </div>
        )}

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

          {/* Standard text fields */}
          {(nodeDef(selected.type)?.fields ?? []).map((key) => {
            const manualKey = `${selected.id}:${key}`
            const isManual = manualFieldKeys.has(manualKey)
            const value = String(selected.config[key] ?? '')
            // logic.condition's `value` becomes a dependent dropdown once the
            // chosen field has a known value vocabulary (menu option titles,
            // status enums, booleans); free-text fields keep the plain input.
            const isConditionValue = key === 'value' && selected.type === 'logic.condition'
            const hasValueOptions = isConditionValue && conditionValueOptions.length > 0
            return (
            <label key={key} className="mb-2 block">
              <span className="mb-0.5 block font-medium text-gray-600 dark:text-gray-300">{fieldLabel(key)}</span>
              {(key === 'options' && isMenu) || (key === 'scenarios' && isAiAgent) ? (
                // edited via the richer editor below
                <input
                  value={value}
                  readOnly
                  className="w-full cursor-not-allowed rounded border border-gray-300 bg-gray-100 p-1.5 text-xs text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                />
              ) : isPickableKey(key) && !isManual ? (
                <div className="flex items-center gap-1">
                  <select
                    value={value}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') setManualField(manualKey, true)
                      else patchConfig(key, e.target.value)
                    }}
                    className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="">{t('wf.field.selectPlaceholder')}</option>
                    {(() => {
                      const options = pickableOptions(key)
                      const known = options.some((o) => o.value === value)
                      return value && !known ? [{ value, label: humanize(value) }, ...options] : options
                    })().map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('wf.field.customOption')}</option>
                  </select>
                </div>
              ) : isPickableKey(key) && isManual ? (
                <div className="flex items-center gap-1">
                  <input
                    value={value}
                    onChange={(e) => patchConfig(key, e.target.value)}
                    placeholder={key === 'tag' ? 'tag_name' : 'field_name'}
                    className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={() => setManualField(manualKey, false)}
                    title={t('wf.field.backToList')}
                    className="shrink-0 rounded border border-gray-300 px-1.5 py-1.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↩
                  </button>
                </div>
              ) : hasValueOptions && !isManual ? (
                <div>
                  <select
                    value={value}
                    onChange={(e) => {
                      if (e.target.value === '__custom__') setManualField(manualKey, true)
                      else patchConfig(key, e.target.value)
                    }}
                    className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    <option value="">{t('wf.field.selectPlaceholder')}</option>
                    {(() => {
                      const options = conditionValueOptions.map((o) => ({ value: o.value, label: o.label ?? humanize(o.value) }))
                      const known = options.some((o) => o.value === value)
                      return value && !known ? [{ value, label: humanize(value) }, ...options] : options
                    })().map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    <option value="__custom__">{t('wf.field.customOption')}</option>
                  </select>
                  <span className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500">{t('wf.hint.valueFromField')}</span>
                </div>
              ) : hasValueOptions && isManual ? (
                <div className="flex items-center gap-1">
                  <input
                    value={value}
                    onChange={(e) => patchConfig(key, e.target.value)}
                    placeholder={t('wf.field.value')}
                    className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                  <button
                    type="button"
                    onClick={() => setManualField(manualKey, false)}
                    title={t('wf.field.backToList')}
                    className="shrink-0 rounded border border-gray-300 px-1.5 py-1.5 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                  >
                    ↩
                  </button>
                </div>
              ) : ENUM_FIELD_OPTIONS[key] ? (
                <div>
                  <select
                    value={value}
                    onChange={(e) => patchConfig(key, e.target.value)}
                    className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                  >
                    {ENUM_FIELD_OPTIONS[key]!.map((o) => (
                      <option key={o.value} value={o.value}>
                        {t(o.labelKey as Parameters<typeof t>[0])}
                        {key === 'category' && templatesQuery.data && approvedTemplateCategories.has(o.value as MessageTemplate['category']) ? ' ✓' : ''}
                      </option>
                    ))}
                  </select>
                  {key === 'category' && value && templatesQuery.data && !approvedTemplateCategories.has(value as MessageTemplate['category']) && (
                    <span className="mt-0.5 block text-[10px] text-amber-600 dark:text-amber-400">{t('wf.hint.noApprovedTemplate')}</span>
                  )}
                </div>
              ) : key === 'validation' ? (
                <select
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  className="w-full rounded border border-gray-300 bg-white p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                >
                  {['', 'text', 'date', 'time', 'phone', 'number', 'email'].map((v) => (
                    <option key={v} value={v}>
                      {v || '—'}
                    </option>
                  ))}
                </select>
              ) : key === 'message' || key === 'prompt' || key === 'question' || key === 'text' || key === 'personality' || key === 'customInstructions' ? (
                <textarea
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              ) : (
                <input
                  value={String(selected.config[key] ?? '')}
                  onChange={(e) => patchConfig(key, e.target.value)}
                  className="w-full rounded border border-gray-300 p-1.5 text-xs dark:border-gray-700 dark:bg-gray-800"
                />
              )}
            </label>
            )
          })}

          {/* Interactive menu options editor */}
          {isMenu && (
            <div className="mb-3 space-y-2 rounded border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.field.options')}</p>
              <div className="space-y-2">
                {menuOptions.map((opt, oi) => (
                  <div key={oi} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                    <input
                      value={opt.title}
                      onChange={(e) => patchMenuOption(oi, { title: e.target.value })}
                      maxLength={24}
                      placeholder={t('wf.optionTitle')}
                      className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    <input
                      value={opt.description ?? ''}
                      onChange={(e) => patchMenuOption(oi, { description: e.target.value || undefined })}
                      maxLength={72}
                      placeholder={t('wf.optionDescription')}
                      className="w-full rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    <div className="flex items-center gap-1">
                      {(() => {
                        // No-code optionId: pick a real clinic doctor instead of
                        // hand-typing an id. The option's id becomes a readable
                        // slug (branch handle); its title — what the worker's
                        // resolveWorkflowDoctorId actually matches at runtime —
                        // is filled with the doctor's registered name when empty.
                        const optManualKey = `${selected.id}:optionId:${oi}`
                        const isOptManual = manualFieldKeys.has(optManualKey)
                        const matchedDoctor = activeDoctors.find((d) => slugifyOptionId(d.name) === opt.optionId)
                        if (!isOptManual) {
                          return (
                            <div className="w-full">
                              <select
                                value={matchedDoctor ? matchedDoctor.id : opt.optionId ? '__current__' : ''}
                                onChange={(e) => {
                                  const picked = e.target.value
                                  if (picked === '__custom__') {
                                    setManualField(optManualKey, true)
                                    return
                                  }
                                  const doc = activeDoctors.find((d) => d.id === picked)
                                  if (!doc) return
                                  const otherIds = menuOptions.filter((_, i) => i !== oi).map((o) => o.optionId)
                                  patchMenuOption(oi, {
                                    optionId: uniqueOptionId(slugifyOptionId(doc.name), otherIds),
                                    ...(opt.title.trim() ? {} : { title: doc.name }),
                                  })
                                }}
                                className="w-full rounded border border-gray-300 bg-white p-1 text-[10px] text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                              >
                                <option value="">{t('wf.field.pickDoctor')}</option>
                                {opt.optionId && !matchedDoctor && <option value="__current__">{opt.optionId}</option>}
                                {activeDoctors.map((d) => (
                                  <option key={d.id} value={d.id}>
                                    {d.name}
                                    {d.specialty ? ` · ${d.specialty}` : ''}
                                  </option>
                                ))}
                                <option value="__custom__">{t('wf.field.customOption')}</option>
                              </select>
                              <span className="mt-0.5 block text-[10px] text-gray-400 dark:text-gray-500">{t('wf.hint.doctorOptionId')}</span>
                            </div>
                          )
                        }
                        return (
                          <>
                            <input
                              value={opt.optionId}
                              onChange={(e) => patchMenuOption(oi, { optionId: e.target.value })}
                              placeholder="optionId"
                              className="w-full rounded border border-gray-300 p-1 text-[10px] font-mono text-gray-500 dark:border-gray-700 dark:bg-gray-800"
                            />
                            <button
                              type="button"
                              onClick={() => setManualField(optManualKey, false)}
                              title={t('wf.field.backToList')}
                              className="shrink-0 rounded border border-gray-300 px-1.5 py-1 text-[10px] text-gray-500 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800"
                            >
                              ↩
                            </button>
                          </>
                        )
                      })()}
                      <button type="button" onClick={() => removeMenuOption(oi)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addMenuOption} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
                + {t('wf.addOption')}
              </button>
            </div>
          )}

          {/* AI Agent scenarios editor */}
          {isAiAgent && (
            <div className="mb-3 space-y-2 rounded border border-violet-200 bg-violet-50/50 p-2 dark:border-violet-900 dark:bg-violet-950/30">
              <p className="font-medium text-gray-600 dark:text-gray-300">{t('wf.field.scenarios')}</p>
              <div className="space-y-2">
                {aiAgentScenarios.map((sc, si) => (
                  <div key={si} className="space-y-1 rounded border border-gray-200 bg-white p-1.5 dark:border-gray-700 dark:bg-gray-900">
                    <textarea
                      value={sc.description}
                      onChange={(e) => patchAiAgentScenario(si, { description: e.target.value })}
                      rows={2}
                      placeholder={t('wf.scenario.description')}
                      className="w-full resize-none rounded border border-gray-300 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    />
                    <select
                      value={sc.action}
                      onChange={(e) => {
                        const action = e.target.value as AiAgentScenarioAction
                        patchAiAgentScenario(si, { action, ...(action === 'route' ? {} : { targetWorkflowId: undefined }) })
                      }}
                      className="w-full rounded border border-gray-300 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                    >
                      <option value="reply">{t('wf.scenario.actionReply')}</option>
                      <option value="route">{t('wf.scenario.actionRoute')}</option>
                      <option value="handoff">{t('wf.scenario.actionHandoff')}</option>
                    </select>
                    {sc.action === 'route' && (
                      <select
                        value={sc.targetWorkflowId ?? ''}
                        onChange={(e) => patchAiAgentScenario(si, { targetWorkflowId: e.target.value })}
                        className="w-full rounded border border-gray-300 bg-white p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                      >
                        <option value="">{t('wf.scenario.targetWorkflow')}</option>
                        {routableWorkflows.map((wf) => (
                          <option key={wf.id} value={wf.id}>
                            {wf.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex justify-end">
                      <button type="button" onClick={() => removeAiAgentScenario(si)} className="shrink-0 text-[10px] text-red-600 hover:underline">
                        {t('common.delete')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addAiAgentScenario} className="text-xs text-violet-700 hover:underline dark:text-violet-300">
                + {t('wf.addScenario')}
              </button>
            </div>
          )}

          {(nodeDef(selected.type)?.fields ?? []).length === 0 && !isMenu && !isAiAgent && (
            <p className="mb-3 text-gray-400">{t('wf.noConfig')}</p>
          )}
          <button
            type="button"
            onClick={deleteSelected}
            className="w-full rounded border border-red-300 px-2 py-1 font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300"
          >
            {t('wf.deleteNode')}
          </button>
        </aside>
      )}
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
