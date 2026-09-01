'use client'

// Compact Messenger-mode thread + text-only composer for the floating
// ChatBubble widget. Shares the exact ['conversation', id] / ['messages', id]
// query keys with the full ConversationView.tsx, and the same send mutation
// shape, so a thread open in both places stays in sync via the shared
// TanStack Query cache. Anything the compact view can't do (templates,
// media, tags, notes, AI assistant, safety handoff) is one tap away via
// "View full conversation".
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { avatarColor, avatarLabel, formatTime } from '../format'
import { DeleteConversationDialog } from './DeleteConversationDialog'
import type { Conversation, ConversationStatus, Message } from '../types'

function isClosedStatus(status: ConversationStatus | undefined): boolean {
  return status === 'resolved' || status === 'archived'
}

export function BubbleThread({
  conversationId,
  onBack,
}: {
  conversationId: string
  onBack: () => void
}) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const role = useAuthStore((s) => s.user?.role)
  const canDelete = role === 'clinic_admin' || role === 'ia_studio_admin'
  const [draft, setDraft] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const messagesQuery = useQuery({
    queryKey: ['messages', conversationId],
    refetchInterval: 10_000,
    queryFn: () => api.get<{ messages: Message[] }>(`/conversations/${conversationId}/messages`),
  })

  const conversation = conversationQuery.data?.conversation
  const messages = messagesQuery.data?.messages ?? []
  const closed = isClosedStatus(conversation?.status)
  const displayName = conversation?.patientName || conversation?.channelContactHandle || '…'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  const sendMutation = useMutation({
    mutationFn: (content: string) => api.post(`/conversations/${conversationId}/messages`, { content }),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const archiveMutation = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/status`, { status: 'archived' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  function onSend(e: FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (content) sendMutation.mutate(content)
  }

  if (
    conversationQuery.error instanceof ApiError &&
    (conversationQuery.error.status === 403 || conversationQuery.error.status === 404)
  ) {
    return (
      <div className="flex h-full flex-col gap-2 p-4">
        <button
          type="button"
          onClick={onBack}
          className="self-start text-xs font-semibold text-[var(--crm-primary-color)]"
        >
          ← {t('bubble.back')}
        </button>
        <p className="text-sm font-semibold text-[var(--crm-text-main)]">{t('common.error')}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="crm-bubble-header flex items-center gap-2 border-b border-[var(--crm-border-color)]">
        <button
          type="button"
          onClick={onBack}
          aria-label={t('bubble.back')}
          className="shrink-0 rounded p-1 text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)]"
        >
          ←
        </button>
        <span className="crm-conv-avatar !h-8 !w-8 shrink-0 !text-[11px]" style={{ background: avatarColor(conversationId) }}>
          {avatarLabel(displayName)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[var(--crm-text-main)]">
          {displayName}
        </span>
        {conversation && conversation.status !== 'archived' && (
          <button
            type="button"
            onClick={() => archiveMutation.mutate()}
            disabled={archiveMutation.isPending}
            aria-label={t('view.archive')}
            title={t('view.archive')}
            className="shrink-0 rounded p-1 text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] disabled:opacity-60"
          >
            🗄
          </button>
        )}
        {conversation && canDelete && (
          <button
            type="button"
            onClick={() => setDeleteOpen(true)}
            aria-label={t('view.delete')}
            title={t('view.delete')}
            className="shrink-0 rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
          >
            🗑
          </button>
        )}
        <Link prefetch={false}
          href={`/inbox?c=${conversationId}`}
          className="shrink-0 text-[11px] font-semibold text-[var(--crm-primary-color)] hover:underline"
        >
          {t('bubble.viewFull')}
        </Link>
      </div>

      <div ref={scrollRef} className="crm-bubble-messages flex-1 space-y-2 overflow-y-auto">
        {messagesQuery.isLoading ? (
          <p className="text-xs text-[var(--crm-text-muted)]">{t('common.loading')}</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-[var(--crm-text-muted)]">{t('view.noMessages')}</p>
        ) : (
          messages.map((m) => {
            const fromPatient = m.role === 'user'
            const skin = fromPatient
              ? 'crm-message'
              : m.role === 'agent'
                ? 'crm-message crm-message-sent'
                : 'crm-message crm-ai-suggested'
            return (
              <div key={m.id} className={`flex ${fromPatient ? 'justify-start' : 'justify-end'}`}>
                <div className={`text-[13px] ${skin}`}>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <div className="mt-1 text-[10px] opacity-70">{formatTime(m.createdAt, language)}</div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {closed ? (
        <p className="crm-bubble-input-area border-t border-[var(--crm-border-color)] text-xs text-[var(--crm-text-muted)]">
          {t('view.closedNotice')}
        </p>
      ) : (
        <form onSubmit={onSend} className="crm-bubble-input-area flex items-center gap-2 border-t border-[var(--crm-border-color)]">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('view.placeholder')}
            className="min-w-0 flex-1 rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-3 py-1.5 text-xs outline-none focus:border-[var(--crm-primary-color)]"
          />
          <button
            type="submit"
            disabled={sendMutation.isPending || !draft.trim()}
            className="shrink-0 rounded-full bg-[var(--crm-primary-color)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
          >
            {t('view.send')}
          </button>
        </form>
      )}
      <DeleteConversationDialog
        open={deleteOpen}
        conversationId={conversationId}
        onClose={() => setDeleteOpen(false)}
        onDeleted={() => {
          setDeleteOpen(false)
          onBack()
        }}
      />
    </div>
  )
}
