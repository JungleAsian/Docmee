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
import { ChatTeardropText, Pulse, Robot } from '@phosphor-icons/react'
import { ConversationList } from '@/shared/components/ConversationList'
import { ConversationView } from '@/shared/components/ConversationView'
import { StatCard, StatsRow } from '@/shared/components/CrmStats'
import { PatientCard } from '@/shared/components/PatientCard'
import { SafetyHandoffPanel } from '@/shared/components/SafetyHandoffPanel'
import { LifecyclePanel } from '@/shared/components/LifecyclePanel'
import { TagsPanel } from '@/shared/components/TagsPanel'
import { NotesPanel } from '@/shared/components/NotesPanel'
import { AssignPanel } from '@/shared/components/AssignPanel'
import { AssistantPanel } from '@/shared/components/AssistantPanel'
import { useI18n } from '@/shared/hooks/useI18n'
import { useAuthStore } from '@/shared/store/auth'
import { can } from '@/shared/permissions'
import { useOnline } from '@/shared/hooks/useOnline'

const INBOX_LAYOUT_KEY = 'docmee.inbox.layout.v1'
const LIST_DEFAULT = 320
const RIGHT_DEFAULT = 352
const LIST_MIN = 240
const LIST_MAX = 520
const RIGHT_MIN = 280
const RIGHT_MAX = 560
const MAIN_MIN = 420

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export default function InboxPage() {
  const { t } = useI18n()
  const online = useOnline()
  // CRE-24: only roles the API actually authorizes for assist see the panel.
  const role = useAuthStore((state) => state.user?.role)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [panelsOpen, setPanelsOpen] = useState(false)
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT)
  const [isMedium, setIsMedium] = useState(false)
  const [isLarge, setIsLarge] = useState(false)
  const [dragging, setDragging] = useState<'list' | 'right' | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)

  // Selecting (or clearing) a thread always closes the mobile detail drawer so the
  // small-screen flow stays predictable when switching conversations.
  const select = (id: string | null) => {
    setSelectedId(id)
    setPanelsOpen(false)
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

  // Key every conversation-scoped panel by the thread id so React remounts them
  // on switch — otherwise local state (the reply draft, AI summary/suggestions,
  // a half-typed note) bleeds into the next patient's thread and can be sent to
  // the wrong recipient.
  const panels = selectedId ? (
    <div className="crm-inbox-panel-stack">
      <PatientCard key={`patient-${selectedId}`} conversationId={selectedId} />
      <SafetyHandoffPanel key={`safety-${selectedId}`} conversationId={selectedId} />
      <AssignPanel key={`assign-${selectedId}`} conversationId={selectedId} />
      <LifecyclePanel key={`lifecycle-${selectedId}`} conversationId={selectedId} />
      <TagsPanel key={`tags-${selectedId}`} conversationId={selectedId} />
      {can(role, 'assistant') && (
        <AssistantPanel key={`assistant-${selectedId}`} conversationId={selectedId} />
      )}
      <NotesPanel key={`notes-${selectedId}`} conversationId={selectedId} />
    </div>
  ) : (
    <div className="m-4 clinic-empty-state text-sm">{t('view.empty')}</div>
  )

  return (
    <div className="flex h-full min-h-[680px] flex-col gap-4 overflow-hidden">
      <div className="shrink-0 rounded-[var(--crm-border-radius-md)] bg-[var(--crm-card-bg)] px-5 py-4 shadow-[var(--crm-shadow-card)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="clinic-eyebrow">Conversation workspace</p>
            <h1 className="clinic-title text-[var(--crm-text-main)]">Inbox</h1>
            <p className="clinic-subtitle">
              Triage patient conversations, handoffs, internal notes, tags, and AI assistance from a single clinic-safe view.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-500 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            {online ? 'Live' : t('conn.offline.title')}
          </div>
        </div>
      </div>
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

      <StatsRow>
        <StatCard
          title="Connection"
          value={online ? 'Live' : 'Offline'}
          trend={online ? 'Messages are syncing' : t('conn.offline.title')}
          trendTone={online ? 'positive' : 'negative'}
          tone="blue"
          icon={<Pulse size={26} weight="duotone" />}
        />
        <StatCard
          title="Active Thread"
          value={selectedId ? 'Open' : 'None'}
          trend={selectedId ? 'Conversation selected' : t('view.empty')}
          tone="purple"
          icon={<ChatTeardropText size={26} weight="duotone" />}
        />
        <StatCard
          title="J.zel Assist"
          value={can(role, 'assistant') ? 'Ready' : 'Hidden'}
          trend={can(role, 'assistant') ? 'AI suggestions available' : 'Role access limited'}
          tone="orange"
          icon={<Robot size={26} weight="duotone" />}
        />
      </StatsRow>

      <div className="docmee-inbox-reskin flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={workspaceRef}
        className="crm-inbox-container grid grid-cols-1 md:grid-cols-[18rem_minmax(0,1fr)] lg:grid-cols-[18rem_minmax(0,1fr)_18rem]"
        style={
          isLarge
            ? { gridTemplateColumns: `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr) 6px ${rightWidth}px` }
            : isMedium
              ? { gridTemplateColumns: `${listWidth}px 6px minmax(${MAIN_MIN}px,1fr)` }
              : undefined
        }
      >
      {/* Conversation list — full width on mobile until a thread is opened. */}
      <div
        className={`${selectedId ? 'hidden md:block' : 'block'} crm-inbox-list overflow-hidden`}
      >
        <ConversationList selectedId={selectedId} onSelect={select} />
      </div>

      <ResizeHandle
        className="hidden md:block"
        label="Resize conversation list"
        onPointerDown={() => setDragging('list')}
      />

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
              <ConversationView key={selectedId} conversationId={selectedId} onConversationChange={select} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="clinic-empty-state text-sm">{t('view.empty')}</div>
          </div>
        )}
      </div>

      <ResizeHandle
        className="hidden lg:block"
        label="Resize WhatsApp panel"
        onPointerDown={() => setDragging('right')}
      />

      {/* Contextual panels — static third column on desktop. */}
      <div className="crm-inbox-details hidden overflow-y-auto lg:block">
        {panels}
      </div>
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
