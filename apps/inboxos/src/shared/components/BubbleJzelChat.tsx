'use client'

// J.zel mode for the floating ChatBubble widget — ported from the retired
// DocmeePet mascot widget's chat logic (same /assist/chat endpoint, same
// quick-action chips, same session-persisted history under the same storage
// key so existing chat history isn't lost), restyled to the plain
// left/right message-bubble look shared with Messenger mode. No mascot
// avatar sprite.
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { ApiError, api } from '../api/client'
import type { PanelLanguage, PanelRole } from '../types'

type ChatMsg = { role: 'user' | 'assistant'; content: string }

type PersistedChat = {
  input?: string
  messages?: ChatMsg[]
}

const CHAT_STORAGE_PREFIX = 'jzel.chat.v1'

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
      input: typeof parsed.input === 'string' ? parsed.input.slice(0, 2000) : '',
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isChatMsg).slice(-40) : [],
    }
  } catch {
    return null
  }
}

function jzelErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.message === 'assistant_provider_not_configured') {
      return 'Docmee needs this clinic’s own AI provider key before it can answer. Add a clinic-specific provider key in Integrations or AI Assistant settings.'
    }
    if (error.message === 'assistant_provider_failed') {
      return 'Docmee reached the AI provider, but the provider rejected the request. Check the provider key, model, and account status.'
    }
    if (error.message === 'assistant_disabled') {
      return 'Docmee is disabled for this clinic. Enable it in AI Assistant settings.'
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

export function BubbleJzelChat() {
  const pathname = usePathname()
  const { t } = useI18n()
  type Key = Parameters<typeof t>[0]
  const user = useAuthStore((s) => s.user)
  const language = useAuthStore((s) => s.language) as PanelLanguage
  // #8 — J.zel history is scoped to the ACTIVE clinic, so an admin who switches
  // clinics gets a separate thread and never carries one clinic's context into
  // another. (/assist/chat is already clinic-scoped by the X-Clinic-Id header.)
  const { clinicId } = useActiveClinic()

  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [aiStatus, setAiStatus] = useState<'loading' | 'connected' | 'disconnected' | 'error'>(
    'loading',
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatLoadedFor = useRef<string | null>(null)

  const chips = chipsForRole(user?.role)
  const chatStorageKey =
    user && clinicId ? `${CHAT_STORAGE_PREFIX}:${user.id}:${clinicId}:${language}` : null

  // Keep the conversation while the user moves around the app — same session
  // storage key DocmeePet used, so history from before the merge carries over.
  useEffect(() => {
    if (!chatStorageKey) {
      chatLoadedFor.current = null
      setMessages([])
      setInput('')
      return
    }
    if (chatLoadedFor.current === chatStorageKey) return
    const saved = readPersistedChat(chatStorageKey)
    setMessages(saved?.messages ?? [])
    setInput(saved?.input ?? '')
    chatLoadedFor.current = chatStorageKey
  }, [chatStorageKey])

  useEffect(() => {
    if (!chatStorageKey || chatLoadedFor.current !== chatStorageKey) return
    try {
      sessionStorage.setItem(chatStorageKey, JSON.stringify({ input, messages: messages.slice(-40) }))
    } catch {
      /* ignore storage failures */
    }
  }, [chatStorageKey, input, messages])

  // AI-service connection status → colors the status dot in this mode's header.
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

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6">
        <p className="text-xs text-[var(--crm-text-muted)]">{t('pet.chat.loginHint')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="crm-bubble-header flex items-center gap-2 border-b border-[var(--crm-border-color)]">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--crm-text-main)]">
          {t('pet.name')}
        </span>
        <span
          role="status"
          aria-label={aiDotLabel}
          title={aiDotLabel}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${aiDotColor}`}
        />
      </div>

      <div ref={scrollRef} className="crm-bubble-messages flex-1 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-xs leading-5 text-[var(--crm-text-muted)]">{t('pet.chat.greeting')}</p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`text-[13px] crm-message ${m.role === 'user' ? 'crm-message-sent' : 'crm-ai-suggested'}`}
              >
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
              </div>
            </div>
          ))
        )}
        {pending && (
          <div className="flex justify-start">
            <div className="crm-message">
              <span className="jz-typing" aria-label={t('pet.chat.thinking')}>
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="crm-bubble-input-area flex flex-col gap-2 border-t border-[var(--crm-border-color)]">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((id) => (
            <button
              key={id}
              type="button"
              disabled={pending}
              onClick={() => send(t(`pet.chip.${id}.prompt` as Key))}
              className="rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-hover-bg)] px-2.5 py-1 text-[11px] font-medium text-[var(--crm-primary-color)] transition disabled:opacity-50"
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
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t('pet.chat.placeholder')}
            disabled={pending}
            className="min-w-0 flex-1 rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-3 py-1.5 text-xs outline-none focus:border-[var(--crm-primary-color)]"
          />
          <button
            type="submit"
            disabled={pending || input.trim() === ''}
            aria-label={t('pet.chat.send')}
            className="shrink-0 rounded-full bg-[var(--crm-primary-color)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          >
            {t('pet.chat.send')}
          </button>
        </form>
      </div>
    </div>
  )
}
