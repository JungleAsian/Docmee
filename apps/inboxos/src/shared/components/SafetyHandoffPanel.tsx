'use client'

// CRE-307: operator-facing safety context for the open thread. It reads the same
// conversation lifecycle data and safety tags the inbox already uses, then makes
// the handoff reason, bot pause, and confidence signal visible in the right rail.
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { relativeTime } from '../format'
import { assessSafety } from '../safety'
import type { Conversation, Tag } from '../types'

function textMeta(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function numberMeta(metadata: Record<string, unknown> | undefined, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function dateMeta(metadata: Record<string, unknown> | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = metadata?.[key]
    if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return value
  }
  return null
}

function confidenceLabel(score: number | null): string | null {
  if (score === null) return null
  const pct = score <= 1 ? score * 100 : score
  return `${Math.round(Math.max(0, Math.min(100, pct)))}%`
}

export function SafetyHandoffPanel({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const tagsQuery = useQuery({
    queryKey: ['tags', conversationId],
    queryFn: () => api.get<{ tags: Tag[] }>(`/conversations/${conversationId}/tags`),
  })

  const conversation = conversationQuery.data?.conversation
  const metadata = conversation?.metadata
  const tagNames = useMemo(() => (tagsQuery.data?.tags ?? []).map((tag) => tag.name), [tagsQuery.data])
  const safety = assessSafety(tagNames)
  const reason = textMeta(metadata, [
    'handoffReason',
    'handoff_reason',
    'escalationReason',
    'escalation_reason',
    'safetyReason',
    'safety_reason',
  ])
  const confidence = confidenceLabel(
    numberMeta(metadata, ['aiConfidence', 'ai_confidence', 'confidence', 'confidenceScore', 'lastAiConfidence']),
  )
  const changedAt =
    dateMeta(metadata, ['statusChangedAt', 'handoffAt', 'handoff_at', 'botPausedAt', 'bot_paused_at']) ??
    conversation?.updatedAt ??
    null
  const botPausedAt = dateMeta(metadata, ['botPausedAt', 'bot_paused_at'])
  const activeHandoff = conversation?.status === 'handoff' || conversation?.status === 'assigned'
  const hasSignal = Boolean(safety.level || reason || confidence || activeHandoff || botPausedAt)

  const tone =
    safety.level === 'critical'
      ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200'
      : safety.level === 'warning' || activeHandoff
        ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200'
        : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200'

  return (
    <section className="border-b border-gray-200 p-3 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {t('handoff.title')}
      </h3>

      <div className={`rounded-lg border px-3 py-2 ${tone}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] font-bold">
            {safety.level === 'critical'
              ? t('handoff.state.critical')
              : safety.level === 'warning'
                ? t('handoff.state.warning')
                : activeHandoff
                  ? t('handoff.state.human')
                  : t('handoff.state.normal')}
          </p>
          {conversation && (
            <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold dark:bg-black/20">
              {t(`conv.status.${conversation.status}` as const)}
            </span>
          )}
        </div>
        {changedAt && <p className="mt-1 text-[11px] opacity-80">{relativeTime(changedAt)}</p>}
      </div>

      <dl className="mt-3 space-y-2 text-[12px]">
        <SignalRow label={t('handoff.reason')} value={reason ?? (hasSignal ? t('handoff.reason.unspecified') : null)} />
        <SignalRow label={t('handoff.confidence')} value={confidence ?? t('handoff.confidence.none')} />
        <SignalRow
          label={t('handoff.bot')}
          value={botPausedAt ? t('handoff.bot.paused') : t('handoff.bot.active')}
        />
      </dl>

      {safety.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {safety.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {!hasSignal && (
        <p className="mt-2 text-[11.5px] leading-relaxed text-gray-400">{t('handoff.empty')}</p>
      )}
    </section>
  )
}

function SignalRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-gray-400">{label}</dt>
      <dd className="text-right font-medium text-gray-700 dark:text-gray-200">{value}</dd>
    </div>
  )
}
