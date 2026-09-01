'use client'

// Screen 11 — Alerts center. The full-page companion to the header notification
// bell: the same clinic feed (GET /notifications) but with a priority digest,
// priority + read/unread filters, urgent-first ordering, the alert body, a deep-link
// into the originating conversation, and acknowledge (one / all). Read/unread,
// priority routing, escalation (p1) and acknowledgment are all first-class here.
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import { useAuthStore } from '@/shared/store/auth'
import { formatDateTime } from '@/shared/format'
import {
  alertHandling,
  alertIcon,
  alertLabelKey,
  alertPriority,
  alertTitleText,
  channelLabel,
  formatAlertDetailText,
  isHandoffAlert,
  isSafetyAlert,
  type AlertPriority,
} from '@/shared/notifications'
import type { TranslationKey } from '@/shared/i18n'
import { UserAlertsPanel, readAlertCategories, type AlertCategories } from '@/shared/components/UserAlertsPanel'
import type { NotificationEvent, NotificationPrefs } from '@/shared/types'

const POLL_MS = 30_000

/** Delivered-but-unhandled alerts are unread (mirrors the bell). */
function isUnread(n: NotificationEvent): boolean {
  return n.status !== 'acknowledged' && n.status !== 'skipped'
}

const PRIORITY_LABEL: Record<AlertPriority, TranslationKey> = {
  p1: 'alerts.priority.p1',
  p2: 'alerts.priority.p2',
  standard: 'alerts.priority.standard',
}
// Left rail + badge styling per priority — p1 (urgent) is unmistakable red.
const PRIORITY_RAIL: Record<AlertPriority, string> = {
  p1: 'border-l-red-500',
  p2: 'border-l-amber-500',
  standard: 'border-l-gray-300 dark:border-l-gray-700',
}
const PRIORITY_BADGE: Record<AlertPriority, string> = {
  p1: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  p2: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  standard: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}
// Priority-tinted tile behind the per-alert icon (mirrors the mockup's coloured square).
const PRIORITY_TILE: Record<AlertPriority, string> = {
  p1: 'bg-red-50 dark:bg-red-950/50',
  p2: 'bg-amber-50 dark:bg-amber-950/50',
  standard: 'bg-gray-100 dark:bg-gray-800',
}
const PRIORITY_RANK: Record<AlertPriority, number> = { p1: 2, p2: 1, standard: 0 }

type AlertQuickFilter = 'all' | 'unread' | AlertPriority

export default function AlertsPage() {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const clinicId = user?.clinicId
  const canEditOwnAlerts = user?.role === 'secretary' || user?.role === 'doctor'
  const [quickFilter, setQuickFilter] = useState<AlertQuickFilter>('all')

  const key = ['notifications', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    refetchInterval: POLL_MS,
    queryFn: () => api.get<{ notifications: NotificationEvent[] }>(`/notifications?clinic_id=${clinicId}`),
  })
  const notifications = useMemo(() => query.data?.notifications ?? [], [query.data])
  const prefsKey = ['notification-preferences', user?.id]
  const prefsQuery = useQuery({
    queryKey: prefsKey,
    enabled: canEditOwnAlerts,
    queryFn: () => api.get<{ preferences: NotificationPrefs }>('/user/notification-preferences'),
  })
  const alertCategories = readAlertCategories(prefsQuery.data?.preferences)
  const soundEnabled = prefsQuery.data?.preferences.soundEnabled ?? false
  const saveAlertPreferences = useMutation({
    mutationFn: (next: { alertCategories?: AlertCategories; soundEnabled?: boolean }) =>
      api.put('/user/notification-preferences', next),
    onSuccess: () => qc.invalidateQueries({ queryKey: prefsKey }),
  })
  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const acknowledge = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/acknowledge`),
    onSuccess: invalidate,
  })
  const unread = useMemo(() => notifications.filter(isUnread), [notifications])
  const markAllRead = useMutation({
    mutationFn: () => Promise.all(unread.map((n) => api.post(`/notifications/${n.id}/acknowledge`))),
    onSuccess: invalidate,
  })

  // Digest counts by priority + unread (Req 24 digest / urgent surfacing).
  const digest = useMemo(() => {
    const d = { p1: 0, p2: 0, standard: 0, unread: unread.length }
    for (const n of notifications) d[alertPriority(n.alertType)] += 1
    return d
  }, [notifications, unread.length])

  const matchesQuickFilter = (n: NotificationEvent) => {
    if (quickFilter === 'all') return true
    if (quickFilter === 'unread') return isUnread(n)
    return alertPriority(n.alertType) === quickFilter
  }

  // Order: unread first, then by priority, then newest-first. Counts keep using the
  // full feed so the filter points continue collecting alarms while one lane is focused.
  const ordered = useMemo(() => {
    const rank = (n: NotificationEvent) =>
      (isUnread(n) ? 10 : 0) + PRIORITY_RANK[alertPriority(n.alertType)]
    return [...notifications].sort((a, b) => rank(b) - rank(a) || b.createdAt.localeCompare(a.createdAt))
  }, [notifications])

  const focusedAlerts = useMemo(() => ordered.filter(matchesQuickFilter), [ordered, quickFilter])
  const backgroundAlerts = useMemo(
    () => (quickFilter === 'all' ? [] : ordered.filter((n) => !matchesQuickFilter(n))),
    [ordered, quickFilter],
  )

  const renderAlert = (n: NotificationEvent, subdued = false) => {
    const priority = alertPriority(n.alertType)
    const unreadRow = isUnread(n)
    const safety = isSafetyAlert(n.alertType)
    const handoff = isHandoffAlert(n.alertType)
    const handling = alertHandling(n.alertType)
    const channel = channelLabel((n.metadata as { channel?: unknown } | null)?.channel)
    const title = n.alertType ? t(alertLabelKey(n.alertType)) : alertTitleText(n.subject, '')
    const detail = formatAlertDetailText(n.content, title)
    return (
      <tr
        key={n.id}
        className={`border-b border-l-4 ${PRIORITY_RAIL[priority]} ${
          subdued ? 'opacity-45 saturate-50' : unreadRow ? '' : 'opacity-70'
        }`}
      >
        <td className="px-3 py-3 align-top text-xs">
          <span className={`inline-flex items-center gap-1.5 ${unreadRow ? 'font-semibold text-teal-700 dark:text-teal-300' : 'text-gray-500'}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${unreadRow ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            {unreadRow ? t('alerts.digest.unread') : t('alerts.acknowledged')}
          </span>
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex min-w-28 flex-wrap gap-1.5">
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${PRIORITY_BADGE[priority]}`}>
              {t(PRIORITY_LABEL[priority])}
            </span>
            {safety && (
              <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                ⚠ {t('alerts.safety')}
              </span>
            )}
            {handoff && (
              <span className="rounded border border-dashed border-orange-400 bg-orange-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-orange-700 dark:bg-orange-950 dark:text-orange-300">
                {t('alerts.handoff')}
              </span>
            )}
            {handling === 'human' && (
              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                {t('alerts.mode.human')}
              </span>
            )}
            {handling === 'bot' && (
              <span className="rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300">
                {t('alerts.mode.bot')}
              </span>
            )}
            {!unreadRow && (
              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-400 dark:bg-gray-800">
                {t('alerts.acknowledged')}
              </span>
            )}
          </div>
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex min-w-48 items-start gap-2">
            <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-lg ${PRIORITY_TILE[priority]}`}>
              {alertIcon(n.alertType)}
            </span>
            <span className="text-sm font-semibold">{title}</span>
          </div>
        </td>
        <td className="max-w-sm px-3 py-3 align-top text-xs leading-5 text-gray-600 dark:text-gray-300">
          {detail || '—'}
        </td>
        <td className="px-3 py-3 align-top">
          <div className="flex min-w-28 flex-wrap gap-1">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {channel || '—'}
            </span>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase text-gray-500 dark:bg-gray-800 dark:text-gray-400">
              {handling}
            </span>
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-gray-400">
          {formatDateTime(n.createdAt, language)}
        </td>
        <td className="px-3 py-3 align-top">
          {n.conversationId ? (
            <Link prefetch={false} href={`/inbox?c=${n.conversationId}`} className="text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400">
              {t('alerts.openConversation')}
            </Link>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="px-3 py-3 align-top">
          {unreadRow ? (
            <button
              type="button"
              onClick={() => acknowledge.mutate(n.id)}
              disabled={acknowledge.isPending}
              className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              {t('notif.acknowledge')}
            </button>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
      </tr>
    )
  }

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-sm space-y-4">
      {/* Header hero removed — the mark-all-read control moves to a slim toolbar
          above the digest so the content fills the reclaimed space. */}
      {unread.length > 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700"
          >
            {t('notif.markAllRead')}
          </button>
        </div>
      )}

      {/* Digest — counts by priority + unread, doubling as the priority filter. */}
      {canEditOwnAlerts && (
        <UserAlertsPanel
          value={alertCategories}
          onChange={(next) => saveAlertPreferences.mutate({ alertCategories: next })}
          soundEnabled={soundEnabled}
          onSoundEnabledChange={(enabled) => saveAlertPreferences.mutate({ soundEnabled: enabled })}
          disabled={prefsQuery.isLoading || saveAlertPreferences.isPending}
          className="clinic-card"
        />
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <DigestChip
          label={t('alerts.digest.unread')}
          count={digest.unread}
          tone="bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300"
          active={quickFilter === 'unread'}
          onClick={() => setQuickFilter((filter) => (filter === 'unread' ? 'all' : 'unread'))}
        />
        <DigestChip
          label={t('alerts.priority.p1')}
          count={digest.p1}
          tone="bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
          active={quickFilter === 'p1'}
          onClick={() => setQuickFilter((filter) => (filter === 'p1' ? 'all' : 'p1'))}
        />
        <DigestChip
          label={t('alerts.priority.p2')}
          count={digest.p2}
          tone="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          active={quickFilter === 'p2'}
          onClick={() => setQuickFilter((filter) => (filter === 'p2' ? 'all' : 'p2'))}
        />
        <DigestChip
          label={t('alerts.priority.standard')}
          count={digest.standard}
          tone="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          active={quickFilter === 'standard'}
          onClick={() => setQuickFilter((filter) => (filter === 'standard' ? 'all' : 'standard'))}
        />
      </div>

      {quickFilter !== 'all' && (
        <button
          type="button"
          onClick={() => setQuickFilter('all')}
          className="text-xs font-medium text-teal-600 hover:text-teal-700 dark:text-teal-400"
        >
          {t('alerts.filter.all')}
        </button>
      )}

      {query.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="clinic-card h-16 animate-pulse"
            />
          ))}
        </div>
      ) : query.isError ? (
        <div className="clinic-card border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('notif.loadError')}{' '}
          <button type="button" onClick={() => query.refetch()} className="font-medium underline">
            {t('common.retry')}
          </button>
        </div>
      ) : notifications.length === 0 ? (
        <div className="clinic-empty-state text-sm">
          {t('notif.empty')}
        </div>
      ) : (
        <div className="overflow-x-auto clinic-card">
          {focusedAlerts.length > 0 ? (
            <table
              className="min-w-[960px] w-full text-left text-sm"
              aria-label={t('alerts.table.label')}
            >
              <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900">
                <tr>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.readStatus')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.priority')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.alert')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.details')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.channelMode')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.dateTime')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.conversation')}</th>
                  <th scope="col" className="px-3 py-3">{t('alerts.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {focusedAlerts.map((n) => renderAlert(n))}
                {backgroundAlerts.length > 0 && (
                  <tr>
                    <td colSpan={8} className="bg-gray-50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:bg-gray-900">
                      {t('alerts.table.background')}
                    </td>
                  </tr>
                )}
                {backgroundAlerts.map((n) => renderAlert(n, true))}
              </tbody>
            </table>
          ) : (
            <div className="clinic-empty-state text-sm">{t('alerts.empty')}</div>
          )}
        </div>
      )}
      </div>
    </div>
  )
}

function DigestChip({
  label,
  count,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  tone: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
        active ? 'border-teal-500 ring-1 ring-teal-500' : 'border-gray-200 dark:border-gray-800'
      } ${tone}`}
    >
      <span className="text-xs font-medium">{label}</span>
      <span className="text-lg font-bold tabular-nums">{count}</span>
    </button>
  )
}
