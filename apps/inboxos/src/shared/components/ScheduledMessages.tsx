'use client'

import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { captureReviewSession, useReviewGeneration } from '../api/reviewSession'
import { scheduledRequest } from '../api/scheduledSession'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { consumedScheduledDraft, formatClinicInput, scheduledMessageKey, scheduleRequest, type ScheduleForm, type ScheduledMessage } from '../scheduledMessages'
import type { MessageTemplate } from '../types'

const button = 'min-h-11 rounded-lg border border-[var(--crm-border-color)] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--crm-primary-color)] disabled:opacity-50'
const input = 'w-full rounded-lg border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-3 py-2 text-sm'
type Result = { enabled: boolean; timezone: string; messages: ScheduledMessage[] }
const knownStatuses = new Set(['pending', 'sending', 'sent', 'cancelled', 'blocked', 'failed', 'delivery_unknown'])
type SaveAttempt = { payload: ReturnType<typeof scheduleRequest>; key: string; original: string }

export function ScheduledMessageList({ messages, enabled, busy, onEdit, onCancel }: {
  messages: ScheduledMessage[]; enabled: boolean; busy: boolean
  onEdit: (message: ScheduledMessage) => void; onCancel: (message: ScheduledMessage) => void
}) {
  const { t } = useI18n()
  const active = messages.filter(m => m.status !== 'sent' && m.status !== 'cancelled')
  const history = messages.filter(m => m.status === 'sent' || m.status === 'cancelled')
  const rows = (items: ScheduledMessage[]) => items.map(message => <li key={message.id} className="rounded-lg border border-[var(--crm-border-color)] p-2">
        <p className="break-words">{message.kind === 'text' ? message.content : t('schedule.template')}</p>
        <p className="text-xs"><time dateTime={message.scheduledAt}>{formatClinicInput(message.scheduledAt, message.timezone).replace('T', ' ')}</time> · {message.timezone}</p>
        <p className="text-xs font-semibold">{t(`schedule.status.${knownStatuses.has(message.status) ? message.status : 'blocked'}`)}</p>
        {message.status === 'delivery_unknown' && <p className="text-xs">{t('schedule.unknownHelp')}</p>}
        {(message.status === 'blocked' || message.status === 'failed') && <p className="text-xs">{t('schedule.blockedHelp')}</p>}
        {message.status === 'pending' && <div className="mt-1 flex gap-2">
          {enabled && <button type="button" className={button} disabled={busy} onClick={() => onEdit(message)}>{t('schedule.edit')}</button>}
          <button type="button" className={button} disabled={busy} onClick={() => onCancel(message)}>{t('schedule.cancel')}</button>
        </div>}
      </li>)
  return <details className="shrink-0 border-t border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-3 py-2 text-sm">
    <summary className="cursor-pointer font-semibold">{t('schedule.title')} ({messages.filter(m => m.status === 'pending').length})</summary>
    <ul className="max-h-60 space-y-2 overflow-y-auto pt-2">
      {active.length === 0 && <li>{t('schedule.empty')}</li>}
      {rows(active)}
    </ul>
    {history.length > 0 && <details className="pt-2"><summary className="cursor-pointer">{t('schedule.history')}</summary><ul className="max-h-40 space-y-2 overflow-y-auto pt-2">{rows(history)}</ul></details>}
  </details>
}

export function ScheduledMessages({ clinicId, conversationId, draft, open, onClose, onCreated }: {
  clinicId: string; conversationId: string; draft: string; open: boolean
  onClose: () => void; onCreated: (originalDraft: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<ScheduledMessage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const generation = useReviewGeneration()
  const previousGeneration = useRef(generation)
  const createAttempt = useRef<SaveAttempt | null>(null)
  const sessionChanged = previousGeneration.current !== generation
  useEffect(() => {
    if (previousGeneration.current === generation) return
    previousGeneration.current = generation
    createAttempt.current = null
    setEditing(null); setError(false); onClose()
  }, [generation, onClose])
  const session = captureReviewSession(clinicId)
  const key = [...scheduledMessageKey(clinicId, conversationId), generation]
  const query = useQuery({ queryKey: key, queryFn: () => scheduledRequest<Result>(conversationId, session), enabled: Boolean(clinicId), refetchInterval: 15000, retry: false })
  const sent = query.data?.messages.filter(message => message.status === 'sent').map(message => message.id).sort().join(',') ?? ''
  useEffect(() => {
    if (!sent) return
    void qc.invalidateQueries({ queryKey: ['messages', conversationId] })
    void qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
    void qc.invalidateQueries({ queryKey: ['conversations'] })
  }, [sent, conversationId, qc])
  const currentClinic = () => { const auth = useAuthStore.getState(); return (auth.activeClinicId ?? auth.user?.clinicId) === clinicId }
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }) }
  const close = () => { setEditing(null); onClose(); refresh() }
  const cancel = async (message: ScheduledMessage) => {
    if (!currentClinic() || !window.confirm(t('schedule.confirmCancel'))) return
    setBusy(true); setError(false)
    try { await scheduledRequest(conversationId, session, `/${message.id}/cancel`, 'POST', { version: message.version }) }
    catch { setError(true) }
    finally { setBusy(false); refresh() }
  }
  return <>
    {query.data && (query.data.enabled || query.data.messages.length > 0) && <ScheduledMessageList messages={query.data.messages} enabled={query.data.enabled} busy={busy} onEdit={setEditing} onCancel={cancel} />}
    {error && <p role="alert" className="px-3 text-sm">{t('schedule.changeFailed')}</p>}
    {!sessionChanged && (open || editing) && <ScheduleDialog key={`${generation}:${editing?.id ?? 'new'}`} createAttempt={createAttempt} clinicId={clinicId} conversationId={conversationId} initialDraft={draft} existing={editing} data={query.data} loading={query.isPending} onClose={close} onSaved={original => {
      refresh(); if (!mounted.current) return
      close(); if (!editing && original !== null && currentClinic()) onCreated(original)
    }} />}
  </>
}

function ScheduleDialog({ clinicId, conversationId, initialDraft, existing, data, loading, onClose, onSaved, createAttempt }: {
  clinicId: string; conversationId: string; initialDraft: string; existing: ScheduledMessage | null; data?: Result; loading: boolean
  onClose: () => void; onSaved: (original: string | null) => void; createAttempt: RefObject<SaveAttempt | null>
}) {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  const editAttempt = useRef<SaveAttempt | null>(null)
  const attempt = existing ? editAttempt : createAttempt
  const saved = attempt.current?.payload
  const [form, setForm] = useState({ kind: saved?.kind ?? existing?.kind ?? 'text', content: saved?.content ?? existing?.content ?? initialDraft, templateId: saved?.templateId ?? existing?.templateId ?? '', localTime: saved ? formatClinicInput(saved.scheduledAt, saved.timezone) : existing ? formatClinicInput(existing.scheduledAt, existing.timezone) : '' })
  const [error, setError] = useState(saved ? 'saveUnknown' : '')
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(Boolean(attempt.current))
  const original = useRef(initialDraft)
  const session = useRef(captureReviewSession(clinicId)).current
  const timezone = saved?.timezone ?? data?.timezone ?? existing?.timezone ?? ''
  const templates = useQuery({ queryKey: ['scheduled-message-templates', clinicId, conversationId, session.generation], queryFn: () => scheduledRequest<{ templates: MessageTemplate[] }>(conversationId, session, '/templates'), enabled: form.kind === 'template' && data?.enabled === true, retry: false })
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close() }, [])
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const auth = useAuthStore.getState()
    if ((auth.activeClinicId ?? auth.user?.clinicId) !== clinicId || (!data?.enabled && !attempt.current) || busy) return
    setError('')
    let payload: ReturnType<typeof scheduleRequest>
    try { payload = attempt.current?.payload ?? scheduleRequest({ ...form, timezone } as ScheduleForm) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'invalidTime'); return }
    if (!attempt.current) attempt.current = { payload, key: crypto.randomUUID(), original: original.current }
    setBusy(true)
    try {
      if (existing) await scheduledRequest(conversationId, session, `/${existing.id}`, 'PATCH', { ...payload, version: existing.version })
      else await scheduledRequest(conversationId, session, '', 'POST', { ...payload, idempotencyKey: attempt.current.key })
      const consumed = consumedScheduledDraft(payload, attempt.current.original)
      attempt.current = null
      onSaved(consumed)
    } catch (cause) {
      // A lost response may have committed. Keep the original key and payload for a safe retry.
      const ambiguous = uncertain || !(cause instanceof ApiError) || cause.status >= 500
      setUncertain(ambiguous)
      setError(ambiguous ? 'saveUnknown' : 'saveFailed')
      if (!ambiguous) attempt.current = null
    } finally { setBusy(false) }
  }
  return <dialog ref={dialog} aria-labelledby="schedule-heading" onCancel={event => { if (busy) event.preventDefault(); else onClose() }} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-5 text-[var(--crm-text-primary)] shadow-xl backdrop:bg-black/40">
    <div className="flex items-center justify-between gap-3"><h2 id="schedule-heading" className="text-lg font-semibold">{t(existing ? 'schedule.edit' : 'schedule.create')}</h2><button className={button} type="button" disabled={busy} onClick={onClose} aria-label={t('schedule.close')}>×</button></div>
    {loading ? <p role="status">{t('schedule.loading')}</p> : !data?.enabled && !attempt.current ? <p>{t('schedule.disabled')}</p> : <form onSubmit={submit} className="mt-3 space-y-3">
      <p id="schedule-help" className="text-sm">{t('schedule.help')}</p>
      <fieldset disabled={busy || uncertain} className="space-y-3">
        <label className="block">{t('schedule.kind')}<select className={input} value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value as 'text' | 'template' })}><option value="text">{t('schedule.text')}</option><option value="template">{t('schedule.template')}</option></select></label>
        {form.kind === 'text' ? <label className="block">{t('schedule.content')}<textarea className={input} rows={4} maxLength={4096} required value={form.content} onChange={event => setForm({ ...form, content: event.target.value })} /></label> : <label className="block">{t('schedule.template')}<select className={input} required value={form.templateId} onChange={event => setForm({ ...form, templateId: event.target.value })}><option value="">{t('schedule.selectTemplate')}</option>{templates.data?.templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><span className="text-xs">{t(templates.isError ? 'schedule.templateLoadFailed' : 'schedule.templateHelp')}</span></label>}
        <label className="block">{t('schedule.when')}<input className={input} type="datetime-local" required value={form.localTime} onChange={event => setForm({ ...form, localTime: event.target.value })} aria-describedby="schedule-zone schedule-help" /></label>
        <p id="schedule-zone" className="text-sm">{t('schedule.timezone')}: {timezone}</p>
      </fieldset>
      {error && <p role="alert" className="text-sm font-semibold">{t(`schedule.${error}`)}</p>}
      <button type="submit" disabled={busy} className={`${button} bg-[var(--crm-primary-color)] text-white`}>{t(busy ? 'schedule.saving' : uncertain ? 'schedule.checkSave' : 'schedule.save')}</button>
    </form>}
  </dialog>
}
