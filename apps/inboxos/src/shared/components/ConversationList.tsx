'use client'

// Conversation list (left column) — the operational queue. TanStack Query with a
// 10s refetch so the secretary sees new inbound messages without a manual refresh.
// Threads the workers flagged as a possible emergency (red) or urgent/upset (amber)
// float to the top under a "Needs attention · Safety" header so they are
// unmistakable while scanning a dense queue (Req 20). Supports a free-text search on
// the contact handle, a channel filter, a status filter and an assignee filter.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useI18n } from '../hooks/useI18n'
import { useTeam } from '../hooks/useTeam'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { avatarColor, avatarLabel, relativeTime } from '../format'
import { waitingMinutes, slaLevel, formatWaiting } from '../sla'
import { assessSafety, safetyRank, type SafetyLevel } from '../safety'
import { conversationMode } from '../conversationMode'
import { filterConversations, type ChannelFilter } from '../conversationFilter'
import { LENSES, lensCounts, matchesLens, type ConversationLens } from '../conversationLens'
import { readInboxSettings } from '../inboxSettings'
import { DeleteConversationDialog } from './DeleteConversationDialog'
import type { Channel, Conversation, ConversationStatus } from '../types'

// Req 20: row treatment per safety severity — a coloured left rail + a tinted row +
// a badge so an emergency or urgent thread is unmistakable while scanning the queue.
// Critical = red, warning = amber.
const SAFETY_ROW: Record<
  SafetyLevel,
  { rail: string; row: string; badge: string; labelKey: 'safety.critical.list' | 'safety.warning.list' }
> = {
  critical: {
    rail: 'border-l-red-500',
    row: 'bg-red-50/70 dark:bg-red-950/30',
    badge: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
    labelKey: 'safety.critical.list',
  },
  warning: {
    rail: 'border-l-amber-500',
    row: 'bg-amber-50/70 dark:bg-amber-950/20',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    labelKey: 'safety.warning.list',
  },
}

// Req 4 — channel indicator. The avatar carries a small coloured badge in the
// platform's brand colour (WhatsApp green, Messenger blue, Instagram pink), echoed
// by the filter chips. Channel names are proper nouns → language-neutral labels.
const CHANNEL: Record<Channel, { label: string; glyph: string; badge: string; dot: string }> = {
  whatsapp: { label: 'WhatsApp', glyph: '✆', badge: 'bg-[#25D366]', dot: 'bg-[#25D366]' },
  messenger: { label: 'Messenger', glyph: 'f', badge: 'bg-blue-500', dot: 'bg-blue-500' },
  instagram: { label: 'Instagram', glyph: '◉', badge: 'bg-pink-600', dot: 'bg-pink-600' },
}

const STATUS_BADGE: Record<ConversationStatus, string> = {
  open: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
  assigned: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  handoff: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  snoozed: 'bg-[var(--crm-hover-bg)] text-[var(--crm-primary-color)]',
  resolved: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  archived: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
}

// Assignee filter (Rev1 #35 — filter assigned work by user). 'all' = no filter,
// 'mine' = the current user, 'unassigned' = no assignee, any other value = a team
// member id. 'mine'/'all'/'unassigned' are reserved and never collide with a uuid.
type AssigneeFilter = 'all' | 'mine' | 'unassigned' | (string & {})

type ActiveChannelQueryState = {
  data?: { channels: Array<{ channel: Channel; name: string }> }
  isLoading: boolean
  isError: boolean
}

export function resolveActiveChannelFilter(
  showInactiveChannels: boolean,
  query: ActiveChannelQueryState,
): ReadonlySet<Channel> | undefined {
  if (showInactiveChannels || query.isLoading || query.isError || !query.data) return undefined
  return new Set(query.data.channels.map((entry) => entry.channel))
}

export function shouldShowChannelFilter(activeChannels?: ReadonlySet<Channel>): boolean {
  return activeChannels === undefined || activeChannels.size > 1
}

export function projectConversationList(
  rows: Conversation[],
  search: string,
  channel: ChannelFilter,
  activeChannels?: ReadonlySet<Channel>,
) {
  const filteredRows = filterConversations(rows, search, channel, activeChannels)
  return { rows: filteredRows, counts: lensCounts(filteredRows) }
}

export function visibleConversationLenses(_showInactiveChannels: boolean): readonly ConversationLens[] {
  return LENSES
}

export function ConversationList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const userId = user?.id
  const canDeleteConversations = user?.role === 'clinic_admin' || user?.role === 'ia_studio_admin'
  const members = useTeam()
  const { clinicId } = useActiveClinic()
  const clinicSettings = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: { settings?: Record<string, unknown> | null } }>(`/clinics/${clinicId}`),
  })
  const showInactiveChannels = readInboxSettings(clinicSettings.data?.clinic.settings).patientChatVisibility.inactiveChannels
  const activeChannelsQuery = useQuery({
    queryKey: ['active-channels', clinicId],
    enabled: Boolean(clinicId && !showInactiveChannels),
    queryFn: () => api.get<{ channels: Array<{ channel: Channel; name: string }> }>(`/clinics/${clinicId}/channels/active`),
  })
  const activeChannels = useMemo(
    () => resolveActiveChannelFilter(showInactiveChannels, activeChannelsQuery),
    [activeChannelsQuery.data, activeChannelsQuery.isError, activeChannelsQuery.isLoading, showInactiveChannels],
  )
  const qc = useQueryClient()
  // Operational lens (design's Active/Bot/Assigned/Closed tabs) — derived entirely
  // client-side over the full clinic set so the tab counts are accurate and switching
  // is instant. Defaults to 'active' (what needs a person now); safety-flagged threads
  // are exempt from the lens and always surface (see below).
  const [lens, setLens] = useState<ConversationLens>('active')
  // Assignment stays available through the assignment panel and bulk actions; the
  // main queue no longer pins a permanent Assignee/Anyone filter.
  const [assignee] = useState<AssigneeFilter>('all')
  // Find-a-thread affordances (client-side over the loaded set — the list isn't
  // server-paginated): free-text search on the contact handle + a channel filter.
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set())
  const [deleteConversationId, setDeleteConversationId] = useState<string | null>(null)
  useEffect(() => {
    if (channel !== 'all' && activeChannels !== undefined && !activeChannels.has(channel)) {
      setChannel('all')
    }
  }, [activeChannels, channel])
  // Item 10a of the 25-item batch: a per-row hide button that declutters the queue
  // without touching conversation status server-side — purely a local view
  // preference for this browser tab. Safety-flagged threads are never hideable
  // (matches the "always surfaces" invariant already documented below).
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = window.sessionStorage.getItem('docmee-hidden-conversations')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  function hideRow(id: string) {
    setHiddenIds((current) => {
      const next = new Set(current)
      next.add(id)
      try {
        window.sessionStorage.setItem('docmee-hidden-conversations', JSON.stringify([...next]))
      } catch {
        // sessionStorage unavailable — hide state just won't persist across reloads
      }
      return next
    })
  }
  function unhideAll() {
    setHiddenIds(new Set())
    try {
      window.sessionStorage.removeItem('docmee-hidden-conversations')
    } catch {
      // ignore
    }
  }

  // The list is a FIXED (non-scrolling) pane: rather than an inner scrollbar it
  // shows one height-fitted page of threads at a time with a compact pager, so the
  // queue never clips and never introduces a scrollbar. pageSize is derived from
  // the actual rows-area height (ResizeObserver) with a conservative row-height
  // estimate, so a page always fits at any viewport.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(10)
  const rowsAreaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = rowsAreaRef.current
    if (!el) return
    const ROW_H = 84 // conservative upper estimate of one ThreadRow's height
    const LABEL_RESERVE = 64 // room for the safety/open group labels
    const recompute = () => {
      const h = el.clientHeight
      if (h <= 0) return
      setPageSize(Math.max(1, Math.floor((h - LABEL_RESERVE) / ROW_H)))
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const query = useQuery({
    queryKey: ['conversations', assignee, userId, search.trim()],
    refetchInterval: 10_000,
    queryFn: () => {
      // The lens narrows by status client-side, so the only server-side filter we
      // still apply is the assignee (it can scope a doctor to their own work before
      // the full set is ever fetched).
      const params = new URLSearchParams()
      const assignedTo =
        assignee === 'all' ? null : assignee === 'mine' ? (userId ?? null) : assignee
      if (assignedTo) params.set('assigned_to', assignedTo)
      if (search.trim()) params.set('q', search.trim())
      params.set('limit', '75')
      const qs = params.toString()
      return api.get<{ conversations: Conversation[] }>(`/conversations${qs ? `?${qs}` : ''}`)
    },
  })

  const bulkMutation = useMutation({
    mutationFn: (payload: { action: 'assign' | 'resolve' | 'archive'; userId?: string }) =>
      api.post('/conversations/bulk', { ids: [...selectedRows], ...payload }),
    onSuccess: () => {
      setSelectedRows(new Set())
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const allRows = query.data?.conversations ?? []
  const filtersActive = search.trim() !== '' || channel !== 'all'
  const projection = useMemo(
    () => projectConversationList(allRows, search, channel, activeChannels),
    [allRows, search, channel, activeChannels],
  )
  // Counts describe the same filtered rows rendered below.
  const counts = projection.counts

  // Apply the search/channel filter, then float safety-critical / urgent threads to
  // the top (stable within each severity band, so recency order is preserved
  // otherwise) — Req 20.
  const conversations = useMemo(() => {
    return projection.rows
      .map((c, i) => ({ c, i, rank: safetyRank(assessSafety(c.tags).level) }))
      .sort((a, b) => b.rank - a.rank || a.i - b.i)
      .map((x) => x.c)
  }, [projection.rows])

  // Split into the safety queue and the rest so each gets its own group header.
  // Safety-flagged threads ALWAYS surface, regardless of the active lens — a tab must
  // never be able to hide an emergency/urgent thread (Req 20). The lens only narrows
  // the ordinary queue below the safety group.
  const safetyRows = conversations.filter((c) => assessSafety(c.tags).level)
  const normalRowsAll = conversations.filter(
    (c) => !assessSafety(c.tags).level && matchesLens(c, lens),
  )
  const normalRows = normalRowsAll.filter((c) => !hiddenIds.has(c.id))
  const hiddenCount = normalRowsAll.length - normalRows.length
  const visibleCount = safetyRows.length + normalRows.length

  // Paginate the ordered queue (safety threads first) into height-fitted pages.
  const orderedRows = [...safetyRows, ...normalRows]
  const pageCount = Math.max(1, Math.ceil(orderedRows.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageStart = currentPage * pageSize
  const pageRows = orderedRows.slice(pageStart, pageStart + pageSize)
  const pageSafety = pageRows.filter((c) => assessSafety(c.tags).level)
  const pageNormal = pageRows.filter((c) => !assessSafety(c.tags).level)
  // Jump back to the first page whenever the underlying queue changes (a new
  // lens/filter/search), and clamp if the page count shrank under us.
  useEffect(() => {
    setPage(0)
  }, [lens, assignee, search, channel])
  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1))
  }, [page, pageCount])

  // CRE-62: keyboard navigation for the operator — j/k or arrow keys move through
  // the visible queue and Enter (re)opens the highlighted thread. A ref carries the
  // live list so the listener attaches once; it is ignored while a field is focused
  // so it never fights the search or reply inputs.
  const orderedIds = pageRows.map((c) => c.id)
  const navRef = useRef<{ ids: string[]; selectedId: string | null; onSelect: (id: string) => void }>({
    ids: orderedIds,
    selectedId,
    onSelect,
  })
  navRef.current = { ids: orderedIds, selectedId, onSelect }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return
      }
      const { ids, selectedId: sel, onSelect: pick } = navRef.current
      if (ids.length === 0) return
      const idx = sel ? ids.indexOf(sel) : -1
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        pick(ids[idx < 0 ? 0 : Math.min(idx + 1, ids.length - 1)]!)
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        pick(ids[idx < 0 ? 0 : Math.max(idx - 1, 0)]!)
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault()
        pick(ids[idx]!)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function clearFilters() {
    setSearch('')
    setChannel('all')
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedRows((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  // Top-of-list urgent banner (Screen 17) — when one or more safety-flagged threads
  // are waiting on a human it sits above everything, pulsing, naming the patient
  // (or the count) and jumping straight to the most urgent thread on tap. This makes
  // a patient-safety escalation unmistakable even on a phone where the list scrolls.
  const topSafety = safetyRows[0]
  const urgentName = topSafety ? topSafety.patientName || topSafety.channelContactHandle : ''

  return (
    <div className="flex h-full flex-col bg-[var(--crm-bg-color)]">
      {safetyRows.length > 0 && (
        <button
          type="button"
          onClick={() => topSafety && onSelect(topSafety.id)}
          className="flex shrink-0 items-center gap-2 bg-red-600 px-3 py-2 text-left text-[12.5px] font-semibold text-white transition hover:bg-red-700"
        >
          <span aria-hidden className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-white" />
          </span>
          <span className="min-w-0 flex-1 truncate">
            {safetyRows.length === 1
              ? t('conv.urgentBanner.one', { name: urgentName })
              : t('conv.urgentBanner.many', { n: String(safetyRows.length) })}
          </span>
          <span aria-hidden className="shrink-0 opacity-90">
            →
          </span>
        </button>
      )}
      <div className="border-b border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-bold">{t('conv.title')}</h2>
          <div className="flex items-center gap-2">
            {!query.isLoading && (
              <span className="text-[11px] text-gray-400">
                {t('conv.countOpen', { n: String(visibleCount) })}
                {safetyRows.length > 0 && (
                  <>
                    {' · '}
                    <span className="font-bold text-red-600 dark:text-red-400">
                      {t('conv.countUrgent', { n: String(safetyRows.length) })}
                    </span>
                  </>
                )}
              </span>
            )}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('docmee:collapse-conversation-list'))}
              className="hidden rounded-md border border-[var(--crm-border-color)] px-2 py-1 text-[11px] font-semibold text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)] md:inline-flex"
              aria-label="Collapse conversation list"
              title="Collapse conversation list"
            >
              ⇤
            </button>
          </div>
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={unhideAll}
            className="mb-2 text-[11px] font-medium text-[var(--crm-primary-color)] hover:underline"
          >
            {t('conv.showHidden', { n: String(hiddenCount) })}
          </button>
        )}

        {/* Find a thread by patient handle (client-side over the loaded set). */}
        <div className="relative mb-2">
          <span aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            🔎
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('conv.search')}
            aria-label={t('conv.search')}
            className="w-full rounded-lg border border-gray-300 py-1.5 pl-8 pr-2.5 text-xs outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-800"
          />
        </div>

        {/* Channel filter (Req 4) — a dropdown (matching the Assignee filter) so the
            queue controls stay compact and consistent. */}
        {shouldShowChannelFilter(activeChannels) && <label className="mb-2 flex items-center gap-1.5 text-xs">
          <span className="text-gray-500">{t('conv.filter.channel')}:</span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value as ChannelFilter)}
            className="min-w-0 flex-1 truncate rounded-lg border border-gray-300 px-2 py-1 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
          >
            <option value="all">{t('conv.filter.allChannels')}</option>
            {(Object.keys(CHANNEL) as Channel[]).filter((ch) => activeChannels === undefined || activeChannels.has(ch)).map((ch) => (
              <option key={ch} value={ch}>
                {CHANNEL[ch].label}
              </option>
            ))}
          </select>
        </label>}

        {/* Operational lens tabs (Active / Bot / Assigned / Closed) with live counts —
            the secretary's primary triage control, narrowing the queue client-side. */}
        <div role="tablist" aria-label={t('conv.lens.label')} className="crm-conversation-lens-tabs flex flex-nowrap gap-1">
          {visibleConversationLenses(showInactiveChannels).map((l) => (
            <LensTab
              key={l}
              active={lens === l}
              count={counts[l]}
              onClick={() => setLens(l)}
              label={t(`conv.lens.${l}` as const)}
            />
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selectedRows.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--crm-border-color)] bg-[var(--crm-hover-bg)] px-3 py-2 text-xs shadow-sm">
            <span className="font-bold text-[var(--crm-primary-color)]">{selectedRows.size} selected</span>
            <button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ action: 'assign', userId })}
              className="rounded-md border border-[var(--crm-primary-color)] bg-[var(--crm-card-bg)] px-2 py-1 font-semibold text-[var(--crm-primary-color)] disabled:opacity-50"
            >
              Assign to me
            </button>
            <button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ action: 'resolve' })}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Resolve
            </button>
            <button
              type="button"
              disabled={bulkMutation.isPending}
              onClick={() => bulkMutation.mutate({ action: 'archive' })}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 font-semibold text-gray-700 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            >
              Archive
            </button>
            <button
              type="button"
              onClick={() => setSelectedRows(new Set())}
              className="ml-auto rounded-md px-2 py-1 font-semibold text-gray-500 hover:bg-white dark:hover:bg-gray-900"
            >
              Clear
            </button>
          </div>
        )}
        <div ref={rowsAreaRef} className="min-h-0 flex-1 overflow-hidden">
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          query.error instanceof ApiError && query.error.status === 403 ? (
            // Permission-denied — e.g. an admin switched into a clinic they can't
            // read. Distinct from a transient error: a retry won't help, so we offer
            // none and explain instead.
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-gray-100 text-xl text-gray-500 dark:bg-gray-800">
                🔒
              </span>
              <p className="text-sm font-semibold">{t('common.forbidden.title')}</p>
              <p className="text-xs text-gray-500">{t('common.forbidden.body')}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-red-100 text-xl text-red-600 dark:bg-red-950/50">
                ⚠
              </span>
              <p className="text-sm font-semibold">{t('common.error')}</p>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="rounded-lg bg-[var(--crm-primary-color)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--crm-primary-hover)]"
              >
                ↻ {t('common.retry')}
              </button>
            </div>
          )
        ) : visibleCount === 0 ? (
          filtersActive ? (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-gray-100 text-xl text-gray-400 dark:bg-gray-800">
                🔍
              </span>
              <p className="text-sm font-semibold">{t('conv.noMatch')}</p>
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                ✕ {t('conv.clearFilters')}
              </button>
            </div>
          ) : allRows.length > 0 ? (
            // The clinic has threads, just none under the active lens — point the user
            // back to a populated tab rather than implying the inbox is empty.
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-gray-100 text-xl text-gray-400 dark:bg-gray-800">
                📂
              </span>
              <p className="text-sm font-semibold">{t('conv.lens.empty')}</p>
              <p className="max-w-[22rem] text-xs text-gray-500 dark:text-gray-400">{t('conv.lens.emptyHelp')}</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-xl bg-[var(--crm-hover-bg)] text-xl text-[var(--crm-primary-color)]">
                📭
              </span>
              <p className="text-sm font-semibold">{t('conv.empty')}</p>
              <p className="max-w-[22rem] text-xs text-gray-500 dark:text-gray-400">{t('conv.emptyHelp')}</p>
            </div>
          )
        ) : (
          <ul className="crm-conversation-list-rows">
            {pageSafety.length > 0 && (
              <li>
                <GroupLabel danger>⚠ {t('conv.group.safety')}</GroupLabel>
              </li>
            )}
            {pageSafety.map((c) => (
              <ThreadRow
                key={c.id}
                conversation={c}
                selected={selectedId === c.id}
                onSelect={onSelect}
                members={members}
                userId={userId}
                checked={selectedRows.has(c.id)}
                onCheck={toggleRow}
                canDelete={canDeleteConversations}
                onDelete={setDeleteConversationId}
              />
            ))}
            {pageNormal.length > 0 && (
              <li>
                <GroupLabel>{t('conv.group.open')}</GroupLabel>
              </li>
            )}
            {pageNormal.map((c) => (
              <ThreadRow
                key={c.id}
                conversation={c}
                selected={selectedId === c.id}
                onSelect={onSelect}
                members={members}
                userId={userId}
                checked={selectedRows.has(c.id)}
                onCheck={toggleRow}
                onHide={hideRow}
                canDelete={canDeleteConversations}
                onDelete={setDeleteConversationId}
              />
            ))}
          </ul>
        )}
        </div>
        {/* Pager — the list is a fixed pane, so instead of scrolling it steps
            through height-fitted pages. Hidden while loading/erroring or when it
            all fits on one page. */}
        {!query.isLoading && !query.isError && orderedRows.length > 0 && pageCount > 1 && (
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[var(--crm-border-color)] px-3 py-2 text-xs">
            <button
              type="button"
              aria-label={t('conv.page.prev')}
              title={t('conv.page.prev')}
              disabled={currentPage === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="rounded-md border border-[var(--crm-border-color)] px-2 py-1 font-semibold text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] disabled:opacity-40"
            >
              ‹
            </button>
            <span className="font-semibold text-[var(--crm-text-muted)]">
              {currentPage + 1} / {pageCount}
            </span>
            <button
              type="button"
              aria-label={t('conv.page.next')}
              title={t('conv.page.next')}
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              className="rounded-md border border-[var(--crm-border-color)] px-2 py-1 font-semibold text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] disabled:opacity-40"
            >
              ›
            </button>
          </div>
        )}
      </div>
      <DeleteConversationDialog
        open={deleteConversationId !== null}
        conversationId={deleteConversationId ?? ''}
        onClose={() => setDeleteConversationId(null)}
        onDeleted={() => {
          setDeleteConversationId(null)
          setSelectedRows((current) => {
            if (!deleteConversationId || !current.has(deleteConversationId)) return current
            const next = new Set(current)
            next.delete(deleteConversationId)
            return next
          })
          qc.invalidateQueries({ queryKey: ['conversations'] })
        }}
      />
    </div>
  )
}

// Render the preview text for a row's last message. Media (voice/image) can't be
// shown inline in the list, so they get a glyph + label; text-bearing types show
// their content; a thread with no messages yet shows a muted placeholder.
function previewText(
  lastMessage: Conversation['lastMessage'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!lastMessage) return t('conv.preview.none')
  if (lastMessage.contentType === 'audio') return `🎤 ${t('conv.preview.voice')}`
  if (lastMessage.contentType === 'image') return `🖼 ${t('conv.preview.image')}`
  return lastMessage.content || t('conv.preview.none')
}

function GroupLabel({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div
      className={`px-4 pb-2 pt-4 text-[10.5px] font-extrabold uppercase tracking-wider ${
        danger ? 'text-red-600 dark:text-red-400' : 'text-gray-400'
      }`}
    >
      {children}
    </div>
  )
}

function ThreadRow({
  conversation: c,
  selected,
  onSelect,
  members,
  userId,
  checked,
  onCheck,
  onHide,
  canDelete,
  onDelete,
}: {
  conversation: Conversation
  selected: boolean
  onSelect: (id: string) => void
  members: ReturnType<typeof useTeam>
  userId: string | undefined
  checked: boolean
  onCheck: (id: string, checked: boolean) => void
  onHide?: (id: string) => void
  canDelete: boolean
  onDelete: (id: string) => void
}) {
  const { t } = useI18n()
  const safety = assessSafety(c.tags).level
  const row = safety ? SAFETY_ROW[safety] : null
  const mode = conversationMode(c.status)
  const ch = CHANNEL[c.channel]
  // Show the patient's real name when we have one; fall back to the raw channel
  // handle (phone / IGSID) for an unidentified contact — matches the design rows.
  const displayName = c.patientName || c.channelContactHandle
  const unread = c.lastMessage?.role === 'user'

  return (
    <li>
      <div
        className={`crm-conversation-item w-full min-w-0 text-left ${
          row ? `${row.rail} ${row.row}` : 'border-l-transparent'
        } ${selected ? 'crm-conversation-item-active' : ''} ${unread ? 'font-semibold' : ''}`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheck(c.id, event.target.checked)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${displayName}`}
          className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-teal-600 focus:ring-teal-500"
        />
        {onHide && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onHide(c.id)
            }}
            title={t('conv.hideRow')}
            aria-label={t('conv.hideRow')}
            className="mt-1 shrink-0 rounded p-0.5 text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
              <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
              <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
              <line x1="2" y1="2" x2="22" y2="22" />
            </svg>
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onDelete(c.id)
            }}
            title={t('view.delete')}
            aria-label={t('view.delete')}
            className="crm-conversation-delete-btn mt-1"
          >
            <span aria-hidden="true">−</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onSelect(c.id)}
          className="contents text-left"
        >
        {/* Avatar with a channel badge. */}
        <span className="relative shrink-0">
          <span className="crm-conv-avatar" style={{ background: avatarColor(c.id) }}>
            {avatarLabel(displayName)}
          </span>
          <span
            aria-hidden
            title={ch.label}
            className={`absolute -bottom-0.5 -right-0.5 grid h-[17px] w-[17px] place-items-center rounded-full border-2 border-white text-[9px] font-bold text-white dark:border-gray-900 ${ch.badge}`}
          >
            {ch.glyph}
          </span>
        </span>

        <span className="min-w-0 flex-1 pr-3">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex-1 truncate text-[14px] font-extrabold text-[var(--crm-text-main)]">{displayName}</span>
            <span className="shrink-0 text-[11px] text-[var(--crm-text-muted)]">{relativeTime(c.lastMessageAt)}</span>
          </span>

          {/* Last-message preview (Req 4) — audio/image render a labelled placeholder
              since the row can't show the media itself. */}
          <span className="mt-1 block truncate text-[13px] text-[var(--crm-text-muted)]">
            {previewText(c.lastMessage, t)}
          </span>

          <span className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {(() => {
              const wait = waitingMinutes(c.lastMessageAt, c.lastMessage?.role)
              if (wait === null) return null
              const level = slaLevel(wait)
              const cls =
                level === 'breach'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                  : level === 'warn'
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
              return (
                <span
                  title={t('conv.waiting')}
                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${cls}`}
                >
                  ⏱ {formatWaiting(wait)}
                </span>
              )
            })()}
            {row && (
              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${row.badge}`}>
                ⚠ {t(row.labelKey)}
              </span>
            )}
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                mode === 'human'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300'
              }`}
            >
              {mode === 'human' ? '●' : '✦'} {mode === 'human' ? t('view.mode.human') : t('view.mode.bot')}
            </span>
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE[c.status]}`}>
              {t(`conv.status.${c.status}` as const)}
            </span>
            {c.assignedTo === userId ? (
              <span className="text-[10px] font-medium text-teal-700 dark:text-teal-400">
                {t('conv.assignedToMe')}
              </span>
            ) : c.assignedTo ? (
              <span className="min-w-0 max-w-full truncate text-[10px] text-gray-500">
                {t('conv.assignedTo', {
                  name:
                    members.find((m) => m.id === c.assignedTo)?.fullName ??
                    members.find((m) => m.id === c.assignedTo)?.email ??
                    c.assignedTo,
                })}
              </span>
            ) : (
              <span className="text-[10px] text-gray-400">{t('conv.unassigned')}</span>
            )}
          </span>
        </span>
        {unread && <span className="crm-unread-badge" aria-hidden="true" />}
        </button>
      </div>
    </li>
  )
}

// Loading skeleton — mirrors the row shape (avatar + two lines) so the queue's
// silhouette is recognisable while it loads.
function ListSkeleton() {
  return (
    <div className="animate-pulse">
      {[60, 80, 70, 85, 55].map((w, i) => (
        <div key={i} className="flex gap-2.5 border-b border-gray-100 px-3 py-2.5 dark:border-gray-800">
          <div className="h-10 w-10 shrink-0 rounded-full bg-gray-200 dark:bg-gray-800" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-2.5 rounded bg-gray-200 dark:bg-gray-800" style={{ width: `${w}%` }} />
            <div className="h-2.5 w-2/5 rounded bg-gray-200 dark:bg-gray-800" />
          </div>
        </div>
      ))}
    </div>
  )
}

  // Operational classification tabs. Keep these rectangular/underlined so the
  // conversation section reads as tabs rather than action pills.
function LensTab({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex min-w-0 items-center gap-1 border-b-2 px-1.5 py-1 text-[9.2px] font-semibold transition ${
        active
          ? 'border-[var(--crm-primary-color)] text-[var(--crm-primary-color)]'
          : 'border-transparent text-[var(--crm-text-muted)] hover:border-[var(--crm-border-color)]'
      }`}
    >
      {label}
      <span
        className={`min-w-[0.9rem] rounded px-0.5 text-center text-[8px] font-bold tabular-nums ${
          active
            ? 'bg-[var(--crm-hover-bg)] text-[var(--crm-primary-color)]'
            : 'bg-[var(--crm-elevated-bg)] text-[var(--crm-text-muted)]'
        }`}
      >
        {count}
      </span>
    </button>
  )
}
