'use client'

// Req 24 — Web panel notifications. The bell polls the clinic's notification feed
// (GET /notifications), shows an unread count, lists alerts newest-first with a
// priority marker, and lets a secretary acknowledge one or all of them
// (POST /notifications/:id/acknowledge). A gear opens the per-user preferences.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { formatDateTime } from '../format'
import { alertLabelKey, alertPriority, alertTitleText, formatAlertDetailText, PRIORITY_DOT } from '../notifications'
import { SlideOver } from './SlideOver'
import { NotificationPreferences } from './NotificationPreferences'
import type { NotificationEvent, NotificationPrefs } from '../types'

const POLL_MS = 30_000

/** Delivered-but-unhandled alerts count toward the unread badge. */
function isUnread(n: NotificationEvent): boolean {
  return n.status !== 'acknowledged' && n.status !== 'skipped'
}

function playNotificationSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const ctx = new AudioContextClass()
    const now = ctx.currentTime
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.42)
    gain.connect(ctx.destination)
    for (const [offset, frequency] of [[0, 880], [0.14, 1174]] as const) {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(frequency, now + offset)
      osc.connect(gain)
      osc.start(now + offset)
      osc.stop(now + offset + 0.16)
    }
    window.setTimeout(() => void ctx.close().catch(() => undefined), 700)
  } catch {
    // Browsers may block audio until the user has interacted with the page.
  }
}

export function NotificationBell() {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const clinicId = useAuthStore((s) => s.user?.clinicId)
  const [open, setOpen] = useState(false)
  const [prefsOpen, setPrefsOpen] = useState(false)
  const seenUnreadIds = useRef<Set<string> | null>(null)

  const key = ['notifications', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    refetchInterval: POLL_MS,
    queryFn: () =>
      api.get<{ notifications: NotificationEvent[] }>(`/notifications?clinic_id=${clinicId}`),
  })

  const notifications = useMemo(() => query.data?.notifications ?? [], [query.data])
  const unread = useMemo(() => notifications.filter(isUnread), [notifications])
  const prefsQuery = useQuery({
    queryKey: ['notification-prefs'],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ preferences: NotificationPrefs }>('/user/notification-preferences'),
  })
  const soundEnabled = prefsQuery.data?.preferences.soundEnabled === true

  useEffect(() => {
    if (!clinicId || query.isLoading || query.isError) return
    const currentIds = new Set(unread.map((n) => n.id))
    if (seenUnreadIds.current === null) {
      seenUnreadIds.current = currentIds
      return
    }
    const hasNewUnread = [...currentIds].some((id) => !seenUnreadIds.current?.has(id))
    seenUnreadIds.current = currentIds
    if (soundEnabled && hasNewUnread) playNotificationSound()
  }, [clinicId, query.isLoading, query.isError, soundEnabled, unread])

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/acknowledge`),
    onSuccess: invalidate,
  })

  const markAllRead = useMutation({
    mutationFn: () => Promise.all(unread.map((n) => api.post(`/notifications/${n.id}/acknowledge`))),
    onSuccess: invalidate,
  })

  if (!clinicId) return null

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t('notif.title')}
        onClick={() => setOpen((v) => !v)}
        className="relative inline-flex min-h-8 min-w-9 items-center justify-center rounded-md border border-gray-300 px-2.5 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        <span aria-hidden>🔔</span>
        {unread.length > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click-away backdrop. */}
          <button
            type="button"
            aria-label={t('common.close')}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 z-40 mt-2 flex max-h-[28rem] w-80 flex-col rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900">
            <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-800">
              <span className="text-sm font-semibold">{t('notif.title')}</span>
              <div className="flex items-center gap-1">
                {unread.length > 0 && (
                  <button
                    type="button"
                    onClick={() => markAllRead.mutate()}
                    disabled={markAllRead.isPending}
                    className="rounded px-1.5 py-0.5 text-xs text-teal-600 hover:bg-teal-50 disabled:opacity-50 dark:hover:bg-gray-800"
                  >
                    {t('notif.markAllRead')}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={t('notif.preferences')}
                  onClick={() => {
                    setPrefsOpen(true)
                    setOpen(false)
                  }}
                  className="rounded px-1.5 py-0.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  ⚙️
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {query.isError && (
                <p className="px-3 py-6 text-center text-sm text-red-600">{t('notif.loadError')}</p>
              )}
              {!query.isError && notifications.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-gray-400">{t('notif.empty')}</p>
              )}
              <ul className="divide-y divide-gray-100 dark:divide-gray-800">
                {notifications.map((n) => {
                  const unreadRow = isUnread(n)
                  const title = n.alertType ? t(alertLabelKey(n.alertType)) : alertTitleText(n.subject, '')
                  const detail = formatAlertDetailText(n.content, title)
                  return (
                    <li
                      key={n.id}
                      className={`flex items-start gap-2 px-3 py-2 ${
                        unreadRow ? 'bg-teal-50/40 dark:bg-gray-800/40' : ''
                      }`}
                    >
                      <span
                        aria-hidden
                        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                          PRIORITY_DOT[alertPriority(n.alertType)]
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {title}
                        </p>
                        {detail && <p className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{detail}</p>}
                        <p className="text-xs text-gray-400">{formatDateTime(n.createdAt, language)}</p>
                      </div>
                      {unreadRow && (
                        <button
                          type="button"
                          aria-label={t('notif.acknowledge')}
                          title={t('notif.acknowledge')}
                          onClick={() => acknowledge.mutate(n.id)}
                          disabled={acknowledge.isPending}
                          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:hover:bg-gray-700"
                        >
                          ✓
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        </>
      )}

      <SlideOver open={prefsOpen} onClose={() => setPrefsOpen(false)} title={t('notif.prefs.title')}>
        <NotificationPreferences />
      </SlideOver>
    </div>
  )
}
