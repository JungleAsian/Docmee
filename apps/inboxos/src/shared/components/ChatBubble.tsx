'use client'

// Floating chat bubble — mounted at the root layout so it's available on every
// authenticated page (replaces the retired DocmeePet mascot widget). A fixed
// bottom-right launcher opens a compact panel with two modes: Messenger (real
// Inbox conversations) and J.zel (the AI assistant, ported from DocmeePet).
// Non-draggable, non-blocking (no backdrop) — Escape or an outside click closes it.
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { ChatCircleDots, X } from '@phosphor-icons/react'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { api } from '../api/client'
import { BubbleConversationList } from './BubbleConversationList'
import { BubbleThread } from './BubbleThread'
import { BubbleJzelChat } from './BubbleJzelChat'
import type { Conversation, PanelLanguage } from '../types'

type Mode = 'messenger' | 'jzel'
type PersistedUi = { open?: boolean; mode?: Mode }

const UI_STORAGE_PREFIX = 'docmee.chatbubble.v1'

function readPersistedUi(key: string): PersistedUi | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedUi
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : false,
      mode: parsed.mode === 'jzel' ? 'jzel' : 'messenger',
    }
  } catch {
    return null
  }
}

export function ChatBubble() {
  const pathname = usePathname()
  const { t } = useI18n()
  const user = useAuthStore((s) => s.user)
  const language = useAuthStore((s) => s.language) as PanelLanguage

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('messenger')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const uiLoadedFor = useRef<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)

  const uiStorageKey = user ? `${UI_STORAGE_PREFIX}:${user.id}:${user.clinicId}:${language}` : null

  useEffect(() => {
    if (!uiStorageKey) {
      uiLoadedFor.current = null
      setOpen(false)
      setMode('messenger')
      return
    }
    if (uiLoadedFor.current === uiStorageKey) return
    const saved = readPersistedUi(uiStorageKey)
    setOpen(saved?.open ?? false)
    setMode(saved?.mode ?? 'messenger')
    uiLoadedFor.current = uiStorageKey
  }, [uiStorageKey])

  useEffect(() => {
    if (!uiStorageKey || uiLoadedFor.current !== uiStorageKey) return
    try {
      sessionStorage.setItem(uiStorageKey, JSON.stringify({ open, mode }))
    } catch {
      /* ignore storage failures */
    }
  }, [uiStorageKey, open, mode])

  // Unread badge — same query key BubbleConversationList uses internally, so
  // opening the panel in Messenger mode dedupes onto this same cached fetch
  // rather than firing a second request.
  const unreadQuery = useQuery({
    queryKey: ['conversations', 'all', user?.id, ''],
    enabled: Boolean(user),
    refetchInterval: 10_000,
    queryFn: () => api.get<{ conversations: Conversation[] }>('/conversations?limit=75'),
  })
  const unreadCount = (unreadQuery.data?.conversations ?? []).filter(
    (c) => c.lastMessage?.role === 'user',
  ).length

  // Non-blocking close: Escape, or a click outside both the panel and launcher.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (panelRef.current?.contains(target)) return
      if (launcherRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [open])

  if (pathname === '/login' || !user) return null

  return (
    <div className="docmee-inbox-reskin">
      {open && (
        <div
          ref={panelRef}
          className="crm-bubble-panel pointer-events-auto fixed bottom-24 right-4 z-40 flex h-[520px] max-h-[calc(100vh-112px)] w-[360px] max-w-[calc(100vw-32px)] flex-col overflow-hidden"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--crm-border-color)] px-3 py-2">
            <div className="crm-bubble-mode-switch">
              <button
                type="button"
                onClick={() => setMode('messenger')}
                aria-pressed={mode === 'messenger'}
                className={mode === 'messenger' ? 'is-active' : ''}
              >
                {t('bubble.mode.messenger')}
              </button>
              <button
                type="button"
                onClick={() => setMode('jzel')}
                aria-pressed={mode === 'jzel'}
                className={mode === 'jzel' ? 'is-active' : ''}
              >
                {t('bubble.mode.jzel')}
              </button>
            </div>
            <button
              type="button"
              aria-label={t('bubble.close')}
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-md p-1 text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)]"
            >
              <X size={16} weight="bold" />
            </button>
          </div>

          <div className="min-h-0 flex-1">
            {mode === 'messenger' ? (
              selectedId ? (
                <BubbleThread conversationId={selectedId} onBack={() => setSelectedId(null)} />
              ) : (
                <BubbleConversationList onSelect={setSelectedId} />
              )
            ) : (
              <BubbleJzelChat />
            )}
          </div>
        </div>
      )}

      <button
        ref={launcherRef}
        type="button"
        aria-expanded={open}
        aria-label={open ? t('bubble.close') : t('bubble.open')}
        onClick={() => setOpen((v) => !v)}
        className="pointer-events-auto fixed bottom-4 right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--crm-primary-color)] text-white shadow-[var(--crm-shadow-card)] transition hover:bg-[var(--crm-primary-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--crm-primary-color)] focus-visible:ring-offset-2"
      >
        <ChatCircleDots size={26} weight="fill" />
        {!open && unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-[var(--crm-notification)] px-1 text-[10px] font-bold text-white ring-2 ring-[var(--crm-bg-color)]">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </div>
  )
}
