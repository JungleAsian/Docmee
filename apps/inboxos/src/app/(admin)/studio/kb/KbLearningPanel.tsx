'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { captureReviewSession, reviewApi, useReviewGeneration, type ReviewSession } from '@/shared/api/reviewSession'
import { useI18n } from '@/shared/hooks/useI18n'
import { trainingInfo } from '@/shared/kbTraining'
import { candidateNeedsRevalidation, learningCopy, matchesLearningSearch, reviewCommand, reviewUnavailable, rollbackSnapshots, scorePercent, type CandidateStatus, type LearningCandidate, type LearningCitation, type LearningEvidence, type LearningEvent, type LearningGap, type LearningHistory, type LearningSettings, type ReviewCommand, type ReviewResult } from '@/shared/kbLearning'
import type { KnowledgeDocument, PanelLanguage } from '@/shared/types'

type Copy = (typeof learningCopy)[PanelLanguage]
type Tab = 'candidates' | 'events' | 'gaps' | 'settings'
const button = 'border border-gray-400 px-3 py-2 text-sm disabled:opacity-50 dark:border-gray-600'
const field = 'w-full border border-gray-400 bg-transparent p-2 text-sm dark:border-gray-600'
// Temporary patient evidence is never persisted to storage and is discarded when
// its clinic-keyed view unmounts. Failed writes are never automatically retried.
const temporaryQuery = { gcTime: 0, staleTime: 0, retry: false, refetchInterval: 60_000 }

export function EvidenceView({ evidence, copy }: { evidence: LearningEvidence; copy: Copy }) {
  const values = [
    [copy.relevance, scorePercent(evidence?.relevance) ?? copy.unknown],
    [copy.confidence, scorePercent(evidence?.confidence) ?? copy.unknown],
    [copy.grounding, scorePercent(evidence?.grounding) ?? copy.unknown],
    [copy.contradiction, evidence?.contradiction ?? copy.unknown],
    [copy.risks, evidence?.risks?.length ? evidence.risks.join(', ') : copy.unknown],
    [copy.scope, `${evidence?.doctorId ?? '—'} / ${evidence?.language ?? '—'}`],
  ]
  return <dl className="grid gap-2 text-sm sm:grid-cols-2">{values.map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl>
}

export function CandidateEvidenceView({ candidate, content, copy }: { candidate: LearningCandidate; content: string; copy: Copy }) {
  const changed = candidateNeedsRevalidation(candidate, content)
  return <section className="space-y-3" aria-label={copy.currentValidation}>
    {changed && <p role="alert" className="border border-amber-500 p-3">{copy.revalidation}</p>}
    <h4 className="font-semibold">{copy.currentValidation}</h4>
    <dl className="grid gap-2 text-sm sm:grid-cols-2">
      <div><dt>{copy.confidence}</dt><dd>{changed ? copy.unknown : scorePercent(candidate.confidenceScore) ?? copy.unknown}</dd></div>
      <div><dt>{copy.grounding}</dt><dd>{content !== (candidate.humanEdit ?? candidate.candidateContent) ? copy.unknown : scorePercent(candidate.groundingScore) ?? copy.unknown}</dd></div>
      <div><dt>{copy.contradiction}</dt><dd>{changed || !candidate.contradictionFree ? copy.notPassed : copy.passed}</dd></div>
    </dl>
    <details><summary>{copy.historicalEvidence}</summary><EvidenceView evidence={candidate.evidence} copy={copy} />
      <p className="text-sm">{copy.medical}: {candidate.medicalSafetyOk ? copy.passed : copy.notPassed} · {copy.prompt}: {candidate.promptSafetyOk ? copy.passed : copy.notPassed}</p>
    </details>
  </section>
}

function Citations({ citations, documents, copy, label = copy.citations }: { citations: LearningCitation[]; documents: KnowledgeDocument[]; copy: Copy; label?: string }) {
  return <details><summary className="cursor-pointer font-semibold">{label} ({citations.length})</summary>
    {!citations.length && <p>{copy.noCitations}</p>}
    <ul className="max-h-64 space-y-3 overflow-y-auto p-2 text-xs">{citations.slice(0, 5).map((citation, index) => {
      const source = documents.find(doc => doc.id === citation.documentId && doc.version === citation.documentVersion)
      return <li key={`${citation.chunkId}:${index}`} className="break-words border p-2">
        <p>{citation.documentId} · {copy.version} {citation.documentVersion} · {citation.chunkId}</p>
        <p>{copy.scope}: {citation.doctorId ?? '—'} / {citation.language ?? '—'} · {citation.governanceReviewState ?? copy.unknown} · r{citation.retrievalRevision ?? '?'}</p>
        {source ? <><p className="font-semibold">{source.title}</p><p className="whitespace-pre-wrap">{source.content}</p></> : <p>{copy.unavailable}</p>}
      </li>
    })}</ul>
  </details>
}

export default function KbLearningPanel({ clinicId, documents }: { clinicId: string; documents: KnowledgeDocument[] }) {
  const generation = useReviewGeneration()
  return <SessionLearningPanel key={`${clinicId}:${generation}`} clinicId={clinicId} documents={documents} />
}

function SessionLearningPanel({ clinicId, documents }: { clinicId: string; documents: KnowledgeDocument[] }) {
  const [session] = useState(() => captureReviewSession(clinicId))
  const api = reviewApi(session)
  const { language } = useI18n()
  const copy = learningCopy[language]
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('candidates')
  const [status, setStatus] = useState<CandidateStatus>('pending_review')
  const [selected, setSelected] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reviewEpoch, setReviewEpoch] = useState(0)
  const [search, setSearch] = useState('')
  const base = `/clinics/${clinicId}/kb/learning`
  const key = ['kb-learning', clinicId, session.generation]
  const candidates = useQuery({ ...temporaryQuery, queryKey: [...key, 'candidates', status], queryFn: ({ signal }) => api.get<LearningCandidate[]>(`${base}/candidates?status=${status}`, signal), enabled: tab === 'candidates' })
  const events = useQuery({ ...temporaryQuery, queryKey: [...key, 'events'], queryFn: ({ signal }) => api.get<LearningEvent[]>(`${base}/events`, signal), enabled: tab === 'events' })
  const gaps = useQuery({ ...temporaryQuery, queryKey: [...key, 'gaps'], queryFn: ({ signal }) => api.get<LearningGap[]>(`${base}/gaps`, signal), enabled: tab === 'gaps' })
  const settings = useQuery({ ...temporaryQuery, queryKey: [...key, 'settings'], queryFn: ({ signal }) => api.get<LearningSettings>(`${base}/settings`, signal), enabled: tab === 'settings' })
  const refresh = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ['kb', clinicId] }) }
  const fail = (error: unknown) => {
    // Remove confirmation and draft state on stale/expired records. The user must
    // explicitly reopen refreshed evidence; no fallback mutation or blind retry.
    setSelected(null)
    setReviewEpoch(value => value + 1)
    setMessage(error instanceof ApiError && [404, 409].includes(error.status) ? copy.conflict : copy.error)
    refresh()
  }
  const selectReturned = (candidate: LearningCandidate) => {
    if (candidate.clinicId !== clinicId) { setSelected(null); setMessage(copy.error); return }
    // Approved edits fork a new candidate. Use only the returned identity/revision.
    setTab('candidates'); setStatus(candidate.status); setSelected(candidate.id)
    refresh()
  }
  const review = useMutation({ gcTime: 0, retry: false,
    mutationFn: ({ clinicId: targetClinic, candidateId, ...body }: ReviewCommand) => api.post<ReviewResult>(`/clinics/${targetClinic}/kb/learning/candidates/${candidateId}/review`, body),
    onSuccess: result => { setMessage(result.indexing === 'failed' ? copy.indexFailed : result.indexing === 'queued' ? copy.published : copy.saved); selectReturned(result.candidate) }, onError: fail,
  })
  const current = candidates.data?.find(candidate => candidate.id === selected && candidate.clinicId === clinicId)
  const active = { candidates, events, gaps, settings }[tab]
  const visibleCandidates = candidates.data?.slice(0, 50).filter(candidate => matchesLearningSearch(search, candidate.sourceQuestion, candidate.candidateContent, candidate.humanEdit))
  const visibleEvents = events.data?.slice(0, 100).filter(event => matchesLearningSearch(search, event.question, event.answer))
  const visibleGaps = gaps.data?.slice(0, 100).filter(gap => matchesLearningSearch(search, gap.question, gap.reason))
  return <section className="clinic-card space-y-4 p-4" aria-label={copy.title}>
    <h2 className="text-lg font-semibold">{copy.title}</h2><p className="text-sm">{copy.intro}</p>
    <p className="border-l-4 border-amber-500 pl-3 text-sm">{copy.policy}</p>
    <div className="flex flex-wrap gap-2" aria-label={copy.title}>
      {(['candidates', 'events', 'gaps', 'settings'] as const).map(item => <button key={item} type="button" className={button} aria-pressed={tab === item} onClick={() => { setTab(item); setSelected(null); setMessage(null) }}>{copy[item]}</button>)}
      <button type="button" className={button} onClick={() => { setSelected(null); setReviewEpoch(value => value + 1); refresh() }}>{copy.refresh}</button>
    </div>
    <p className="text-xs">{copy.bounded}</p>
    {tab !== 'settings' && <label className="block text-sm">{copy.search}<input type="search" className={field} value={search} onChange={e => { setSearch(e.target.value); setSelected(null) }} /><span className="text-xs">{copy.searchHint}</span></label>}
    {message && <p role="status" className="border border-amber-500 p-3 text-sm">{message}</p>}
    {active.isError ? <p role="alert">{copy.error}</p> : active.isPending ? <p role="status">{copy.loading}</p> : <>
      {tab === 'candidates' && <>
        <label className="block text-sm">{copy.candidates}<select className={field} value={status} onChange={e => { setStatus(e.target.value as CandidateStatus); setSelected(null) }}>{(['pending_review', 'approved', 'rejected', 'superseded'] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}</select></label>
        <ul className="max-h-72 space-y-2 overflow-y-auto">{visibleCandidates?.map(candidate => <li key={candidate.id} className="flex items-start justify-between gap-3 border p-3"><p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{candidate.humanEdit ?? candidate.candidateContent}</p><button className={button} type="button" disabled={review.isPending} onClick={() => setSelected(candidate.id)}>{copy.inspect}</button></li>)}</ul>
        {!visibleCandidates?.length && <p>{copy.empty}</p>}
        {current && <CandidateReview key={`${current.id}:${current.revision}:${current.updatedAt}`} session={session} candidate={current} documents={documents} copy={copy} busy={review.isPending || candidates.isFetching} onClose={() => setSelected(null)} onStale={() => fail(new ApiError(409, 'expired_candidate'))} onReview={command => review.mutate(command)} />}
      </>}
      {tab === 'events' && <div className="max-h-[36rem] space-y-3 overflow-y-auto">{!visibleEvents?.length && <p>{copy.empty}</p>}{visibleEvents?.map(event => <FeedbackRow key={`${reviewEpoch}:${event.id}:${event.feedback}`} session={session} event={event} base={base} documents={documents} copy={copy} onSaved={() => { setMessage(copy.saved); refresh() }} onError={fail} />)}</div>}
      {tab === 'gaps' && <div className="max-h-[36rem] space-y-3 overflow-y-auto">{!visibleGaps?.length && <p>{copy.empty}</p>}{visibleGaps?.map(gap => <GapRow key={`${reviewEpoch}:${gap.id}:${gap.status}`} session={session} gap={gap} base={base} copy={copy} onCandidate={selectReturned} onSaved={refresh} onError={fail} />)}</div>}
      {tab === 'settings' && settings.data && <SettingsForm key={`${reviewEpoch}:${JSON.stringify(settings.data)}`} session={session} value={settings.data} base={base} copy={copy} onSaved={() => { setMessage(copy.saved); refresh() }} onError={fail} />}
    </>}
  </section>
}

function CandidateReview({ session, candidate, documents, copy, busy, onReview, onClose, onStale }: { session: ReviewSession; candidate: LearningCandidate; documents: KnowledgeDocument[]; copy: Copy; busy: boolean; onReview: (command: ReviewCommand) => void; onClose: () => void; onStale: () => void }) {
  const api = reviewApi(session)
  const [content, setContent] = useState(candidate.humanEdit || candidate.candidateContent)
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [historyId, setHistoryId] = useState('')
  const history = useQuery({ ...temporaryQuery, queryKey: ['kb-learning', candidate.clinicId, session.generation, 'history', candidate.id], queryFn: ({ signal }) => api.get<LearningHistory[]>(`/clinics/${candidate.clinicId}/kb/learning/candidates/${candidate.id}/history`, signal) })
  const disabled = busy || reviewUnavailable(candidate) || !['pending_review', 'approved'].includes(candidate.status)
  const sourcesMissing = candidate.supportingChunks.some(citation => !documents.some(doc => doc.id === citation.documentId && doc.version === citation.documentVersion && trainingInfo(doc).lexicalAvailable))
  const submit = (action: ReviewCommand['action']) => {
    if (disabled) return
    // Recheck expiry at click-time; server rechecks revision, sources and safety.
    try {
      onReview(reviewCommand(candidate.clinicId, candidate, action, content, action === 'rollback' ? rollbackConfirmed : confirmed, historyId))
    } catch { onStale() }
  }
  const snapshots = rollbackSnapshots(candidate, history.data ?? [])
  const snapshot = snapshots.find(row => row.id === historyId)
  return <article className="space-y-4 border border-teal-500 p-4">
    <div className="flex justify-between gap-2"><h3 className="font-semibold">{copy[ candidate.status ]} · r{candidate.revision}</h3><button className={button} type="button" onClick={onClose}>{copy.close}</button></div>
    <p className="text-xs">{copy.expiry}: {candidate.expiresAt ?? '—'} · {copy.approver}: {candidate.approvedBy ?? '—'} / {candidate.approvedAt ?? '—'}</p>
    <p className="break-words text-xs">{copy.publication}: {candidate.publishedDocumentId ?? '—'} / {candidate.publishedDocumentVersion ?? '—'}</p>
    <details><summary>{copy.question}</summary><p className="whitespace-pre-wrap break-words">{candidate.sourceQuestion}</p></details>
    <CandidateEvidenceView candidate={candidate} content={content} copy={copy} />
    <p className="text-sm">{copy.feedback}: {candidate.patientFeedback || copy.unknown} · {copy.consistency}: {candidate.consistencyCount}</p>
    <details><summary>{copy.reasons}</summary><ul>{candidate.gateReasons?.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
    <Citations citations={candidate.supportingChunks} documents={documents} copy={copy} label={candidateNeedsRevalidation(candidate, content) ? copy.historicalCitations : copy.citations} />
    {sourcesMissing && <p role="status">{copy.unavailable}. {copy.refresh}</p>}
    <label className="block text-sm">{copy.content}<textarea className={`${field} resize-y`} rows={5} maxLength={12000} value={content} disabled={disabled} onChange={e => { setContent(e.target.value); setConfirmed(false) }} /></label>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={disabled} onChange={e => setConfirmed(e.target.checked)} />{copy.confirmation}</label>
    <div className="flex flex-wrap gap-2">
      <button className={button} type="button" disabled={disabled || !content.trim()} onClick={() => submit('edit')}>{copy.edit}</button>
      <button className={button} type="button" disabled={disabled || candidate.status !== 'pending_review' || !confirmed || !content.trim() || sourcesMissing} onClick={() => submit('approve')}>{copy.approve}</button>
      <button className={button} type="button" disabled={disabled || candidate.status !== 'pending_review'} onClick={() => submit('reject')}>{copy.reject}</button>
    </div>
    <details><summary className="font-semibold">{copy.history}</summary><p className="text-xs">{copy.historyLimit}</p>
      {history.isError ? <p role="alert">{copy.error}</p> : history.isPending ? <p>{copy.loading}</p> : <>
        <ul className="max-h-48 overflow-y-auto text-xs">{history.data?.slice(0, 100).map(row => <li key={row.id} className="border-b py-2">r{row.revision} · {row.action} · {row.actorId ?? '—'} · {row.createdAt}</li>)}</ul>
        {candidate.status === 'approved' && <>
          <label className="block text-sm">{copy.rollback}<select className={field} value={historyId} disabled={disabled} onChange={e => { setHistoryId(e.target.value); setRollbackConfirmed(false) }}><option value="">—</option>{snapshots.map(row => <option key={row.id} value={row.id}>r{row.revision} · {copy.version} {row.documentVersion} · {row.createdAt}</option>)}</select></label>
          {snapshot && <><p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm">{snapshot.content}</p><Citations citations={snapshot.citations} documents={documents} copy={copy} /></>}
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={rollbackConfirmed} disabled={disabled || !snapshot} onChange={e => setRollbackConfirmed(e.target.checked)} />{copy.rollbackConfirm}</label>
          <button className={button} type="button" disabled={disabled || !snapshot || !rollbackConfirmed || history.isFetching} onClick={() => submit('rollback')}>{copy.rollback}</button>
        </>}
      </>}
    </details>
  </article>
}

function FeedbackRow({ session, event, base, copy, documents, onSaved, onError }: { session: ReviewSession; event: LearningEvent; base: string; copy: Copy; documents: KnowledgeDocument[]; onSaved: () => void; onError: (error: unknown) => void }) {
  const api = reviewApi(session)
  const [feedback, setFeedback] = useState('')
  const mutation = useMutation({ gcTime: 0, retry: false, mutationFn: () => api.post(`${base}/events/${event.id}/feedback`, { feedback }), onSuccess: onSaved, onError })
  return <details className="border p-3 text-sm"><summary className="cursor-pointer break-words">{event.question} · {event.createdAt}</summary>
    <p className="my-2 whitespace-pre-wrap break-words">{event.answer}</p><EvidenceView evidence={event.evidence} copy={copy} />
    <Citations citations={event.citations} documents={documents} copy={copy} /><p>{copy.feedback}: {event.feedback || copy.unknown} · {event.handoffReason ?? '—'}</p><p className="my-2">{copy.feedbackHint}</p>
    <label>{copy.feedback}<select className={field} value={feedback} onChange={e => setFeedback(e.target.value)}><option value="">—</option>{(['accepted', 'corrected', 'escalated'] as const).map(value => <option key={value} value={value}>{copy[value]}</option>)}</select></label>
    <button className={button} type="button" disabled={!feedback || mutation.isPending} onClick={() => mutation.mutate()}>{copy.recordFeedback}</button>
  </details>
}

function GapRow({ session, gap, base, copy, onCandidate, onSaved, onError }: { session: ReviewSession; gap: LearningGap; base: string; copy: Copy; onCandidate: (candidate: LearningCandidate) => void; onSaved: () => void; onError: (error: unknown) => void }) {
  const api = reviewApi(session)
  const [content, setContent] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const create = useMutation({ gcTime: 0, retry: false, mutationFn: () => api.post<LearningCandidate>(`${base}/gaps/${gap.id}/candidate`, { content, staffConfirmed: true }), onSuccess: onCandidate, onError })
  const resolve = useMutation({ gcTime: 0, retry: false, mutationFn: () => api.post(`${base}/gaps/${gap.id}/resolve`), onSuccess: onSaved, onError })
  const busy = create.isPending || resolve.isPending
  return <details className="space-y-3 border p-3 text-sm"><summary className="cursor-pointer break-words">{gap.question} · {gap.occurrences} · {gap.status}</summary><p>{gap.reason} · {copy.expiry}: {gap.expiresAt}</p>
    <label className="block">{copy.content}<textarea rows={4} maxLength={12000} className={`${field} resize-y`} value={content} onChange={e => { setContent(e.target.value); setConfirmed(false) }} /></label>
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />{copy.correctionConfirm}</label>
    <div className="flex flex-wrap gap-2"><button className={button} type="button" disabled={busy || !confirmed || !content.trim()} onClick={() => create.mutate()}>{copy.correction}</button><button className={button} type="button" disabled={busy || gap.status === 'resolved'} onClick={() => resolve.mutate()}>{copy.resolve}</button></div>
  </details>
}

export function SettingsForm({ session, value, base, copy, onSaved, onError }: { session: ReviewSession; value: LearningSettings; base: string; copy: Copy; onSaved: () => void; onError: (error: unknown) => void }) {
  const api = reviewApi(session)
  const [autoApprove, setAutoApprove] = useState(value.autoApprove === true)
  const [threshold, setThreshold] = useState(String(value.groundingThreshold * 100))
  const [retention, setRetention] = useState(String(value.evidenceRetentionHours))
  const mutation = useMutation({ gcTime: 0, retry: false, mutationFn: () => api.put(`${base}/settings`, { autoApprove, groundingThreshold: Number(threshold) / 100, evidenceRetentionHours: Number(retention) }), onSuccess: onSaved, onError })
  const valid = Number(threshold) >= 80 && Number(threshold) <= 100 && Number.isInteger(Number(retention)) && Number(retention) >= 1 && Number(retention) <= 24
  return <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (valid && !mutation.isPending) mutation.mutate() }}>
    <label className="flex items-start gap-2"><input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />{copy.auto}</label>
    <label className="block text-sm">{copy.threshold}<input className={field} type="number" min={80} max={100} step={1} value={threshold} onChange={e => setThreshold(e.target.value)} /></label><p className="text-xs">{copy.thresholdHint}</p>
    <label className="block text-sm">{copy.retention}<input className={field} type="number" min={1} max={24} step={1} value={retention} onChange={e => setRetention(e.target.value)} /></label>
    <button className={button} type="submit" disabled={!valid || mutation.isPending}>{copy.save}</button>
  </form>
}
