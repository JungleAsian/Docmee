'use client'

// Compact Messenger-mode conversation list for the floating ChatBubble widget.
// Deliberately smaller than ConversationList.tsx (no lens tabs, no channel
// filter, no bulk actions, no keyboard nav) — a quick-access queue, not a
// replacement for the full /inbox page.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useI18n } from '../hooks/useI18n'
import { avatarColor, avatarLabel, relativeTime } from '../format'
import type { Conversation } from '../types'

function previewText(
  lastMessage: Conversation['lastMessage'],
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!lastMessage) return t('conv.preview.none')
  if (lastMessage.contentType === 'audio') return `🎤 ${t('conv.preview.voice')}`
  if (lastMessage.contentType === 'image') return `🖼 ${t('conv.preview.image')}`
  return lastMessage.content || t('conv.preview.none')
}

export function BubbleConversationList({ onSelect }: { onSelect: (id: string) => void }) {
  const { t } = useI18n()
  const userId = useAuthStore((s) => s.user?.id)
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: ['conversations', 'all', userId, ''],
    refetchInterval: 10_000,
    queryFn: () => api.get<{ conversations: Conversation[] }>('/conversations?limit=75'),
  })

  const rows = query.data?.conversations ?? []
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return rows
    return rows.filter((c) =>
      `${c.patientName ?? ''} ${c.channelContactHandle}`.toLowerCase().includes(term),
    )
  }, [rows, search])

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-[var(--crm-border-color)] p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('conv.search')}
          aria-label={t('conv.search')}
          className="w-full rounded-lg border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-2.5 py-1.5 text-xs outline-none focus:border-[var(--crm-primary-color)]"
        />
      </div>
      <ul className="flex-1 overflow-y-auto">
        {query.isLoading ? (
          <li className="p-4 text-center text-xs text-[var(--crm-text-muted)]">{t('common.loading')}</li>
        ) : query.isError ? (
          <li className="p-4 text-center text-xs text-[var(--crm-text-muted)]">{t('common.error')}</li>
        ) : filtered.length === 0 ? (
          <li className="p-4 text-center text-xs text-[var(--crm-text-muted)]">{t('conv.empty')}</li>
        ) : (
          filtered.map((c) => {
            const displayName = c.patientName || c.channelContactHandle
            const unread = c.lastMessage?.role === 'user'
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={`crm-conversation-item w-full min-w-0 border-l-transparent text-left ${unread ? 'font-semibold' : ''}`}
                >
                  <span className="crm-conv-avatar shrink-0" style={{ background: avatarColor(c.id) }}>
                    {avatarLabel(displayName)}
                  </span>
                  <span className="min-w-0 flex-1 pr-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex-1 truncate text-[13px] font-bold text-[var(--crm-text-main)]">
                        {displayName}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-[var(--crm-text-muted)]">
                        {relativeTime(c.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--crm-text-muted)]">
                      {previewText(c.lastMessage, t)}
                    </span>
                  </span>
                  {unread && <span className="crm-unread-badge" aria-hidden="true" />}
                </button>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
