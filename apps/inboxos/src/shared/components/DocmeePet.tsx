'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useI18n } from '@/shared/hooks/useI18n'
import { useAuthStore } from '@/shared/store/auth'
import { ApiError, api } from '@/shared/api/client'
import { JzelAvatar } from '@/shared/components/JzelAvatar'
import type { PanelLanguage, PanelRole } from '@/shared/types'

type ChatMsg = { role: 'user' | 'assistant'; content: string }

type PersistedChat = {
  open?: boolean
  input?: string
  messages?: ChatMsg[]
}

function jzelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.message === 'assistant_provider_not_configured') {
      return 'J.zel needs this clinic’s own AI provider key before it can answer. Add a clinic-specific provider key in Integrations or AI Assistant settings.'
    }
    if (error.message === 'assistant_provider_failed') {
      return 'J.zel reached the AI provider, but the provider rejected the request. Check the provider key, model, and account status.'
    }
    if (error.message === 'assistant_disabled') {
      return 'J.zel is disabled for this clinic. Enable it in AI Assistant settings.'
    }
  }
  return fallback
}

// Quick-action chips chosen automatically from the logged-in user's role:
// Triage / Schedule / Messages for clinic staff; Ops for admins.
function chipsForRole(role: PanelRole | undefined): readonly string[] {
  if (role === 'clinic_admin' || role === 'ia_studio_admin') return ['ops']
  return ['triage', 'schedule', 'messages']
}

// ── Drag / resize layout (persisted so J.zel stays where the user put it) ──────────
const STORAGE_KEY = 'jzel.layout.v1'
const CHAT_STORAGE_PREFIX = 'jzel.chat.v1'
const MARGIN = 12
const GAP = 8
const D_DEF = 128
const D_MIN = 72
const D_MAX = 168
const PW_DEF = 320
const PH_DEF = 448
const PW_MIN = 260
const PW_MAX = 560
const PH_MIN = 320
const PH_MAX = 720

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

type Pos = { x: number; y: number }

function isChatMsg(value: unknown): value is ChatMsg {
  if (!value || typeof value !== 'object') return false
  const msg = value as Partial<ChatMsg>
  return (
    (msg.role === 'user' || msg.role === 'assistant') &&
    typeof msg.content === 'string' &&
    msg.content.length <= 12000
  )
}

function readPersistedChat(key: string): PersistedChat | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedChat
    return {
      open: typeof parsed.open === 'boolean' ? parsed.open : false,
      input: typeof parsed.input === 'string' ? parsed.input.slice(0, 2000) : '',
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isChatMsg).slice(-40) : [],
    }
  } catch {
    return null
  }
}

export function DocmeePet() {
  const pathname = usePathname()
  const { t } = useI18n()
  type Key = Parameters<typeof t>[0]
  const user = useAuthStore((s) => s.user)
  const language = useAuthStore((s) => s.language) as PanelLanguage

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [aiStatus, setAiStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>(
    'loading',
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const chatLoadedFor = useRef<string | null>(null)

  // Layout: button position (null = default bottom-right), button diameter, panel size.
  const [pos, setPos] = useState<Pos | null>(null)
  const [d, setD] = useState(D_DEF)
  const [panel, setPanel] = useState({ w: PW_DEF, h: PH_DEF })
  const loaded = useRef(false)

  const chips = chipsForRole(user?.role)
  const avatarState = pending ? 'thinking' : 'idle'
  const chatStorageKey = user
    ? `${CHAT_STORAGE_PREFIX}:${user.id}:${user.clinicId}:${language}`
    : null

  // Keep the conversation while the user moves around the app. Session storage
  // survives route changes and refreshes, but clears naturally when the browser
  // session ends.
  useEffect(() => {
    if (!chatStorageKey) {
      chatLoadedFor.current = null
      setOpen(false)
      setMessages([])
      setInput('')
      return
    }
    if (chatLoadedFor.current === chatStorageKey) return
    const saved = readPersistedChat(chatStorageKey)
    setOpen(saved?.open ?? false)
    setMessages(saved?.messages ?? [])
    setInput(saved?.input ?? '')
    chatLoadedFor.current = chatStorageKey
  }, [chatStorageKey])

  useEffect(() => {
    if (!chatStorageKey || chatLoadedFor.current !== chatStorageKey) return
    try {
      sessionStorage.setItem(
        chatStorageKey,
        JSON.stringify({ open, input, messages: messages.slice(-40) }),
      )
    } catch {
      /* ignore storage failures */
    }
  }, [chatStorageKey, open, input, messages])

  // AI-service connection status → colors the floating-avatar status dot.
  // green = connected · red = not connected · orange = error.
  useEffect(() => {
    if (!user) {
      setAiStatus('loading')
      return
    }
    let cancelled = false
    const check = async () => {
      try {
        const res = await api.get<{ status?: string }>('/assist/health')
        if (cancelled) return
        setAiStatus(
          res.status === 'connected' || res.status === 'disconnected' || res.status === 'error'
            ? res.status
            : 'loading',
        )
      } catch {
        // API/auth/network failure is not an AI-service error — keep the dot neutral.
        if (!cancelled) setAiStatus('loading')
      }
    }
    void check()
    const id = setInterval(check, 300_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [user])

  const aiDotColor =
    aiStatus === 'connected'
      ? 'bg-emerald-500'
      : aiStatus === 'error'
        ? 'bg-amber-500'
        : aiStatus === 'disconnected'
          ? 'bg-rose-500'
          : 'bg-gray-400'
  const aiDotLabel = (
    language === 'es'
      ? {
          connected: 'Servicio de IA conectado',
          disconnected: 'Sin servicio de IA conectado',
          error: 'Error del servicio de IA',
          loading: 'Comprobando el servicio de IA...',
        }
      : {
          connected: 'AI service connected',
          disconnected: 'No AI service connected',
          error: 'AI service error',
          loading: 'Checking AI service...',
        }
  )[aiStatus]

  // Load persisted layout once on mount (client only — avoids SSR/hydration drift).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const j = JSON.parse(raw) as Partial<{ x: number; y: number; d: number; pw: number; ph: number }>
        if (typeof j.d === 'number') setD(clamp(j.d, D_MIN, D_MAX))
        if (typeof j.pw === 'number' && typeof j.ph === 'number')
          setPanel({ w: clamp(j.pw, PW_MIN, PW_MAX), h: clamp(j.ph, PH_MIN, PH_MAX) })
        if (typeof j.x === 'number' && typeof j.y === 'number') {
          const dd = typeof j.d === 'number' ? clamp(j.d, D_MIN, D_MAX) : D_DEF
          setPos({
            x: clamp(j.x, 0, window.innerWidth - dd),
            y: clamp(j.y, 0, window.innerHeight - dd),
          })
        }
      }
    } catch {
      /* ignore corrupt layout */
    }
    loaded.current = true
  }, [])

  // Persist on any layout change (after the initial load).
  useEffect(() => {
    if (!loaded.current) return
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x: pos?.x ?? null, y: pos?.y ?? null, d, pw: panel.w, ph: panel.h }),
      )
    } catch {
      /* ignore */
    }
  }, [pos, d, panel])

  // Keep J.zel on-screen when the window resizes.
  useEffect(() => {
    function onResize() {
      setPos((p) =>
        p ? { x: clamp(p.x, 0, window.innerWidth - d), y: clamp(p.y, 0, window.innerHeight - d) } : p,
      )
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [d])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, pending])

  async function send(text: string) {
    const msg = text.trim()
    if (msg === '' || pending) return
    setInput('')
    const history = messages.slice(-8)
    setMessages((m) => [...m, { role: 'user', content: msg }])
    setPending(true)
    try {
      const res = await api.post<{ reply: string; name?: string }>('/assist/chat', {
        message: msg,
        history,
        route: pathname,
      })
      setMessages((m) => [...m, { role: 'assistant', content: res.reply || t('pet.chat.empty') }])
    } catch (error) {
      setMessages((m) => [
        ...m,
        { role: 'assistant', content: jzelErrorMessage(error, t('pet.chat.error')) },
      ])
    } finally {
      setPending(false)
    }
  }

  // ── Drag (move the whole widget) ──
  const drag = useRef<{ px: number; py: number; left: number; top: number; moved: boolean } | null>(null)
  function startMove(e: React.PointerEvent) {
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    drag.current = { px: e.clientX, py: e.clientY, left: r.left, top: r.top, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onMove(e: React.PointerEvent) {
    const s = drag.current
    if (!s) return
    const dx = e.clientX - s.px
    const dy = e.clientY - s.py
    if (!s.moved && Math.hypot(dx, dy) < 4) return
    s.moved = true
    setPos({
      x: clamp(s.left + dx, 0, window.innerWidth - d),
      y: clamp(s.top + dy, 0, window.innerHeight - d),
    })
  }
  function endMove(toggle: boolean) {
    const s = drag.current
    drag.current = null
    if (s && !s.moved && toggle) setOpen((o) => !o)
  }

  // ── Resize the button (diameter), anchored top-left ──
  const rzB = useRef<{ px: number; py: number; d: number } | null>(null)
  function startResizeBtn(e: React.PointerEvent) {
    e.stopPropagation()
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ x: r.left, y: r.top })
    rzB.current = { px: e.clientX, py: e.clientY, d }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function moveResizeBtn(e: React.PointerEvent) {
    const s = rzB.current
    if (!s) return
    const grow = Math.max(e.clientX - s.px, e.clientY - s.py)
    setD(clamp(s.d + grow, D_MIN, D_MAX))
  }

  // ── Resize the chat panel (top-left handle; panel is anchored to the button) ──
  const rzP = useRef<{ px: number; py: number; w: number; h: number } | null>(null)
  function startResizePanel(e: React.PointerEvent) {
    e.stopPropagation()
    rzP.current = { px: e.clientX, py: e.clientY, w: panel.w, h: panel.h }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function moveResizePanel(e: React.PointerEvent) {
    const s = rzP.current
    if (!s) return
    setPanel({
      w: clamp(s.w + (s.px - e.clientX), PW_MIN, PW_MAX),
      h: clamp(s.h + (s.py - e.clientY), PH_MIN, PH_MAX),
    })
  }

  // Button box (numeric). Default = bottom-right; uses window (client-only callers).
  function buttonBox() {
    if (pos) return { left: pos.x, top: pos.y }
    return { left: window.innerWidth - MARGIN - d, top: window.innerHeight - MARGIN - d }
  }

  // Panel anchored to the button's top-right, opening up-left, clamped on-screen.
  function panelStyle(): React.CSSProperties {
    const b = buttonBox()
    const left = clamp(b.left + d - panel.w, MARGIN, window.innerWidth - panel.w - MARGIN)
    const top = clamp(b.top - GAP - panel.h, MARGIN, window.innerHeight - panel.h - MARGIN)
    return { left, top, width: panel.w, height: panel.h }
  }

  const containerStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y }
    : { right: MARGIN, bottom: MARGIN }
  const dotInset = Math.round(d * 0.06)

  if (pathname === '/login' || user?.jzelEnabled === false) return null

  return (
    <>
      {/* Chat panel — a fixed element anchored to the button, draggable + resizable */}
      {open && (
        <div
          style={panelStyle()}
          className="pointer-events-auto fixed z-40 flex select-none flex-col overflow-hidden rounded-xl border border-teal-100 bg-white shadow-xl shadow-teal-950/10 dark:border-teal-900/60 dark:bg-gray-950 dark:shadow-black/30"
        >
          {/* Resize handle (top-left) */}
          <span
            onPointerDown={startResizePanel}
            onPointerMove={moveResizePanel}
            onPointerUp={() => (rzP.current = null)}
            title={t('pet.resize')}
            style={{ touchAction: 'none' }}
            className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize"
          >
            <span className="absolute left-1 top-1 h-2 w-2 rounded-tl border-l-2 border-t-2 border-gray-400" />
          </span>

          {/* Header — drag to move the whole widget */}
          <div
            onPointerDown={startMove}
            onPointerMove={onMove}
            onPointerUp={() => endMove(false)}
            style={{ touchAction: 'none' }}
            className="flex cursor-grab items-center gap-2.5 border-b border-gray-100 px-3 py-2.5 active:cursor-grabbing dark:border-gray-800"
          >
            <span className="jz-icon flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-teal-100 dark:ring-teal-900">
              <JzelAvatar state={pending ? 'thinking' : 'happy'} size={44} showBubble={false} idleAfterMs={0} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-950 dark:text-gray-50">{t('pet.name')}</p>
              <p className="truncate text-[11px] text-gray-500">{t('pet.dragHint')}</p>
            </div>
            <button
              type="button"
              aria-label={t('pet.close')}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setOpen(false)}
              className="rounded-md px-1.5 py-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"
            >
              ✕
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
            {!user ? (
              <p className="mt-6 text-center text-xs text-gray-400">{t('pet.chat.loginHint')}</p>
            ) : messages.length === 0 ? (
              <p className="mt-1 text-xs leading-5 text-gray-500">{t('pet.chat.greeting')}</p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-5 ${
                      m.role === 'user'
                        ? 'rounded-br-sm bg-teal-600 text-white'
                        : 'rounded-bl-sm bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {pending && (
              <div className="flex justify-start">
                <div className="rounded-lg rounded-bl-sm bg-gray-100 px-2.5 py-2 dark:bg-gray-800">
                  <span className="jz-typing" aria-label={t('pet.chat.thinking')}>
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Quick-action chips + input — only for signed-in users */}
          {user && (
            <div className="border-t border-gray-100 px-2.5 py-2 dark:border-gray-800">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {chips.map((id) => (
                  <button
                    key={id}
                    type="button"
                    disabled={pending}
                    onClick={() => send(t(`pet.chip.${id}.prompt` as Key))}
                    className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-medium text-teal-800 transition hover:bg-teal-100 disabled:opacity-50 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200 dark:hover:bg-teal-900"
                  >
                    {t(`pet.chip.${id}` as Key)}
                  </button>
                ))}
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  send(input)
                }}
                className="flex items-center gap-1.5"
              >
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={t('pet.chat.placeholder')}
                  disabled={pending}
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-700 dark:bg-gray-900"
                />
                <button
                  type="submit"
                  disabled={pending || input.trim() === ''}
                  aria-label={t('pet.chat.send')}
                  className="shrink-0 rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-teal-700 disabled:opacity-50"
                >
                  ↑
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Floating button — draggable (move), clickable (toggle), resizable (diameter) */}
      <div className="pointer-events-none fixed z-30 select-none" style={containerStyle}>
        {!open && (
          <div className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 dark:bg-gray-950/95 dark:text-gray-200 dark:ring-gray-800">
            {t('pet.nudge')}
          </div>
        )}

        <button
          ref={btnRef}
          type="button"
          aria-expanded={open}
          aria-label={open ? t('pet.close') : t('pet.open')}
          onPointerDown={startMove}
          onPointerMove={onMove}
          onPointerUp={() => endMove(true)}
          style={{ height: d, width: d, touchAction: 'none' }}
          className="pointer-events-auto relative flex cursor-grab items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 active:cursor-grabbing dark:focus-visible:ring-offset-gray-950"
        >
          {/* J.zel pixel pet on a transparent backdrop — no frame, like the original.
             jz-icon centers the sprite in the button; it floats + sways + blinks. */}
          <span className="jz-icon pointer-events-none absolute inset-0 flex items-center justify-center">
            <JzelAvatar state={avatarState} size={d} showBubble={false} />
          </span>
          <span
            role="status"
            aria-label={aiDotLabel}
            title={aiDotLabel}
            className={`absolute z-10 h-3 w-3 rounded-full ${aiDotColor} ring-2 ring-white dark:ring-gray-950`}
            style={{ right: dotInset, top: dotInset }}
          />
          {/* Resize grip (bottom-right) */}
          <span
            onPointerDown={startResizeBtn}
            onPointerMove={moveResizeBtn}
            onPointerUp={() => (rzB.current = null)}
            title={t('pet.resize')}
            style={{ touchAction: 'none', right: dotInset, bottom: dotInset }}
            className="absolute z-10 flex h-4 w-4 cursor-nwse-resize items-center justify-center rounded-full bg-white/90 text-[9px] text-gray-500 shadow ring-1 ring-gray-200 dark:bg-gray-900/90 dark:text-gray-300 dark:ring-gray-700"
          >
            ⤡
          </span>
        </button>
      </div>
    </>
  )
}
