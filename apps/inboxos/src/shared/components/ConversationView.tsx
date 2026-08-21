'use client'

// Conversation view (center column): message history, a mode rail showing whether
// the AI bot or a human secretary is driving the thread, a send box, and
// resolve/reopen actions. Reopen creates a NEW conversation (Decision 4) and the
// view follows the caller to it via onConversationChange.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { avatarColor, avatarLabel, formatDateTime, formatDay, formatTime, relativeTime } from '../format'
import { conversationMode } from '../conversationMode'
import { AssignControl } from './AssignControl'
import { QuickReplyPicker } from './QuickReplyPicker'
import { applyTemplateVars } from '../templateVars'
import { TemplatePicker } from './TemplatePicker'
import { InteractivePicker } from './InteractivePicker'
import { ListPicker } from './ListPicker'
import { deliveryIndicator, type DeliveryTone } from '../delivery'
import { isImageMessage, messageMediaPath } from '../media'
import { assessSafety, type SafetyLevel } from '../safety'
import { useComposerStore } from '../store/composer'
import type { Tag } from '../types'
import type {
  Appointment,
  AppointmentStatus,
  Channel,
  Conversation,
  ConversationStatus,
  Message,
  MessageRole,
} from '../types'

// Compact status colours for the in-thread appointment summary (mirrors the
// patient-history page palette, kept local so the view stays self-contained).
const APPT_BADGE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  arrived: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  in_progress: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  cancelled: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  no_show: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

// Req 4 — channel brand colours for the thread header (the small coloured dot +
// channel name beside the contact). Mirrors the list's channel badge.
const CHANNEL_META: Record<Channel, { label: string; dot: string; text: string }> = {
  whatsapp: { label: 'WhatsApp', dot: 'bg-[#25D366]', text: 'text-green-600 dark:text-green-400' },
  messenger: { label: 'Messenger', dot: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  instagram: { label: 'Instagram', dot: 'bg-pink-600', text: 'text-pink-600 dark:text-pink-400' },
}

const ROLE_LABEL: Record<MessageRole, 'view.role.user' | 'view.role.agent' | 'view.role.assistant' | 'view.role.system'> = {
  user: 'view.role.user',
  agent: 'view.role.agent',
  assistant: 'view.role.assistant',
  system: 'view.role.system',
}

// Req 11: lifecycle transitions a secretary can pick manually. assigned/handoff
// are driven by the dedicated assign/handoff flows, so they are excluded here
// (the current status is still shown if the conversation is in one of them).
const MANUAL_STATUSES: ConversationStatus[] = ['open', 'pending', 'snoozed', 'resolved', 'archived']

// Reskin — the emoji grid behind the 😀 toggle button inserts straight into the
// composer draft.
const EMOJI_SET = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
  '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋',
  '😎', '🤩', '🥳', '🤔', '🤗', '😐', '😴', '😷',
  '🤒', '🤕', '😢', '😭', '😤', '😡', '😱', '😅',
  '👍', '👎', '👌', '🙌', '👏', '🙏', '💪', '👋',
  '🤝', '✌️', '🤞', '👀', '❤️', '🧡', '💛', '💚',
  '💙', '💜', '🔥', '⭐', '✨', '🎉', '🎈', '💯',
  '✅', '❌', '⚠️', '⏰', '📅', '📌', '📎', '💬',
]

// A conversation is "closed" (composer disabled, reopen offered) when resolved or
// archived — both are terminal; reopening either creates a fresh conversation.
function isClosedStatus(status: ConversationStatus | undefined): boolean {
  return status === 'resolved' || status === 'archived'
}

export function ConversationView({
  conversationId,
}: {
  conversationId: string
}) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [flaggedIds, setFlaggedIds] = useState<Set<string>>(new Set())
  const [attachError, setAttachError] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const insertEmoji = (emoji: string) => setDraft((d) => d + emoji)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Screen 5: accept an AI draft from the AssistantPanel into the reply box. The
  // panel pushes a per-conversation insert request through the composer store; we
  // append it to the current draft (so a half-typed message isn't clobbered) and
  // focus the box for the secretary to edit before sending. nonce-guarded so a
  // re-render never re-applies the same request.
  const pendingInsert = useComposerStore((s) => s.pending)
  const clearInsert = useComposerStore((s) => s.clearInsert)
  const appliedNonce = useRef(0)

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
  // The bot drives an open thread; once a human is assigned or it's escalated, a
  // secretary is in control (shared helper so the list pill and this view agree).
  const humanMode = conversationMode(conversation?.status) === 'human'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  useEffect(() => {
    if (
      pendingInsert &&
      pendingInsert.conversationId === conversationId &&
      pendingInsert.nonce !== appliedNonce.current
    ) {
      appliedNonce.current = pendingInsert.nonce
      // CRE-64: resolve {{patient_name}}/{{date}}/{{time}} from the live thread when a
      // quick reply is inserted (AI drafts carry no placeholders, so this is a no-op there).
      const now = new Date()
      const text = applyTemplateVars(pendingInsert.text, {
        patient_name: conversation?.patientName ?? conversation?.channelContactHandle,
        date: now.toLocaleDateString(),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      })
      setDraft((d) => (d.trim() ? `${d}\n${text}` : text))
      clearInsert()
      textareaRef.current?.focus()
    }
  }, [pendingInsert, conversationId, clearInsert, conversation])

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      api.post(`/conversations/${conversationId}/messages`, { content }),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 3: send an approved HSM template (WhatsApp only) — the only way to reach a
  // patient outside the 24h window. Like a manual reply, it delivers immediately
  // and pauses the bot; the server records its wamid so the delivery indicator
  // tracks it.
  const sendTemplateMutation = useMutation({
    mutationFn: (templateId: string) =>
      api.post(`/conversations/${conversationId}/send-template`, { templateId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 3: send an interactive reply-button menu (WhatsApp only). Like a manual
  // reply it delivers immediately and pauses the bot; the server records its wamid
  // so the delivery indicator tracks it, and a tapped button comes back as text.
  const sendInteractiveMutation = useMutation({
    mutationFn: (vars: { body: string; buttons: string[] }) =>
      api.post(`/conversations/${conversationId}/send-interactive`, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 3: send an interactive LIST menu (WhatsApp only) — the >3-options surface.
  // Like a manual reply it delivers immediately and pauses the bot; the server
  // records its wamid so the delivery indicator tracks it, and a picked row comes
  // back as text.
  const sendListMutation = useMutation({
    mutationFn: (vars: {
      body: string
      button: string
      sections: Array<{ rows: Array<{ title: string; description?: string }> }>
    }) => api.post(`/conversations/${conversationId}/send-list`, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 3: attach an image and DELIVER it to the patient over WhatsApp (two-step
  // Graph media upload, server-side). Like a manual reply it pauses the bot; the
  // current draft (if any) rides along as the image caption. WhatsApp-only.
  const sendMediaMutation = useMutation({
    mutationFn: (form: FormData) =>
      api.upload(`/conversations/${conversationId}/send-media`, form),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const closeMutation = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const statusMutation = useMutation({
    mutationFn: (status: ConversationStatus) =>
      api.post(`/conversations/${conversationId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 5: hand a human-owned conversation back to the bot (status→open, unassign,
  // clear the bot-pause metadata). The one-click counterpart to the human takeover
  // that fires when a secretary replies; the bot then resumes auto-answering.
  const resumeBotMutation = useMutation({
    mutationFn: () => api.post(`/conversations/${conversationId}/resume-bot`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['messages', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  // Req 29: flag a bad bot reply → Admin Studio Error Review (bad_response).
  const flagMutation = useMutation({
    mutationFn: (message: Message) =>
      api.post(`/conversations/${conversationId}/flag-response`, {
        messageId: message.id,
        content: message.content,
      }),
    onSuccess: (_data, message) => {
      setFlaggedIds((prev) => new Set(prev).add(message.id))
    },
  })

  function onSend(e: FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (content) sendMutation.mutate(content)
  }

  // Validate the picked image client-side (mirrors the server: JPEG/PNG, ≤5 MB),
  // then send it with the current draft as an optional caption. The caption part is
  // appended before the file so the server reads it off file.fields.
  function onAttach(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file after an error
    if (!file) return
    if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setAttachError(true)
      return
    }
    setAttachError(false)
    const form = new FormData()
    const caption = draft.trim()
    if (caption) form.append('caption', caption)
    form.append('file', file)
    sendMediaMutation.mutate(form)
  }

  // Permission-denied — the selected thread belongs to a clinic/role the operator
  // can't read (e.g. an admin switched clinics, or a deep-link to a foreign thread).
  // A retry won't help, so show a dedicated locked state instead of the queue.
  if (
    conversationQuery.error instanceof ApiError &&
    (conversationQuery.error.status === 403 || conversationQuery.error.status === 404)
  ) {
    const forbidden = conversationQuery.error.status === 403
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span aria-hidden className="grid h-14 w-14 place-items-center rounded-2xl bg-gray-100 text-2xl text-gray-500 dark:bg-gray-800">
          {forbidden ? '🔒' : '🔎'}
        </span>
        <p className="text-sm font-semibold">
          {forbidden ? t('common.forbidden.title') : t('common.error')}
        </p>
        {forbidden && <p className="max-w-xs text-xs text-gray-500">{t('common.forbidden.body')}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Req 20: patient-safety banner — the loudest element in the thread when the
          workers have flagged a possible emergency or an urgent/upset patient, so a
          secretary can't miss it (the tag chips alone live in a side panel that's
          collapsed on mobile). */}
      <SafetyBanner conversationId={conversationId} />

      {/* Header */}
      <div className="crm-chat-header">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {/* Patient avatar. */}
          <span className="crm-conv-avatar" style={{ background: avatarColor(conversationId) }}>
            {avatarLabel(conversation?.patientName || conversation?.channelContactHandle)}
          </span>
          <div className="min-w-[12rem] flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="truncate text-[18px] font-extrabold text-[var(--crm-text-main)]">
                {conversation?.patientName || conversation?.channelContactHandle || '…'}
              </h3>
              {conversation?.channel === 'whatsapp' && (
                <span className="crm-whatsapp-tag">WhatsApp</span>
              )}
              {/* Mode pill (Req 5/6) — who is driving the thread. */}
              <span
                className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  humanMode
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
                }`}
              >
                {humanMode ? '●' : '✦'} {humanMode ? t('view.mode.human') : t('view.mode.bot')}
              </span>
            </div>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--crm-text-soft)]">
              {/* When the title shows the patient's name, surface the raw handle
                  (phone / IGSID) here so staff can still see/verify the number. */}
              {conversation?.patientName && (
                <>
                  <span className="truncate">{conversation.channelContactHandle}</span>
                  <span aria-hidden>·</span>
                </>
              )}
              {conversation && conversation.channel !== 'whatsapp' && (
                <span className={`inline-flex items-center gap-1 font-bold ${CHANNEL_META[conversation.channel].text}`}>
                  <span aria-hidden className={`h-2 w-2 rounded-full ${CHANNEL_META[conversation.channel].dot}`} />
                  {CHANNEL_META[conversation.channel].label}
                </span>
              )}
              {conversation?.lastMessageAt && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('view.lastSeen', { time: relativeTime(conversation.lastMessageAt) })}</span>
                </>
              )}
            </div>
          </div>

          <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <AssignControl conversationId={conversationId} />
            {conversation?.patientId && (
              <Link
                href={`/inbox/${conversationId}/patient`}
                className="rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-3 py-1.5 text-xs font-medium text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)]"
              >
                {t('patient.title')}
              </Link>
            )}
            {conversation && (
              <select
                aria-label={t('view.changeStatus')}
                value={conversation.status}
                onChange={(e) => statusMutation.mutate(e.target.value as ConversationStatus)}
                disabled={statusMutation.isPending}
                className="rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-2 py-1.5 text-xs font-medium hover:bg-[var(--crm-hover-bg)] disabled:opacity-60"
              >
                {(MANUAL_STATUSES.includes(conversation.status)
                  ? MANUAL_STATUSES
                  : [conversation.status, ...MANUAL_STATUSES]
                ).map((s) => (
                  <option key={s} value={s}>
                    {t(`conv.status.${s}` as const)}
                  </option>
                ))}
              </select>
            )}
            {/* Req 5: one-click return to the bot while a human owns the thread. */}
            {conversation && humanMode && !closed && (
              <button
                type="button"
                onClick={() => resumeBotMutation.mutate()}
                disabled={resumeBotMutation.isPending}
                className="rounded-full bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                ↩ {resumeBotMutation.isPending ? t('view.mode.resuming') : t('view.mode.resumeBot')}
              </button>
            )}
            {conversation && !closed && (
              <button
                type="button"
                onClick={() => closeMutation.mutate()}
                disabled={closeMutation.isPending}
                className="rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-3 py-1.5 text-xs font-medium text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] disabled:opacity-60"
              >
                {t('view.close')}
              </button>
            )}
          </div>
        </div>
        {conversation?.patientId && (
          <ApptSummary conversationId={conversationId} patientId={conversation.patientId} />
        )}
        {conversation && <KbCitations metadata={conversation.metadata} />}
      </div>

      {/* Req 5/6 — full-width mode strip directly under the header. The single
          loudest, always-visible cue for WHO is driving the thread: violet when the
          bot is auto-answering, emerald when a human has taken over (bot paused).
          Makes the handoff state unmistakable without scrolling to the composer. */}
      {conversation && !closed && (
        <div
          className={`flex shrink-0 items-center gap-2 px-4 py-2 text-[12px] font-medium ${
            humanMode
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
              : 'bg-violet-50 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200'
          }`}
        >
          <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${humanMode ? 'bg-emerald-500' : 'bg-violet-500'}`}
          />
          <span className="min-w-0 flex-1 truncate">
            {humanMode ? t('view.modeStrip.human') : t('view.modeStrip.bot')}
          </span>
          {humanMode && (
            <span className="hidden shrink-0 text-[11px] opacity-80 sm:inline">
              {t('view.modeStrip.humanRight')}
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="crm-chat-messages space-y-2.5">
        {messagesQuery.isLoading ? (
          <p className="text-sm text-gray-400">{t('common.loading')}</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400">{t('view.noMessages')}</p>
        ) : (
          (() => {
            // Req 5: mark the single moment the first human agent took the thread over
            // from the bot, rendered as a centred timeline marker.
            const firstAgentIdx = messages.findIndex((x) => x.role === 'agent')
            return messages.map((m, i) => {
              const prev = messages[i - 1]
              const newDay =
                !prev ||
                new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString()
              const ind = deliveryIndicator(m)
              return (
                <div key={m.id} className="contents">
                  {newDay && <DaySeparator label={formatDay(m.createdAt, language, t('view.today'))} />}
                  {i === firstAgentIdx && <CenterMarker>↪ {t('view.handoff')}</CenterMarker>}
                  <MessageBubble
                    message={m}
                    roleLabel={t(ROLE_LABEL[m.role])}
                    voiceLabel={t('view.voiceNote')}
                    flagLabel={t('view.flagResponse')}
                    flaggedLabel={t('view.flagged')}
                    flagged={flaggedIds.has(m.id)}
                    flagging={flagMutation.isPending && flagMutation.variables?.id === m.id}
                    onFlag={() => flagMutation.mutate(m)}
                    delivery={ind ? { glyph: ind.glyph, tone: ind.tone, label: t(ind.labelKey) } : null}
                    language={language}
                    conversationId={conversationId}
                    imageLabel={t('view.image')}
                    patientDisplayName={conversation?.patientName || conversation?.channelContactHandle || '?'}
                  />
                </div>
              )
            })
          })()
        )}
      </div>

      {/* Composer */}
      {closed ? (
        <p className="border-t border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
          {t('view.closedNotice')}
        </p>
      ) : (
        <div className="crm-chat-input-area">
          {/* Req 5/6 — the bot-paused cue now lives in the always-visible mode strip
              under the header (with the one-click Return-to-bot in the header
              actions), so the composer stays clean (matches the mockup). */}
          {/* Req 3: the reply is now delivered to the patient over the channel, so a
              failed send (expired token, send outside the 24h window) surfaces here —
              the draft is preserved so the secretary can retry. */}
          {(sendMutation.isError ||
            sendTemplateMutation.isError ||
            sendInteractiveMutation.isError ||
            sendListMutation.isError ||
            sendMediaMutation.isError) && (
            <p className="px-3 pt-2 text-xs font-medium text-red-600 dark:text-red-400">
              ⚠ {t('view.sendFailed')}
            </p>
          )}
          {attachError && (
            <p className="px-3 pt-2 text-xs font-medium text-red-600 dark:text-red-400">
              ⚠ {t('view.attachInvalid')}
            </p>
          )}
          {/* WhatsApp/Messenger-style composer: attachments, templates, list &
              button menus, and quick replies all live behind one ＋ button so the
              row stays clean — ＋ · 😀 · input · send. Each picker's own popover is
              fixed-positioned, so it opens centred above the composer, never
              clipped by the ＋ menu. */}
          <form onSubmit={onSend} className="flex min-w-0 flex-1 items-end gap-2">
            {/* ＋ tools menu */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setToolsOpen((v) => !v)}
                aria-label={t('view.tools')}
                title={t('view.tools')}
                aria-expanded={toolsOpen}
                className="crm-composer-icon-btn text-xl leading-none"
              >
                ＋
              </button>
              {toolsOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setToolsOpen(false)}
                    className="fixed inset-0 z-20 cursor-default"
                  />
                  <div className="absolute bottom-12 left-0 z-30 flex items-center gap-1 rounded-xl border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-1.5 shadow-[var(--crm-shadow-md)]">
                    <QuickReplyPicker
                      onPick={(content) => setDraft((d) => (d.trim() ? `${d}\n${content}` : content))}
                    />
                    {conversation?.channel === 'whatsapp' && (
                      <TemplatePicker
                        conversationId={conversationId}
                        onPick={(templateId) => sendTemplateMutation.mutate(templateId)}
                        disabled={sendTemplateMutation.isPending}
                      />
                    )}
                    {/* Req 3: tappable reply-button menu (WhatsApp only). */}
                    {conversation?.channel === 'whatsapp' && (
                      <InteractivePicker
                        onSend={(body, buttons) => sendInteractiveMutation.mutate({ body, buttons })}
                        disabled={sendInteractiveMutation.isPending}
                      />
                    )}
                    {/* Req 3: single-select LIST menu for >3 options (WhatsApp only). */}
                    {conversation?.channel === 'whatsapp' && (
                      <ListPicker
                        onSend={(body, button, sections) =>
                          sendListMutation.mutate({ body, button, sections })
                        }
                        disabled={sendListMutation.isPending}
                      />
                    )}
                    {/* Req 3: attach an image (WhatsApp only). */}
                    {conversation?.channel === 'whatsapp' && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={onAttach}
                        />
                        <button
                          type="button"
                          title={t('view.attachImage')}
                          aria-label={t('view.attachImage')}
                          onClick={() => fileInputRef.current?.click()}
                          disabled={sendMediaMutation.isPending}
                          className="crm-composer-icon-btn text-sm"
                        >
                          📎
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Emoji */}
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setEmojiOpen((v) => !v)}
                aria-label={t('view.emojiPicker')}
                title={t('view.emojiPicker')}
                className="crm-composer-icon-btn text-lg"
              >
                😀
              </button>
              {emojiOpen && (
                <>
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    onClick={() => setEmojiOpen(false)}
                    className="fixed inset-0 z-20 cursor-default"
                  />
                  {/* WhatsApp-style emoji panel: fixed-positioned (like the other
                      composer pickers) so it's never clipped by the composer's
                      overflow, a comfortable 8-column grid, and scrollable. */}
                  <div className="fixed bottom-24 left-4 right-4 z-30 max-h-[300px] overflow-y-auto rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-3 shadow-[var(--crm-shadow-md)] sm:right-auto sm:w-[352px]">
                    <div className="grid grid-cols-8 gap-1">
                      {EMOJI_SET.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => insertEmoji(emoji)}
                          className="grid h-9 w-9 place-items-center rounded-lg text-[20px] leading-none hover:bg-[var(--crm-hover-bg)]"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Input + send */}
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend(e)
                }
              }}
              rows={1}
              placeholder={t('view.placeholder')}
              enterKeyHint="send"
              autoCapitalize="sentences"
              className="max-h-32 min-h-[44px] min-w-0 flex-1 resize-none rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-4 py-3 text-sm outline-none transition focus:border-[var(--crm-primary-color)] focus:ring-4 focus:ring-[var(--crm-hover-bg)]"
            />
            <button
              type="submit"
              disabled={sendMutation.isPending || !draft.trim()}
              aria-label={t('view.send')}
              title={t('view.send')}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--crm-primary-color)] text-lg text-white transition hover:bg-[var(--crm-primary-hover)] disabled:opacity-60"
            >
              {sendMutation.isPending ? '…' : '➤'}
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

// Req 20: full-width patient-safety banner. Reuses the same ['tags', id] query as
// the TagsPanel (TanStack dedupes it) so it reflects worker-applied flags live and
// updates the instant a secretary clears the tag. Renders nothing when no safety
// tag is set. Critical (possible emergency) is red; warning (urgent/upset) is amber.
const SAFETY_BANNER: Record<
  SafetyLevel,
  { box: string; icon: string; titleKey: 'safety.critical.title' | 'safety.warning.title'; bodyKey: 'safety.critical.body' | 'safety.warning.body' }
> = {
  critical: {
    box: 'border-red-600 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/50 dark:text-red-200',
    icon: '🚨',
    titleKey: 'safety.critical.title',
    bodyKey: 'safety.critical.body',
  },
  warning: {
    box: 'border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-600 dark:bg-amber-950/40 dark:text-amber-200',
    icon: '⚠',
    titleKey: 'safety.warning.title',
    bodyKey: 'safety.warning.body',
  },
}

function SafetyBanner({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const tagsQuery = useQuery({
    queryKey: ['tags', conversationId],
    queryFn: () => api.get<{ tags: Tag[] }>(`/conversations/${conversationId}/tags`),
  })
  const level = assessSafety(tagsQuery.data?.tags?.map((tg) => tg.name)).level
  if (!level) return null
  const b = SAFETY_BANNER[level]
  return (
    <div
      role="alert"
      className={`flex shrink-0 items-start gap-2 border-b-2 px-4 py-2.5 text-sm ${b.box}`}
    >
      <span aria-hidden className="text-base leading-tight">{b.icon}</span>
      <div className="min-w-0">
        <p className="font-semibold">{t(b.titleKey)}</p>
        <p className="text-xs opacity-90">{t(b.bodyKey)}</p>
      </div>
    </div>
  )
}

// Req 4 / Req 16: surface the patient's appointment status in-thread so a
// secretary sees the next (or, failing that, the most recent) appointment without
// leaving the conversation. Picks the soonest upcoming non-cancelled appointment;
// if there is none, falls back to the most recent past one. Links to the full
// patient history. Best-effort: renders nothing while loading or on error.
function ApptSummary({ conversationId, patientId }: { conversationId: string; patientId: string }) {
  const { t, language } = useI18n()
  const appointmentsQuery = useQuery({
    queryKey: ['patient-appointments', patientId],
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/patients/${patientId}/appointments`),
  })

  if (appointmentsQuery.isLoading || appointmentsQuery.isError) return null
  const appointments = appointmentsQuery.data?.appointments ?? []

  const now = new Date().toISOString()
  // listByPatient returns appointments newest-first (start_time DESC).
  const upcoming = appointments
    .filter((a) => a.startTime >= now && a.status !== 'cancelled')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const next = upcoming[0]
  const last = appointments.find((a) => a.startTime < now)
  const appt = next ?? last
  const label = next ? t('view.appt.next') : t('view.appt.last')

  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-xs">
      <span aria-hidden>📅</span>
      {appt ? (
        <Link
          href={`/inbox/${conversationId}/patient`}
          className="flex items-center gap-2 hover:text-teal-600"
        >
          <span className="font-medium text-gray-500">{label}:</span>
          <span className="text-gray-600 dark:text-gray-300">{formatDateTime(appt.startTime, language)}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${APPT_BADGE[appt.status]}`}>
            {t(`appt.status.${appt.status}` as const)}
          </span>
        </Link>
      ) : (
        <span className="text-gray-400">{t('view.appt.none')}</span>
      )}
    </div>
  )
}

// ⑥ Citations (Rev 2): show which KB entries grounded the bot's most recent reply,
// so the secretary can trust + audit the answer. Renders nothing until the bot has
// answered from the KB (worker writes metadata.kbCitations).
function KbCitations({ metadata }: { metadata: Record<string, unknown> }) {
  const { t } = useI18n()
  const cites = (metadata as { kbCitations?: unknown }).kbCitations
  if (!Array.isArray(cites) || cites.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2 text-xs text-gray-500">
      <span aria-hidden>🔎</span>
      <span>{t('view.kbGrounded')}:</span>
      {(cites as string[]).slice(0, 4).map((c, i) => (
        <span
          key={i}
          className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:bg-teal-950 dark:text-teal-300"
        >
          {c}
        </span>
      ))}
    </div>
  )
}

// Tailwind classes per delivery tone (Req 3). `muted` rides the bubble's own text
// colour at low opacity (subtle ✓/✓✓), `read` is a blue double-check, `failed` red.
const DELIVERY_TONE: Record<DeliveryTone, string> = {
  muted: 'opacity-70',
  read: 'text-sky-500 dark:text-sky-400',
  failed: 'text-red-600 dark:text-red-400',
}

// A centred day pill between message groups.
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="my-1.5 flex justify-center">
      <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-[11px] font-semibold text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {label}
      </span>
    </div>
  )
}

// A centred timeline marker (e.g. the bot→human handoff).
function CenterMarker({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-1.5 flex justify-center">
      <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        {children}
      </span>
    </div>
  )
}

function MessageBubble({
  message,
  roleLabel,
  voiceLabel,
  flagLabel,
  flaggedLabel,
  flagged,
  flagging,
  onFlag,
  delivery,
  language,
  conversationId,
  imageLabel,
  patientDisplayName,
}: {
  message: Message
  roleLabel: string
  voiceLabel: string
  flagLabel: string
  flaggedLabel: string
  flagged: boolean
  flagging: boolean
  onFlag: () => void
  delivery: { glyph: string; tone: DeliveryTone; label: string } | null
  language: 'es' | 'en'
  conversationId: string
  imageLabel: string
  patientDisplayName: string
}) {
  // Patient messages on the left; clinic (agent/bot/system) on the right.
  const fromPatient = message.role === 'user'
  const isBot = message.role === 'assistant'
  const isHuman = message.role === 'agent'
  // Only the bot's own replies can be flagged as a bad response (Req 29).
  const canFlag = isBot
  // Voice note (Req 8): a transcribed audio message shows a 🎤 marker above its
  // transcript so the secretary knows the patient spoke rather than typed.
  const isVoiceNote = message.contentType === 'audio'
  // Image (Req 3): a patient's photo is rendered inline; the message content, if any,
  // is the caption shown beneath it.
  const isImage = isImageMessage(message)
  const transcript = message.transcription ?? message.content

  // Bubble skin per author: patient = plain white card (left); bot = white card with
  // a violet rail; human secretary = the teal brand bubble; system = a muted card.
  const skin = fromPatient
    ? 'crm-message'
    : isBot
      ? 'crm-message crm-ai-suggested'
      : isHuman
        ? 'crm-message crm-message-sent'
        : 'crm-message bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-300'
  const metaTone = isHuman ? 'text-teal-50/90' : 'text-gray-400'

  const senderName = fromPatient ? patientDisplayName : roleLabel
  const senderSeed = fromPatient ? conversationId : `staff-${message.role}`
  const senderInitials = fromPatient ? avatarLabel(patientDisplayName) : isBot ? '✦' : '●'

  return (
    <div className={`group flex ${fromPatient ? 'justify-start' : 'justify-end'}`}>
      <div className={`relative text-[12px] ${skin} ${flagged ? 'outline outline-2 outline-red-500' : ''}`}>
        {/* Sender row — mini avatar + name + who's driving (bot/human) for clinic
            replies, matching the reskin's spec. */}
        <div className={`crm-sender-row ${isHuman ? '!text-teal-50/80' : ''} ${fromPatient ? '' : 'flex-row-reverse justify-end'}`}>
          <span
            className="crm-sender-avatar"
            style={{ background: fromPatient ? avatarColor(senderSeed) : isBot ? '#7C3AED' : '#5C5D60' }}
          >
            {senderInitials}
          </span>
          <span className="font-semibold">{senderName}</span>
          <span aria-hidden className="opacity-70">{formatTime(message.createdAt, language)}</span>
        </div>
        {isVoiceNote && (
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium opacity-80">
            <span aria-hidden>🎤</span>
            <span>{voiceLabel}</span>
          </div>
        )}
        {isImage && (
          <MessageImage conversationId={conversationId} messageId={message.id} alt={imageLabel} />
        )}
        {/* Image messages show their caption (if any) below the image; non-image
            messages show their text/transcript. */}
        {(!isImage || transcript) && <p className="whitespace-pre-wrap break-words">{transcript}</p>}

        <div className={`mt-1 flex items-center gap-1.5 text-[11px] ${metaTone}`}>
          <span>{formatTime(message.createdAt, language)}</span>
          {delivery && (
            <span
              className={`flex items-center gap-1 font-semibold ${isHuman && delivery.tone !== 'failed' ? 'text-teal-50' : DELIVERY_TONE[delivery.tone]}`}
              title={delivery.label}
            >
              <span aria-hidden>{delivery.glyph}</span>
              {delivery.tone === 'failed' && <span>{delivery.label}</span>}
              <span className="sr-only">{delivery.label}</span>
            </span>
          )}
          {canFlag &&
            (flagged ? (
              <span className="ml-auto font-semibold text-red-600 dark:text-red-400">⚑ {flaggedLabel}</span>
            ) : (
              <button
                type="button"
                onClick={onFlag}
                disabled={flagging}
                title={flagLabel}
                aria-label={flagLabel}
                className="ml-auto font-medium text-gray-400 opacity-100 transition hover:text-red-600 focus-visible:opacity-100 disabled:opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 dark:hover:text-red-400"
              >
                ⚑ {flagLabel}
              </button>
            ))}
        </div>
      </div>
    </div>
  )
}

// Inbound image (Req 3): fetch the patient's photo through the authenticated proxy
// (the browser can't set the bearer header on a plain <img src>) as a blob, render
// it from an object URL, and revoke the URL on unmount. Shows a placeholder while
// loading and a fallback marker if the fetch fails (e.g. an expired Meta media id).
function MessageImage({
  conversationId,
  messageId,
  alt,
}: {
  conversationId: string
  messageId: string
  alt: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    api
      .blobUrl(messageMediaPath(conversationId, messageId))
      .then((u) => {
        if (!active) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [conversationId, messageId])

  if (failed) {
    return (
      <div className="my-1 flex items-center gap-1 rounded-lg bg-black/5 px-2 py-3 text-[11px] opacity-70 dark:bg-white/10">
        <span aria-hidden>🖼️</span>
        <span>{alt} ⚠</span>
      </div>
    )
  }
  if (!url) {
    return <div className="my-1 h-32 w-48 max-w-full animate-pulse rounded-lg bg-black/5 dark:bg-white/10" />
  }
  // A blob object URL (not a static/remote asset), so next/image can't optimise it.
  return <img src={url} alt={alt} className="my-1 max-h-64 max-w-full rounded-lg" />
}
