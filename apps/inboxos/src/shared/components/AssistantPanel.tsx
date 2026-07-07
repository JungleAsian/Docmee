'use client'

// Screen 5 — Internal AI Assistant (staff-only inbox right-rail aid, Req 41).
//
// A quiet, card-based panel with the four assistant pillars the Notion brief calls
// for, built to match the approved screen-5 mockup exactly:
//   • Summarize    — catch up on a thread before taking over
//   • Next step    — exactly ONE recommended operational action, colour-coded
//   • Suggest      — KB-grounded reply DRAFTS
//   • Accept/edit  — a draft is INSERTED into the composer to edit, never auto-sent
//
// Nothing here is sent to the patient. Each card is self-contained and renders one
// of: empty (generate CTA) · loading (spinner + skeletons) · error (with retry) ·
// permission-denied (🔒) · success. Offline disables generation (the inbox shows the
// global disconnected banner). The "Use in reply" action only fills the editable
// composer draft — the human still reviews, edits and presses Send.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useOnline } from '../hooks/useOnline'
import { formatTime } from '../format'
import { useComposerStore } from '../store/composer'
import type { TranslationKey } from '../i18n'

// The fixed operational next-step vocabulary the API returns (mirrors
// packages/agents NEXT_STEP_ACTIONS). Kept local — inboxos doesn't depend on the
// agents package — and used to localize + colour-code the recommendation.
type NextStepAction =
  | 'urgent_safety'
  | 'escalate_human'
  | 'book_appointment'
  | 'confirm_details'
  | 'request_info'
  | 'answer_question'
  | 'follow_up_later'
  | 'resolve'

interface SuggestionSource {
  title: string
  similarity: number
}
interface SuggestionsResponse {
  suggestions: string[]
  sources: SuggestionSource[]
}
interface NextStepResponse {
  action: NextStepAction
  rationale: string
}

// Colour variant per recommended action (matches the mockup's next-step card map):
// safety is loud red, human-escalation amber, resolve emerald, every other action
// the calm indigo brand. The colour is the at-a-glance signal a busy secretary reads
// before the words.
type Variant = 'urgent' | 'escalate' | 'resolve' | 'indigo'

const ACTION_VARIANT: Record<NextStepAction, Variant> = {
  urgent_safety: 'urgent',
  escalate_human: 'escalate',
  resolve: 'resolve',
  book_appointment: 'indigo',
  confirm_details: 'indigo',
  request_info: 'indigo',
  answer_question: 'indigo',
  follow_up_later: 'indigo',
}

const ACTION_ICON: Record<NextStepAction, string> = {
  urgent_safety: '⚠',
  escalate_human: '⇪',
  book_appointment: '📅',
  confirm_details: '✔',
  request_info: '❓',
  answer_question: '💬',
  follow_up_later: '⏲',
  resolve: '✓',
}

const VARIANT_STYLE: Record<Variant, { box: string; iconBg: string; label: string }> = {
  urgent: {
    box: 'border-red-200 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40',
    iconBg: 'bg-red-600',
    label: 'text-red-800 dark:text-red-200',
  },
  escalate: {
    box: 'border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/40',
    iconBg: 'bg-amber-600',
    label: 'text-amber-800 dark:text-amber-200',
  },
  resolve: {
    box: 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/40',
    iconBg: 'bg-emerald-600',
    label: 'text-emerald-800 dark:text-emerald-200',
  },
  indigo: {
    box: 'border-teal-200 bg-teal-50 dark:border-teal-900/60 dark:bg-teal-950/40',
    iconBg: 'bg-teal-600',
    label: 'text-teal-800 dark:text-teal-200',
  },
}

const ACTION_LABEL: Record<NextStepAction, `assistant.action.${NextStepAction}`> = {
  urgent_safety: 'assistant.action.urgent_safety',
  escalate_human: 'assistant.action.escalate_human',
  book_appointment: 'assistant.action.book_appointment',
  confirm_details: 'assistant.action.confirm_details',
  request_info: 'assistant.action.request_info',
  answer_question: 'assistant.action.answer_question',
  follow_up_later: 'assistant.action.follow_up_later',
  resolve: 'assistant.action.resolve',
}

export function AssistantPanel({ conversationId }: { conversationId: string }) {
  const { t, language } = useI18n()
  const online = useOnline()
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [insertedIdx, setInsertedIdx] = useState<number | null>(null)
  const [summaryAt, setSummaryAt] = useState<string | null>(null)
  const requestInsert = useComposerStore((s) => s.requestInsert)

  const summary = useMutation({
    mutationFn: () =>
      api.post<{ summary: string }>(`/conversations/${conversationId}/assist/summary`),
    onSuccess: () => setSummaryAt(formatTime(new Date().toISOString(), language)),
  })

  const suggestions = useMutation({
    mutationFn: () =>
      api.post<SuggestionsResponse>(`/conversations/${conversationId}/assist/suggestions`),
  })

  const nextStep = useMutation({
    mutationFn: () =>
      api.post<NextStepResponse>(`/conversations/${conversationId}/assist/next-step`),
  })

  async function copy(text: string, idx: number) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx((cur) => (cur === idx ? null : cur)), 1500)
    } catch {
      // Clipboard blocked — no-op; the text is still selectable on screen.
    }
  }

  // Accept boundary: push the draft into the composer for the secretary to edit and
  // send. Never sends here.
  function insert(text: string, idx: number) {
    requestInsert(conversationId, text)
    setInsertedIdx(idx)
    setTimeout(() => setInsertedIdx((cur) => (cur === idx ? null : cur)), 1500)
  }

  return (
    <section className="border-b border-gray-200 bg-gray-50/60 dark:border-gray-800 dark:bg-gray-900/40">
      {/* Header — spark mark, title, subtitle and the unmistakable staff-only badge
          so it's never confused with anything the patient can see. */}
      <div className="border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-600 to-cyan-600 text-xs font-bold text-white"
          >
            ✦
          </span>
          <h3 className="text-sm font-bold">{t('assistant.title')}</h3>
        </div>
        <p className="mt-1 text-[11.5px] text-gray-500 dark:text-gray-400">{t('assistant.subtitle')}</p>
        <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-cyan-700 dark:border-cyan-800/60 dark:bg-cyan-950/40 dark:text-cyan-300">
          🔒 {t('assistant.staffOnly')}
        </span>
      </div>

      <div className="space-y-3 p-3">
        {!online && (
          <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <span aria-hidden>⚠</span>
            <span>{t('assistant.offlineNote')}</span>
          </p>
        )}

        {/* ── 1. Conversation summary ── */}
        <Card
          icon="≡"
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300"
          title={t('assistant.summaryTitle')}
          pill={summary.data ? t('assistant.updated', { time: summaryAt ?? '' }) : undefined}
        >
          <CardState
            mutation={summary}
            online={online}
            loadingLabel={t('assistant.reading')}
            emptyTitle={t('assistant.emptySummary')}
            emptyHint={t('assistant.emptySummaryHint')}
            cta={t('assistant.summarize')}
            errorTitle={t('assistant.errSummary')}
          >
            {summary.data && (
              <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-700 dark:text-gray-200">
                {summary.data.summary}
              </p>
            )}
          </CardState>
        </Card>

        {/* ── 2. Suggested next step (colour-coded, exactly one action) ── */}
        <Card
          icon="➜"
          iconClass="bg-teal-50 text-teal-600 dark:bg-teal-950/50 dark:text-teal-300"
          title={t('assistant.nextStepLabel')}
          pill={nextStep.data ? t('assistant.pill.advisory') : undefined}
        >
          <CardState
            mutation={nextStep}
            online={online}
            loadingLabel={t('assistant.thinking')}
            emptyTitle={t('assistant.emptyNextStep')}
            emptyHint={t('assistant.emptyNextStepHint')}
            cta={t('assistant.nextStep')}
            errorTitle={t('assistant.errNextStep')}
          >
            {nextStep.data && <NextStepCard data={nextStep.data} t={t} />}
          </CardState>
        </Card>

        {/* ── 3. KB-grounded reply draft ── */}
        <Card
          icon="✎"
          iconClass="bg-cyan-50 text-cyan-600 dark:bg-cyan-950/50 dark:text-cyan-300"
          title={t('assistant.replyTitle')}
          pill={suggestions.data ? t('assistant.pill.kbGrounded') : undefined}
        >
          <CardState
            mutation={suggestions}
            online={online}
            loadingLabel={t('assistant.thinking')}
            emptyTitle={t('assistant.emptyReply')}
            emptyHint={t('assistant.emptyReplyHint')}
            cta={t('assistant.suggest')}
            errorTitle={t('assistant.errReply')}
          >
            {suggestions.data && (
              <DraftList
                data={suggestions.data}
                online={online}
                copiedIdx={copiedIdx}
                insertedIdx={insertedIdx}
                onInsert={insert}
                onCopy={copy}
                onRegenerate={() => suggestions.mutate()}
                regenerating={suggestions.isPending}
              />
            )}
          </CardState>
        </Card>
      </div>
    </section>
  )
}

// KB-grounded reply drafts. Each draft can be inserted into the composer (the accept
// boundary — never auto-sent), copied, or regenerated. The "Grounded in" KB chips
// make the source provenance explicit, matching the mockup.
function DraftList({
  data,
  online,
  copiedIdx,
  insertedIdx,
  onInsert,
  onCopy,
  onRegenerate,
  regenerating,
}: {
  data: SuggestionsResponse
  online: boolean
  copiedIdx: number | null
  insertedIdx: number | null
  onInsert: (text: string, idx: number) => void
  onCopy: (text: string, idx: number) => void
  onRegenerate: () => void
  regenerating: boolean
}) {
  const { t } = useI18n()
  if (data.suggestions.length === 0) {
    return <p className="text-[11px] text-gray-400">{t('assistant.noSuggestions')}</p>
  }
  return (
    <div className="space-y-3">
      {/* Never-auto-sent warning lives on the draft itself (mockup). */}
      <p className="flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
        <span aria-hidden>⚠️</span>
        <span>{t('assistant.draftWarn')}</span>
      </p>
      {data.suggestions.map((s, idx) => (
        <div key={idx}>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs leading-relaxed text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
            <p className="whitespace-pre-wrap break-words">{s}</p>
          </div>
          {data.sources.length > 0 && (
            <p className="mt-1.5 flex flex-wrap items-center gap-1 text-[10.5px] text-gray-500 dark:text-gray-400">
              {t('assistant.groundedIn')}
              {data.sources.map((src) => (
                <span
                  key={src.title}
                  className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 font-semibold text-cyan-700 dark:border-cyan-900/60 dark:bg-cyan-950/40 dark:text-cyan-300"
                >
                  KB · {src.title}
                </span>
              ))}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            {/* Accept boundary: insert into the composer to edit, then send. */}
            <button
              type="button"
              onClick={() => onInsert(s, idx)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-teal-600 px-2 py-2 text-[11px] font-bold text-white hover:bg-teal-700"
            >
              ↧ {insertedIdx === idx ? t('assistant.inserted') : t('assistant.insert')}
            </button>
            <button
              type="button"
              onClick={() => onCopy(s, idx)}
              className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              ⧉ {copiedIdx === idx ? t('assistant.copied') : t('assistant.copy')}
            </button>
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!online || regenerating}
              title={t('assistant.regenerate')}
              aria-label={t('assistant.regenerate')}
              className="flex items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              ↻
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// Generic mutation type the cards consume — narrow to just what the state machine
// needs (status flags + the typed error) so all three pillars share one renderer.
interface CardMutation {
  isPending: boolean
  isError: boolean
  data: unknown
  error: unknown
  mutate: () => void
}

// A titled assistant card: icon tile + title + optional right-aligned pill, then the
// body. Mirrors the mockup's `.ac` card.
function Card({
  icon,
  iconClass,
  title,
  pill,
  children,
}: {
  icon: string
  iconClass: string
  title: string
  pill?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2.5 dark:border-gray-800">
        <span aria-hidden className={`grid h-6 w-6 shrink-0 place-items-center rounded-md text-[13px] ${iconClass}`}>
          {icon}
        </span>
        <h4 className="text-[12.5px] font-bold">{title}</h4>
        {pill && (
          <span className="ml-auto rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            {pill}
          </span>
        )}
      </div>
      <div className="px-3 py-3">{children}</div>
    </div>
  )
}

// The per-card state machine: empty (generate CTA) · loading · permission-denied ·
// error · success (children). Keeps the three pillars visually identical across
// every required state.
function CardState({
  mutation,
  online,
  loadingLabel,
  emptyTitle,
  emptyHint,
  cta,
  errorTitle,
  children,
}: {
  mutation: CardMutation
  online: boolean
  loadingLabel: string
  emptyTitle: string
  emptyHint: string
  cta: string
  errorTitle: string
  children: React.ReactNode
}) {
  const { t } = useI18n()

  if (mutation.isPending) {
    return (
      <div>
        <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
          <span
            aria-hidden
            className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-teal-600 dark:border-gray-600 dark:border-t-teal-400"
          />
          {loadingLabel}
        </div>
        <div className="mt-2.5 space-y-2">
          <Skel className="w-[90%]" />
          <Skel className="w-[70%]" />
          <Skel className="w-[85%]" />
          <Skel className="w-[40%]" />
        </div>
      </div>
    )
  }

  if (mutation.isError) {
    // Permission-denied (the panel is gated to inbox roles; a platform admin or an
    // out-of-scope thread gets 403). A retry won't help, so show a locked state.
    if (mutation.error instanceof ApiError && mutation.error.status === 403) {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800">
          <span aria-hidden className="text-sm">🔒</span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">
              {t('common.forbidden.title')}
            </p>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {t('common.forbidden.body')}
            </p>
          </div>
        </div>
      )
    }
    return (
      <div>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/60 dark:bg-red-950/40">
          <span aria-hidden className="text-sm">⚠️</span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-red-800 dark:text-red-200">{errorTitle}</p>
            <p className="mt-0.5 text-[11px] text-red-700/90 dark:text-red-300/90">{t('assistant.errBody')}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!online}
          className="mt-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:bg-gray-900 dark:text-red-300"
        >
          ↻ {t('common.retry')}
        </button>
      </div>
    )
  }

  if (mutation.data == null) {
    // Empty / not generated — the resting state with a single generate CTA.
    return (
      <div className="py-2 text-center">
        <span
          aria-hidden
          className="mx-auto mb-2.5 grid h-10 w-10 place-items-center rounded-xl bg-gray-100 text-lg text-gray-400 dark:bg-gray-800 dark:text-gray-500"
        >
          ✨
        </span>
        <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{emptyTitle}</p>
        <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">{emptyHint}</p>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!online}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-teal-600 px-3.5 py-2 text-[12px] font-bold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          ✦ {cta}
        </button>
      </div>
    )
  }

  return <>{children}</>
}

// The colour-coded recommendation card (mockup `.nextstep`). Icon tile + kicker +
// localized action label, then the staff-only rationale.
function NextStepCard({
  data,
  t,
}: {
  data: NextStepResponse
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string
}) {
  const variant = ACTION_VARIANT[data.action]
  const style = VARIANT_STYLE[variant]
  return (
    <div className={`rounded-xl border p-3 ${style.box}`}>
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-lg text-white ${style.iconBg}`}
        >
          {ACTION_ICON[data.action]}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide opacity-70">
            {t('assistant.recommendedAction')}
          </p>
          <p className={`text-[13.5px] font-extrabold leading-tight ${style.label}`}>
            {t(ACTION_LABEL[data.action])}
          </p>
        </div>
      </div>
      {data.rationale && (
        <p className="mt-2.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-gray-700 dark:text-gray-200">
          <span className="font-bold text-gray-900 dark:text-gray-50">{t('assistant.why')} </span>
          {data.rationale}
        </p>
      )}
    </div>
  )
}

function Skel({ className }: { className: string }) {
  return <div className={`h-2.5 animate-pulse rounded bg-gray-200 dark:bg-gray-700 ${className}`} />
}
