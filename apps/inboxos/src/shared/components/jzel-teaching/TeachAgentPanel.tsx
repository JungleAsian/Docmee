'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { useAuthStore } from '../../store/auth'
import { ClinicSelect } from '../ClinicSelect'
import { teachingCopy, type TeachingCopy } from './copy'
import type { Preview, Proposal, Status, TeachingOptions } from './types'
import { ResponseDiagnostics } from './ResponseDiagnostics'

const field = 'w-full rounded border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] p-2 text-xs'
const button = 'rounded border border-[var(--crm-border-color)] px-3 py-2 text-xs font-semibold disabled:opacity-50'
const primary = button + ' bg-[var(--crm-primary-color)] text-white'

export function TeachAgentPanel({ initialClinicId }: { initialClinicId: string }) {
  const user = useAuthStore(s => s.user)
  const language = useAuthStore(s => s.language)
  const c = teachingCopy[language === 'es' ? 'es' : 'en']
  const [clinicId, setClinicId] = useState(initialClinicId)
  return <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 text-xs text-[var(--crm-text-main)]">
    <p>{c.intro}</p>
    {user?.role === 'ia_studio_admin' && <ClinicSelect value={clinicId} onChange={setClinicId} label={c.clinic} />}
    {clinicId && <TeachingScope key={clinicId} clinicId={clinicId} c={c} />}
  </div>
}

function TeachingScope({ clinicId, c }: { clinicId: string; c: TeachingCopy }) {
  const [options, setOptions] = useState<TeachingOptions | null>(null)
  const [error, setError] = useState('')
  const [doctorId, setDoctorId] = useState('')
  const [language, setLanguage] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setError('')
    api.get<TeachingOptions>(`/clinics/${clinicId}/kb/teaching/options`).then(data => { if (active) setOptions(data) })
      .catch(() => { if (active) setError(c.error) })
    return () => { active = false }
  }, [clinicId, c.error, attempt])
  if (error) return <div role="alert">{error} <button className={button} onClick={() => setAttempt(v => v + 1)}>{c.refresh}</button></div>
  if (!options) return <p role="status">{c.loading}</p>
  return <div className="space-y-3">
    <p className="rounded bg-[var(--crm-hover-bg)] p-2"><strong>{c.clinic}: {options.clinic.name}</strong></p>
    <button className={button} onClick={() => setAttempt(v => v + 1)}>{c.refresh}</button>
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-semibold">{c.scope}</legend>
      <label>{c.doctor}<select className={field} value={doctorId} onChange={e => setDoctorId(e.target.value)}>
        <option value="">{c.allDoctors}</option>{options.doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select></label>
      <label>{c.language}<select className={field} value={language} onChange={e => setLanguage(e.target.value)}>
        <option value="">{c.allLanguages}</option><option value="en">English</option><option value="es">Español</option>
      </select></label>
    </fieldset>
    <TeachingEditor key={`${doctorId}:${language}`} options={options} doctorId={doctorId} language={language} c={c} />
  </div>
}

function TeachingEditor({ options, doctorId, language, c }: {
  options: TeachingOptions; doctorId: string; language: string; c: TeachingCopy
}) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [target, setTarget] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [restoreId, setRestoreId] = useState('')
  const [restoreConfirmed, setRestoreConfirmed] = useState(false)
  const [recent, setRecent] = useState<Array<{ id: string; title: string; doctorId: string | null; language: string | null; status: string }>>([])
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  const clinicId = options.clinic.id
  const base = `/clinics/${clinicId}/kb/teaching`
  const scope = { doctorId: doctorId || null, language: language || null }
  useEffect(() => {
    let active = true
    api.get<typeof recent>(`${base}/drafts`).then(data => { if (active) setRecent(data) }).catch(() => {})
    return () => { active = false }
  }, [base, status?.candidate.id, status?.candidate.revision, proposal?.candidate.id])
  const documents = options.documents.filter(d => (d.metadata.doctorId ?? '') === doctorId && (d.metadata.language ?? '') === language)
  const candidate = status?.candidate ?? proposal?.candidate
  const published = candidate?.status === 'approved'
  const expired = Boolean(candidate?.expiresAt && Date.parse(candidate.expiresAt) <= Date.now())

  async function run(work: () => Promise<void>) {
    if (busy) return
    setBusy(true); setError('')
    try { await work() } catch (e) {
      if (live.current) setError(c.errors[e instanceof Error ? e.message : ''] ?? c.error)
    } finally { if (live.current) setBusy(false) }
  }
  async function refresh(id: string) {
    const data = await api.get<Status>(`${base}/drafts/${id}`)
    if (live.current) setStatus(data)
  }
  // Poll only while indexing is pending. Scope changes unmount this editor and discard stale responses.
  useEffect(() => {
    if (!candidate || status?.availability !== 'approved') return
    let active = true
    let polls = 0
    const timer = setInterval(() => {
      if (++polls > 40) { clearInterval(timer); return }
      api.get<Status>(`${base}/drafts/${candidate.id}`).then(data => {
        if (active) setStatus(data)
      }).catch(() => { /* Manual refresh remains available. */ })
    }, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [base, candidate?.id, status?.availability])

  function clearProposal() {
    setProposal(null); setStatus(null); setConfirmed(false); setPreview(null); setRestoreId(''); setRestoreConfirmed(false)
  }
  async function publish(action: 'approve' | 'rollback', historyId?: string) {
    if (!candidate) return
    const result = await api.post<{ candidate: Status['candidate'] }>(`/clinics/${clinicId}/kb/learning/candidates/${candidate.id}/review`, {
      action, expectedRevision: candidate.revision, staffConfirmed: true, ...(historyId ? { historyId } : {}),
    })
    if (!live.current) return
    // Publication succeeded even if the following status refresh fails.
    setStatus({ candidate: result.candidate, availability: 'approved', indexingStatus: 'pending', history: status?.history ?? [] })
    setPreview(null); setConfirmed(false); setRestoreConfirmed(false); setRestoreId('')
    await refresh(result.candidate.id)
  }
  const restore = status?.history.find(h => h.id === restoreId)
  return <div className="space-y-4">
    {!proposal && !status && recent.some(item => (item.doctorId ?? '') === doctorId && (item.language ?? '') === language) &&
      <label className="block">{c.recent}<select className={field} value="" disabled={busy} onChange={e => {
        const id = e.target.value
        if (id) void run(async () => {
          const data = await api.get<Status>(`${base}/drafts/${id}`)
          if (!live.current) return
          setStatus(data); setProposal({ candidate: data.candidate, related: data.related ?? [], previous: data.previous ?? null })
          setTitle(data.candidate.originalSource.title ?? ''); setContent(data.candidate.candidateContent)
          setTarget(data.candidate.publishedDocumentId ?? '')
          setConfirmed(false)
        })
      }}><option value="">{c.resume}</option>
        {recent.filter(item => (item.doctorId ?? '') === doctorId && (item.language ?? '') === language)
          .map(item => <option key={item.id} value={item.id}>{item.title} · {item.status === 'approved' ? c.status : c.draft}</option>)}
      </select></label>}
    {!proposal && !status ? <form className="space-y-3" onSubmit={e => {
      e.preventDefault()
      void run(async () => {
        const doc = documents.find(d => d.id === target)
        const data = await api.post<Proposal>(`${base}/drafts`, { ...scope, title, content,
          ...(doc ? { targetDocumentId: doc.id, targetVersion: doc.version } : {}) })
        if (live.current) { setProposal(data); setConfirmed(false); setPreview(null) }
      })
    }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block">{c.target}<select className={field} value={target} onChange={e => {
          setTarget(e.target.value)
          const doc = documents.find(d => d.id === e.target.value)
          setTitle(doc?.title ?? '')
        }}><option value="">{c.newEntry}</option>{documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>
        {options.documentsTruncated && <p>{c.limited}</p>}
        <label className="block">{c.title}<input className={field} required maxLength={200} value={title} readOnly={Boolean(target)} onChange={e => setTitle(e.target.value)} /></label>
        <label className="block">{c.content}<textarea className={field} rows={5} required maxLength={12000} value={content} onChange={e => setContent(e.target.value)} /></label>
        <p className="text-[var(--crm-text-muted)]">{c.privacy}</p>
        <button className={primary} disabled={busy || !title.trim() || !content.trim()}>{busy ? c.busy : c.create}</button>
      </fieldset>
    </form> : <section className="space-y-3" aria-label={c.proposed}>
      <p role="status" className="font-semibold">{published ? c.status : c.draft}</p>
      <p className="rounded bg-[var(--crm-hover-bg)] p-2">
        <strong>{options.clinic.name}</strong> · {options.doctors.find(d => d.id === doctorId)?.name ?? c.allDoctors} · {language === 'en' ? 'English' : language === 'es' ? 'Español' : c.allLanguages}
      </p>
      {candidate?.expiresAt && !published && <p>{c.expires}: {new Date(candidate.expiresAt).toLocaleString()}</p>}
      {proposal?.previous && <details><summary>{c.previous} · v{proposal.previous.version}</summary><p className="whitespace-pre-wrap break-words p-2">{proposal.previous.content}</p></details>}
      <div className="rounded border border-[var(--crm-border-color)] p-3">
        <strong>{candidate?.originalSource.title}</strong><p className="mt-2 whitespace-pre-wrap break-words">{candidate?.candidateContent}</p>
      </div>
      {!published && <>
        <h3 className="font-semibold">{c.related}</h3><p>{c.warning}</p>
        {proposal?.related.length ? proposal.related.map((m, i) => <details key={`${m.documentId}:${i}`}>
          <summary>{m.title} · v{m.documentVersion}</summary><p className="whitespace-pre-wrap break-words p-2">{m.content}</p>
        </details>) : <p>{c.none}</p>}
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />{c.confirm}</label>
        <div className="flex flex-wrap gap-2">
          <button className={primary} disabled={!confirmed || busy || expired} onClick={() => void run(() => publish('approve'))}>{busy ? c.busy : c.approve}</button>
          <button className={button} disabled={busy} onClick={clearProposal}>{c.edit}</button>
        </div>
      </>}
      {published && <>
        <p role="status">{c[status?.availability as 'ready'|'approved'|'indexing_failed'|'superseded'] ?? c.approved}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={busy} onClick={() => void run(() => refresh(candidate!.id))}>{c.refresh}</button>
          {['indexing_failed', 'approved'].includes(status?.availability ?? '') && <button className={button} disabled={busy} onClick={() => void run(async () => {
            // The review endpoint supports replay of the committed approval to repair an interrupted enqueue.
            await api.post(`/clinics/${clinicId}/kb/learning/candidates/${candidate!.id}/review`, {
              action: 'approve', expectedRevision: candidate!.revision - 1, staffConfirmed: true,
            })
            await refresh(candidate!.id)
          })}>{c.retry}</button>}
          <button className={button} disabled={busy} onClick={() => { clearProposal(); setTitle(''); setContent(''); setTarget('') }}>{c.newLesson}</button>
        </div>
        <details><summary>{c.history}</summary>
          {(status?.history ?? []).filter(h => ['approve', 'rollback'].includes(h.action)).map(h => <div key={h.id} className="my-2 rounded border border-[var(--crm-border-color)] p-2">
            <p>v{h.documentVersion} · {new Date(h.createdAt).toLocaleString()}</p><p className="whitespace-pre-wrap break-words">{h.content}</p>
            {h.documentVersion !== candidate?.publishedDocumentVersion && <button className={button} disabled={busy} onClick={() => { setRestoreId(h.id); setRestoreConfirmed(false) }}>{c.restore}</button>}
          </div>)}
          {restore && <div className="space-y-2"><p className="whitespace-pre-wrap">{restore.content}</p>
            <label className="flex gap-2"><input type="checkbox" checked={restoreConfirmed} onChange={e => setRestoreConfirmed(e.target.checked)} />{c.restoreConfirm}</label>
            <button className={primary} disabled={!restoreConfirmed || busy} onClick={() => void run(() => publish('rollback', restore.id))}>{c.restore}</button>
          </div>}
        </details>
      </>}
    </section>}
    <section className="space-y-2 border-t border-[var(--crm-border-color)] pt-3" aria-label={c.preview}>
      <h3 className="font-semibold">{c.preview}</h3><p>{c.previewHint}</p>
      {!options.nodes.length ? <p>{c.noNode}</p> : <>
        <label className="block">{c.workflow}<select className={field} value={nodeKey} disabled={busy} onChange={e => { setNodeKey(e.target.value); setPreview(null) }}>
          <option value="">—</option>{options.nodes.map((n, i) => <option key={i} value={String(i)}>{n.name} ({n.status})</option>)}
        </select></label>
        <label className="block">{c.question}<textarea className={field} rows={2} maxLength={2000} disabled={busy} value={question} onChange={e => { setQuestion(e.target.value); setPreview(null) }} /></label>
        <button className={button} disabled={busy || !question.trim() || nodeKey === ''} onClick={() => void run(async () => {
          const node = options.nodes[Number(nodeKey)]
          if (!node) return
          const data = await api.post<Preview>(`${base}/preview`, { ...scope, question, workflowId: node.workflowId, nodeId: node.nodeId })
          if (live.current) setPreview(data)
        })}>{busy ? c.busy : c.test}</button>
        {preview && <div role="status" className="space-y-2 rounded bg-[var(--crm-hover-bg)] p-3">
          <strong>{c.outcome}: {c[preview.action as 'reply'|'route'|'handoff'|'no_match'] ?? preview.action}</strong>
          <p className="whitespace-pre-wrap">{preview.answer || c.emptyAnswer}</p>
          {preview.reason && <p>{preview.reason}</p>}
          <ResponseDiagnostics diagnostics={preview.diagnostics} c={c} />
        </div>}
      </>}
    </section>
    {error && <p role="alert" className="rounded border border-red-400 p-2 text-red-700 dark:text-red-300">{error}</p>}
    <a href="/studio/kb" className="inline-block underline">{c.openKb}</a>
  </div>
}
