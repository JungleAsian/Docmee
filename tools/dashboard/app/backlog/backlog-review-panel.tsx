'use client'

import { useRef } from 'react'
import { Icon } from '../icon'

// One "Review" button per item that opens everything needed to review a
// resolution in plain language — suggested solution, next steps, verification,
// and final approval — all click-driven, no editing required.
export function BacklogReviewPanel({
  id,
  title,
  status,
  assignee,
  plan,
  commit,
  pr,
  result,
  resultProvider,
  confidence,
  verifyConfidence,
  verifyReason
}: {
  id: number
  title: string
  status: string
  assignee?: string
  plan?: string
  commit?: string
  pr?: string
  result?: string
  resultProvider?: string
  confidence?: number
  verifyConfidence?: number
  verifyReason?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => ref.current?.close()

  const verified = typeof verifyConfidence === 'number'
  const passed = verified && (verifyConfidence as number) >= 8
  const flagged = verified && (verifyConfidence as number) < 8
  const hasResult = Boolean(result && result.trim())
  const hasCommit = Boolean(commit && commit.trim())

  // Plain-language next steps, tailored to where the item is.
  const steps: string[] = []
  if (hasResult && !hasCommit) {
    steps.push('Read the suggested solution below.')
    steps.push('Apply it yourself, or re-run with Claude to implement & commit it.')
  }
  if (hasCommit) steps.push('A commit is attached — confirm the change looks right.')
  if (!verified) steps.push('Click “Run verification” to auto-check the fix (it scores confidence 1–10).')
  if (flagged) steps.push('Verification flagged concerns — read the reason, then re-verify or approve anyway.')
  if (passed) steps.push('Verification passed (≥8). Click “Approve & mark done”.')
  steps.push('Click “Approve & mark done” when you’re satisfied.')

  const reviewy = status === 'review' || status === 'blocked' || hasResult

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className={`inline-flex items-center justify-center rounded-md border p-1 ${reviewy ? 'border-sky-600 bg-sky-950/40 text-sky-100 hover:bg-sky-900/50' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
        title="Open the review panel: suggested solution, next steps, verification, and approval"
        aria-label="Review this item"
      >
        <Icon name="eye" className="h-3.5 w-3.5" />
      </button>
      {verified && (
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${passed ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`} title="Latest verification confidence">{verifyConfidence}/10</span>
      )}

      <dialog
        ref={ref}
        className="m-auto w-[min(48rem,95vw)] rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/60"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-100">Review #{id}: {title}</h3>
          <button type="button" onClick={close} aria-label="Close" className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">✕</button>
        </div>

        <div className="space-y-4 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-slate-800 px-2 py-0.5 font-medium text-slate-200">{status}</span>
            {assignee && <span className="text-slate-400">assigned to <span className="text-slate-200">{assignee}</span></span>}
            {verified && <span className={`rounded px-2 py-0.5 font-medium ${passed ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}>verify {verifyConfidence}/10</span>}
            {commit && <span className="font-mono text-slate-500">commit {commit}</span>}
            {pr && <a href={pr} target="_blank" rel="noreferrer" className="text-cyan-300 underline">PR ↗</a>}
          </div>

          {/* Confidence rating */}
          <div className="flex items-center gap-3 rounded-md border border-slate-800 bg-slate-950/40 p-3">
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 text-base font-bold ${verified ? (passed ? 'border-emerald-500 text-emerald-300' : 'border-amber-500 text-amber-300') : 'border-slate-600 text-slate-500'}`}>
              {verified ? `${verifyConfidence}` : '—'}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-100">Confidence rating{verified ? <span className="ml-1 text-slate-400">{verifyConfidence}/10</span> : ''}</p>
              <p className="text-xs text-slate-400">
                {verified
                  ? (passed ? 'Verified — high confidence the fix works (≥8).' : 'Below 8 — review before approving.')
                  : 'Not verified yet — click “Run verification” below to score it 1–10.'}
                {typeof confidence === 'number' && <span className="ml-1 text-slate-500">· plan confidence {confidence}/10</span>}
              </p>
            </div>
          </div>

          {/* 1 — Suggested solution */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Suggested solution</h4>
            {hasResult ? (
              <>
                {resultProvider && <p className="mt-1 text-[11px] text-violet-300">Proposed by {resultProvider}</p>}
                <div className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{result}</div>
              </>
            ) : plan && plan.trim() ? (
              <div className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md border border-slate-700 bg-slate-950 p-3 text-[11px] leading-5 text-slate-100">{plan}</div>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No solution captured yet — assign an AI on the Resolve panel and run it.</p>
            )}
          </section>

          {/* 2 — Verification reason (only when flagged) */}
          {flagged && verifyReason && (
            <section>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-300">Why it was flagged (confidence {verifyConfidence}/10)</h4>
              <div className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-amber-900 bg-amber-950/20 p-3 text-[11px] leading-5 text-amber-50">{verifyReason}</div>
            </section>
          )}

          {/* 3 — Next steps */}
          <section>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Next steps</h4>
            <ol className="mt-1 list-decimal space-y-1 pl-5 text-xs text-slate-300">
              {steps.map((step, index) => <li key={index}>{step}</li>)}
            </ol>
          </section>

          {/* 4 — Click actions */}
          <section className="border-t border-slate-800 pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Do it</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="backlog-verify" />
                <input type="hidden" name="id" value={id} />
                <button className="rounded-md border border-sky-700 bg-sky-950/30 px-3 py-1.5 text-xs font-medium text-sky-100 hover:bg-sky-900/50">{verified ? 'Re-run verification' : 'Run verification'}</button>
              </form>
              {assignee && assignee !== 'cursor' && (
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="backlog-resolve" />
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="provider" value={assignee} />
                  {plan && <input type="hidden" name="plan" value={plan} />}
                  <button className="rounded-md border border-violet-700 bg-violet-950/30 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-900/50">Re-run with {assignee}</button>
                </form>
              )}
              <form action="/api/actions" method="post">
                <input type="hidden" name="action" value="backlog-status" />
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="status" value="todo" />
                <button className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Send back to todo</button>
              </form>
              <form action="/api/actions" method="post" className="ml-auto">
                <input type="hidden" name="action" value="backlog-approve" />
                <input type="hidden" name="id" value={id} />
                <button className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">Approve &amp; mark done ✓</button>
              </form>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Approving marks the item done and moves it to the Resolved list. Verification is optional but recommended.</p>
          </section>
        </div>
      </dialog>
    </>
  )
}
