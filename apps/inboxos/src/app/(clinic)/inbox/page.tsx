'use client'

// Clinic Inbox — the 3-column workspace: conversation list (left), the active
// conversation (center), and the contextual panels (right): tags, internal notes
// and assignment.
//
// Req 39 (mobile): on a phone the three columns can't coexist, so the layout
// collapses to one column — the conversation list fills the screen until a thread
// is opened, then the conversation takes over (with a Back affordance) and the
// contextual panels move behind a Details slide-over. From md up it stays the
// classic three-pane desktop grid. Tablet widths use list + conversation with details in a drawer.
import { useEffect, useRef, useState } from 'react'
import { ConversationList } from '@/shared/components/ConversationList'
import { ConversationView } from '@/shared/components/ConversationView'
import { InboxContextRail } from '@/shared/components/InboxContextRail'
import { useI18n } from '@/shared/hooks/useI18n'
import { useOnline } from '@/shared/hooks/useOnline'
import { useUserUiPreferences } from '@/shared/hooks/useUserUiPreferences'

// v3 — bumped so the light InboxOS workspace proportions take effect for
// everyone instead of preserving older dark-admin-shell column widths.
const INBOX_LAYOUT_KEY = 'docmee.inbox.layout.v3'
const LIST_DEFAULT = 346
const RIGHT_DEFAULT = 376
const LIST_MIN = 320
const LIST_MAX = 560
const RIGHT_MIN = 320
const RIGHT_MAX = 560
const MAIN_MIN = 560

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function InboxPage() {
  const { t } = useI18n()
  const online = useOnline()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelsOpen, setPanelsOpen] = useState(false)
  const [detailsHidden, setDetailsHidden] = useState(false)
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)
  const [isMedium, setIsMedium] = useState(false)
  const [isLarge, setIsLarge] = useState(false)
  const [dragging, setDragging] = useState<'list' | 'right' | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const { preferences, setPreferences } = useUserUiPreferences()
  const listExpanded = preferences.conversationListExpanded

  // Selecting (or clearing) a thread always closes the mobile detail drawer so the
  // small-screen flow stays predictable when switching conversations.
  const select = (id: string | null) => {
    setSelectedId(id)
    setPanelsOpen(false)
    setDetailsHidden(false)
  }

  // Deep-link from the Alerts center (Screen 11): /inbox?c=<conversationId> opens
  // that thread on load. Read once from the URL on mount (no useSearchParams, so the
  // route stays statically prerenderable and needs no Suspense boundary).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('c')
    if (c) setSelectedId(c)
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INBOX_LAYOUT_KEY)
      if (!raw) return
      const layout = JSON.parse(raw) as Partial<{ listWidth: number; rightWidth: number }>
      if (typeof layout.listWidth === 'number') setListWidth(clamp(layout.listWidth, LIST_MIN, LIST_MAX))
      if (typeof layout.rightWidth === 'number') setRightWidth(clamp(layout.rightWidth, RIGHT_MIN, RIGHT_MAX))
    } catch {
      /* ignore invalid saved layout */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(INBOX_LAYOUT_KEY, JSON.stringify({ listWidth, rightWidth }))
    } catch {
      /* ignore storage failures */
    }
  }, [listWidth, rightWidth])

  useEffect(() => {
    const md = window.matchMedia('(min-width: 768px)')
    const lg = window.matchMedia('(min-width: 1024px)')
    const sync = () => {
      setIsMedium(md.matches)
      setIsLarge(lg.matches)
    }
    sync()
    md.addEventListener('change', sync)
    lg.addEventListener('change', sync)
    return () => {
      md.removeEventListener('change', sync)
      lg.removeEventListener('change', sync)
    }
  }, [])

  useEffect(() => {
    if (!dragging) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onPointerMove(event: PointerEvent) {
      const rect = workspaceRef.current?.getBoundingClientRect()
      if (!rect) return
      if (dragging === 'list') {
        const available = rect.width - (isLarge ? rightWidth : 0) - MAIN_MIN
        setListWidth(clamp(event.clientX - rect.left, LIST_MIN, Math.max(LIST_MIN, Math.min(LIST_MAX, available))))
      } else {
        const available = rect.width - listWidth - MAIN_MIN
        setRightWidth(clamp(rect.right - event.clientX, RIGHT_MIN, Math.max(RIGHT_MIN, Math.min(RIGHT_MAX, available))))
      }
    }

    function onPointerUp() {
      setDragging(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [dragging, isLarge, listWidth, rightWidth])

  useEffect(() => {
    const collapse = () => setPreferences({ conversationListExpanded: false })
    window.addEventListener('docmee:collapse-conversation-list', collapse)
    return () => window.removeEventListener('docmee:collapse-conversation-list', collapse)
  }, [setPreferences])

  // Key every conversation-scoped panel by the thread id so React remounts them
  // on switch — otherwise local state (the reply draft, AI summary/suggestions,
  // a half-typed note) bleeds into the next patient's thread and can be sent to
  // the wrong recipient.
  const panels = selectedId ? (
    <InboxContextRail
      key={`rail-${selectedId}`}
      conversationId={selectedId}
      onHideDetails={() => setDetailsHidden(true)}
    />
  ) : null

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Offline / disconnected banner — a required operational state: when the
          browser loses its network, a reply can't reach the patient, so make it
          unmistakable across the whole inbox (drafts stay in local component state). */}
      {!online && (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <span aria-hidden className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span className="font-semibold">{t('conn.offline.title')}</span>
          <span className="hidden min-w-0 truncate opacity-90 sm:inline">— {t('conn.offline.body')}</span>
        </div>
      )}

      <div className="docmee-inbox-reskin flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={workspaceRef}
        className="crm-inbox-container grid grid-cols-1 md:grid-cols-[24rem_minmax(0,1fr)] lg:grid-cols-[24rem_minmax(0,1fr)_18rem]"
        style={
          isLarge
            ? selectedId
              ? detailsHidden
                ? { gridTemplateColumns: listExpanded ? `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr)` : `44px minmax(${MAIN_MIN}px,1fr)` }
                : { gridTemplateColumns: listExpanded ? `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr) 6px ${rightWidth}px` : `44px minmax(${MAIN_MIN}px,1fr) 6px ${rightWidth}px` }
              : { gridTemplateColumns: listExpanded ? `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr)` : `44px minmax(${MAIN_MIN}px,1fr)` }
            : isMedium
              ? { gridTemplateColumns: listExpanded ? `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr)` : `44px minmax(${MAIN_MIN}px,1fr)` }
              : undefined
        }
      >
      {/* Conversation list — full width on mobile until a thread is opened. */}
      <div className={`${selectedId ? 'hidden md:block' : 'block'} crm-inbox-list overflow-hidden`}>
        {listExpanded || !isMedium ? (
          <ConversationList
            selectedId={selectedId}
            onSelect={select}
            onOpenMediaRepository={() => window.dispatchEvent(new CustomEvent('docmee:open-media-repository'))}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPreferences({ conversationListExpanded: true })}
            className="flex h-full w-full items-start justify-center pt-4 text-lg text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)]"
            aria-label="Reopen conversation list"
            title="Reopen conversation list"
          >
            ☰
          </button>
        )}
      </div>

      {listExpanded && (
        <ResizeHandle
          className="hidden md:block"
          label="Resize conversation list"
          onPointerDown={() => setDragging('list')}
        />
      )}

      {/* Active conversation — takes over the screen on mobile once a thread is open. */}
      <div
        className={`${selectedId ? 'flex' : 'hidden md:flex'} crm-inbox-chat`}
      >
        {selectedId ? (
          <>
            {/* Mobile-only action bar: back to the list + open the detail panel. */}
            <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 lg:hidden dark:border-gray-800">
              <button
                type="button"
                onClick={() => select(null)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 md:hidden dark:border-gray-700 dark:text-gray-300"
              >
                ← {t('inbox.backToList')}
              </button>
              <button
                type="button"
                onClick={() => setPanelsOpen(true)}
                className="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300"
              >
                {t('inbox.details')}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <ConversationView
                key={selectedId}
                conversationId={selectedId}
                detailsHidden={detailsHidden}
                onToggleDetails={() => setDetailsHidden((value) => !value)}
              />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="clinic-empty-state text-sm">{t('view.empty')}</div>
          </div>
        )}
      </div>

      {selectedId && !detailsHidden && (
        <ResizeHandle
          className="hidden lg:block"
          label="Resize WhatsApp panel"
          onPointerDown={() => setDragging('right')}
        />
      )}

      {/* Contextual panels — static third column on desktop. */}
      {selectedId && !detailsHidden && (
        <div className="crm-inbox-details crm-inbox-side-scroll hidden min-h-0 overflow-y-auto overscroll-contain lg:block">
          {panels}
        </div>
      )}
      </div>

      {/* …and the same panels as a right-hand slide-over drawer on mobile. */}
      {panelsOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <button
            type="button"
            aria-label={t('common.closeMenu')}
            onClick={() => setPanelsOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative z-10 ml-auto h-full w-80 max-w-[85%] overflow-y-auto border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {panels}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

function ResizeHandle({
  className,
  label,
  onPointerDown,
}: {
  className: string
  label: string
  onPointerDown: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => {
        event.preventDefault()
        onPointerDown()
      }}
      className={`${className} group relative cursor-col-resize bg-[var(--crm-elevated-bg)] transition hover:bg-[var(--crm-hover-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--crm-primary-color)]`}
    >
      <span className="absolute left-1/2 top-1/2 h-10 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--crm-border-color)] transition group-hover:bg-[var(--crm-primary-color)]" />
    </button>
  )
}
