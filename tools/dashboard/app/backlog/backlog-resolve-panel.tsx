'use client'

import { useRef, useState } from 'react'
import { Icon } from '../icon'

// Per-item resolution: pick an AI to assign, then the button engages it.
// Claude auto-runs agentically via the headless CLI (edits + commits). API
// providers (api: true) auto-run via their chat API and produce a proposed
// resolution to review. Cursor has no API, so it stays a manual handoff.
type Agent = 'auto' | 'claude' | 'codex' | 'grok' | 'cursor' | 'gemini' | 'deepseek'

const PROVIDERS: Record<Agent, { label: string; url?: string; api?: boolean }> = {
  auto: { label: 'Auto' },
  claude: { label: 'Claude' },
  codex: { label: 'Codex', url: 'https://chatgpt.com/codex', api: true },
  grok: { label: 'Grok', url: 'https://grok.com', api: true },
  cursor: { label: 'Cursor', url: 'https://cursor.com' },
  gemini: { label: 'Gemini', url: 'https://gemini.google.com/app', api: true },
  deepseek: { label: 'DeepSeek', url: 'https://chat.deepseek.com', api: true }
}
const AGENTS = Object.keys(PROVIDERS) as Agent[]

export function BacklogResolvePanel({
  id,
  title,
  lane,
  phase,
  priority,
  plan,
  confidence,
  assignee,
  commit,
  pr,
  result,
  resultProvider,
  autoResolvesTo
}: {
  id: number
  title: string
  lane?: string
  phase: string
  priority: string
  plan?: string
  confidence?: number
  assignee?: string
  commit?: string
  pr?: string
  result?: string
  resultProvider?: string
  autoResolvesTo?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [agent, setAgent] = useState<Agent>(assignee && assignee in PROVIDERS ? (assignee as Agent) : 'auto')
  const defaultPlan = `Investigate the ${lane || 'relevant'} code for "${title}", design a focused fix, implement it, run local checks, and commit referencing backlog #${id}.`
  const [text, setText] = useState(plan || defaultPlan)
  const close = () => ref.current?.close()
  const provider = PROVIDERS[agent]

  const copyAndOpen = () => {
    const prompt = `Resolve Docmee backlog item #${id}: ${title}.\nLane: ${lane || 'unspecified'} · Phase: ${phase} · Priority: ${priority}.\n\nPlan / instruction:\n${text}`
    navigator.clipboard.writeText(prompt).catch(() => {})
    if (provider.url) window.open(provider.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        title="Resolve this item — review the plan and approve, all click-driven"
        aria-label="Resolve this item"
        className="inline-flex items-center justify-center rounded-md border border-cyan-700 bg-cyan-950/30 p-1 text-cyan-100 hover:bg-cyan-950/60"
      >
        <Icon name="build" className="h-3.5 w-3.5" />
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(44rem,94vw)] rounded-lg border border-slate-700 bg-slate-900 p-0 text-slate-200 backdrop:bg-black/60"
        onClick={(event) => { if (event.target === ref.current) close() }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <h3 className="min-w-0 truncate text-sm font-semibold text-slate-100">Resolve #{id}: {title}</h3>
          <button type="button" onClick={close} aria-label="Close" className="shrink-0 rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800">✕</button>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-400">Assign to</span>
            {AGENTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setAgent(value)}
                className={`rounded-md border px-2.5 py-1 font-medium ${agent === value ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-300 hover:bg-slate-800'}`}
              >
                {PROVIDERS[value].label}
              </button>
            ))}
          </div>

          <div>
            <p className="text-xs text-slate-400">
              Plan / instruction <span className="text-slate-500">(editable)</span>
              {typeof confidence === 'number' && (
                <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-medium ${confidence >= 8 ? 'bg-emerald-900 text-emerald-100' : 'bg-amber-900 text-amber-100'}`}>confidence {confidence}/10</span>
              )}
            </p>
            <textarea value={text} onChange={(event) => setText(event.target.value)} rows={6} className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 p-3 text-xs text-slate-100" />
          </div>

          <div className="space-y-2">
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="backlog-plan" />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="provider" value={agent} />
              <button className="w-full rounded-md bg-cyan-500 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">Auto-plan &amp; resolve →</button>
            </form>
            <p className="text-xs text-slate-500">
              {agent === 'auto' ? (
                <>Auto picks your cheapest available AI{autoResolvesTo ? <> — currently <span className="text-violet-100">{autoResolvesTo}</span></> : ''} to draft the fix, then <span className="text-cyan-200">Claude implements &amp; commits</span>, then it <span className="text-emerald-200">auto-verifies</span> (≥8 auto-approves). No API key → Claude resolves directly. Pick a specific AI on the left to override.</>
              ) : agent === 'claude' ? (
                <>Claude drafts a plan + rates confidence: <span className="text-emerald-200">≥8 auto-approves &amp; resolves</span>; below that it pauses for your approval. Then it <span className="text-emerald-200">auto-verifies</span> — ≥8 marks it done automatically.</>
              ) : (
                <>Hands-off: <span className="text-violet-100">{provider.label}</span> drafts the fix, <span className="text-cyan-200">Claude implements &amp; commits</span>, then it <span className="text-emerald-200">auto-verifies</span> (≥8 auto-approves). {provider.api ? <>Needs <span className="font-mono">{agent.toUpperCase()}_API_KEY</span> in <span className="font-mono">.env.tools</span> — without it, Claude resolves directly.</> : <>No API for {provider.label}, so Claude resolves directly.</>}</>
              )}
            </p>
            <form action="/api/actions" method="post">
              <input type="hidden" name="action" value="backlog-resolve" />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="provider" value={agent} />
              <input type="hidden" name="plan" value={text} />
              <button className="w-full rounded-md border border-emerald-700 px-3 py-2 text-xs font-medium text-emerald-100 hover:bg-emerald-950/40">{typeof confidence === 'number' && confidence < 8 ? 'Approve this plan & resolve →' : 'Resolve with this plan (skip auto-plan) →'}</button>
            </form>
            {agent !== 'claude' && provider.url && (
              <button type="button" onClick={copyAndOpen} className="text-xs text-cyan-300 underline">or copy the plan &amp; open {provider.label} manually ↗</button>
            )}
          </div>

          {result && (
            <details className="rounded-md border border-violet-900 bg-violet-950/20 p-2" open>
              <summary className="cursor-pointer text-xs font-medium text-violet-100">AI proposed resolution{resultProvider ? ` · ${resultProvider}` : ''}</summary>
              <div className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-slate-700 bg-slate-950 p-2 text-[11px] leading-5 text-slate-100">{result}</div>
            </details>
          )}

          <div className="border-t border-slate-800 pt-3">
            <form action="/api/actions" method="post" className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="action" value="backlog-update" />
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="assignee" value={agent} />
              <label className="text-xs text-slate-400">
                PR link
                <input name="pr" defaultValue={pr ?? ''} placeholder="https://github.com/…/pull/123" className="mt-1 block w-72 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100" />
              </label>
              <button className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Save assignment &amp; link</button>
              {commit && <span className="text-xs text-slate-500">commit <span className="font-mono text-slate-300">{commit}</span></span>}
            </form>
          </div>
        </div>
      </dialog>
    </>
  )
}
