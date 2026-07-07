import fs from 'node:fs'
import path from 'node:path'
import { BuildProgressGauge } from '../build-progress-gauge'
import { LaneItemGauge } from '../lane-item-gauge'
import { PhaseStrip } from '../phase-strip'
import { AutoRefresh } from '../auto-refresh'

const toolsRoot = path.resolve(process.cwd(), '..')
const phasesFile = path.join(toolsRoot, 'logs', 'phases.json')
const promptsDir = path.join(toolsRoot, 'prompts')
const phasePromptsUrl = 'https://app.notion.com/p/38241c470daf81a8b44ef53543e6bb45'

const definitions = [
  ['P01', 'Repository Foundation', 'claude-code', '1', 'ready'],
  ['P02', 'Database', 'claude-code', '1', 'ready'],
  ['P03', 'Core Infrastructure + AI', 'claude-code', '1', 'ready'],
  ['P04', 'WhatsApp Channel', 'claude-code', '1', 'ready'],
  ['P05', 'Clinic Bot', 'claude-code', '1', 'ready'],
  ['P06', 'Appointment Scheduler', 'claude-code', '1', 'ready'],
  ['P07', 'Secretary Alerts', 'claude-code', '1', 'ready'],
  ['P08', 'Auth & API', 'claude-code', '1', 'ready'],
  ['P09', 'Clinic Inbox + Admin Studio', 'claude-code', '1', 'ready'],
  ['P10', 'License Manager', 'claude-code', '1', 'ready'],
  ['P11', 'Admin Studio Admin Panel', 'claude-code', '1', 'ready'],
  ['P12', 'Voice Transcription Service', 'claude-code', '1', 'ready'],
  ['P13', 'Installer (DeployKit)', 'claude-code', '2', 'ready'],
  ['P14', 'Facebook Messenger', 'claude-code', '2', 'ready'],
  ['P15', 'Instagram Direct', 'claude-code', '2', 'ready'],
  ['P16', 'Phase 2 Features', 'claude-code', '2', 'ready'],
  ['P17', 'Testing & CI/CD', 'claude-code', '2', 'ready'],
  ['P18', 'Phase 3 Features', 'claude-code', '3', 'ready'],
  ['P19', 'Compliance & Launch', 'claude-code', '1', 'ready']
] as const

type Phase = { id: string; status: 'not-started' | 'in-progress' | 'done'; completedAt?: string; commitHash?: string; committedAt?: string }
type PageProps = { searchParams?: { message?: string; error?: string } }

function phases() {
  const fallback = definitions.map(([id]) => ({ id, status: 'not-started' as const }))
  if (!fs.existsSync(phasesFile)) return fallback
  const data = JSON.parse(fs.readFileSync(phasesFile, 'utf8')) as Phase[]
  const byId = new Map(data.map((phase) => [phase.id, phase]))
  return fallback.map((phase) => byId.get(phase.id) ?? phase)
}

function promptInfo(id: string) {
  const file = path.join(promptsDir, `${id}-CODEX-PROMPT.md`)
  const contextFile = path.join(promptsDir, `${id}-CONTEXT.md`)
  const stat = fs.existsSync(file) ? fs.statSync(file) : fs.existsSync(contextFile) ? fs.statSync(contextFile) : null
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const contextText = fs.existsSync(contextFile) ? fs.readFileSync(contextFile, 'utf8') : ''
  const placeholder = text.includes('Paste the full') || text.includes('No prompt content found') || text.includes('record P01 to Notion') || text.includes('record P02 to Notion')
  const contextPlaceholder = contextText.includes('Paste the full') || contextText.includes('No prompt content found')
  const promptUsable = !placeholder && text.trim().length >= 1000
  const contextUsable = !contextPlaceholder && contextText.trim().length >= 1000 && /===\s+P\d+\s+BUILD INSTRUCTIONS\s+===/i.test(contextText)
  const usable = promptUsable || contextUsable
  const exists = Boolean(text || contextText)
  const chars = promptUsable ? text.length : contextText.length || text.length
  const source = promptUsable ? 'prompt' : contextUsable ? 'context' : 'prompt'
  const issue = usable ? '' : !exists ? 'prompt not synced' : placeholder && !contextUsable ? 'placeholder prompt' : 'prompt too short'
  return { exists, usable, chars, synced: stat ? stat.mtime.toLocaleString() : '', issue, source }
}

function githubCommitUrl(hash?: string) {
  if (!hash) return ''
  return `https://github.com/JungleAsian/Creascent-Development/commit/${hash}`
}

function builderLabel(builder: string) {
  return builder === 'claude-code' ? 'Claude Code' : builder
}

export default function PhasesPage({ searchParams }: PageProps) {
  const state = phases()
  const byId = new Map(state.map((phase) => [phase.id, phase]))
  const total = state.length
  const done = state.filter((phase) => phase.status === 'done').length
  const inProgress = state.filter((phase) => phase.status === 'in-progress').length
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    done === total ? 'complete' : inProgress > 0 ? 'progressing' : done === 0 ? 'stopped' : 'halted'
  const overallPercent = total > 0 ? Math.round((done / total) * 100) : 0
  const p11Done = byId.get('P11')?.status === 'done'
  const readyBlocked = definitions
    .filter(([id, , , , prompt]) => prompt === 'ready' && !promptInfo(id).exists)
    .map(([id]) => id)
  const readyInvalid = definitions
    .filter(([id, , , , prompt]) => prompt === 'ready' && promptInfo(id).exists && !promptInfo(id).usable)
    .map(([id]) => id)
  const buildBlocked = [...readyBlocked, ...readyInvalid]

  return (
    <section className="w-full">
      <AutoRefresh seconds={15} />
      <div className="sticky top-14 z-20 flex flex-wrap items-start justify-between gap-4 bg-slate-950 py-2 md:static md:bg-transparent md:py-0">
        <div>
          <h1 className="text-2xl font-semibold">Phase Progress</h1>
          <p className="mt-2 text-sm text-slate-400">{done}/{total} phases complete</p>
        </div>
        <div className="flex w-full items-center gap-4 md:w-auto">
          <BuildProgressGauge size="sm" percent={overallPercent} state={overallState} label="Phases" message={`${done}/${total} done`} />
          <div className="h-3 min-w-40 flex-1 rounded bg-slate-800 md:w-72"><div className="h-3 rounded bg-cyan-500" style={{ width: `${overallPercent}%` }} /></div>
        </div>
      </div>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-2 text-sm text-red-300">{searchParams.error}</p>}

      <div className="mt-4">
        <PhaseStrip phases={definitions.map(([id, name]) => ({ id, name, status: byId.get(id)?.status ?? 'not-started' }))} />
      </div>

      {p11Done && <div className="mt-4 rounded-md border border-amber-500 bg-amber-950/40 p-4 text-sm text-amber-200">Submit to Meta NOW. WhatsApp approval should start after P11, not after P19.</div>}

      <div id="build-panel" className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Prompt Sync Status</h2>
            <p className={buildBlocked.length === 0 ? 'mt-1 text-sm text-emerald-300' : 'mt-1 text-sm text-amber-300'}>
              {buildBlocked.length === 0 ? 'All ready prompts are cached and usable.' : `Build blocked until full prompts are available for: ${buildBlocked.join(', ')}`}
            </p>
          </div>
          <a href={phasePromptsUrl} target="_blank" rel="noreferrer" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open in Notion</a>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action="/api/phases/sync" method="post"><button className="rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-950">Sync from Notion</button></form>
          <form action="/api/actions" method="post" className="flex gap-2">
            <input type="hidden" name="action" value="phase-build" />
            <select name="from" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
              {definitions.map(([id]) => <option key={id} value={id}>Resume from {id}</option>)}
            </select>
            <button className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400">Start Automated Build</button>
          </form>
          <form action="/api/actions" method="post"><input type="hidden" name="action" value="phase-build-dry-run" /><button className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm">Dry Run</button></form>
        </div>
        <p className="mt-3 text-xs text-slate-500">Build output is written to /tools/logs/phase-YYYY-MM-DD.log.</p>
      </div>

      <div className="mt-6 space-y-3">
        {definitions.map(([id, name, builder, business, prompt]) => {
          const phase: Phase = byId.get(id) ?? { id, status: 'not-started' as const }
          const info = promptInfo(id)
          return (
            <div key={id} className="rounded-md border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <LaneItemGauge
                  percent={phase.status === 'done' ? 100 : phase.status === 'in-progress' ? 50 : 6}
                  tone={phase.status === 'done' ? 'emerald' : phase.status === 'in-progress' ? 'amber' : 'slate'}
                  title={`${id} ${phase.status}`}
                />
                <BuildProgressGauge phaseId={id} size="sm" showLabel={false} />
                <strong className="w-14">{id}</strong>
                <div className="min-w-0 flex-1 md:min-w-64">
                  <div className="font-medium">{name}</div>
                  <div className={info.usable ? 'mt-1 text-xs text-slate-500' : 'mt-1 text-xs text-amber-300'}>Business phase {business} · {info.exists ? `${info.chars} chars · ${info.source} · synced ${info.synced}${info.usable ? '' : ` · ${info.issue}`}` : 'prompt not synced'}</div>
                </div>
                <span className={builder === 'claude-code' ? 'rounded bg-purple-900 px-2 py-1 text-xs text-purple-100' : 'rounded bg-blue-900 px-2 py-1 text-xs text-blue-100'}>{builderLabel(builder)}</span>
                <span className={prompt === 'ready' ? 'rounded bg-emerald-900 px-2 py-1 text-xs text-emerald-100' : 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-300'}>{prompt}</span>
                <span className="rounded bg-slate-800 px-2 py-1 text-sm">{phase.status}</span>
                {phase.commitHash && <a href={githubCommitUrl(phase.commitHash)} target="_blank" rel="noreferrer" className="rounded border border-slate-700 px-2 py-1 text-xs text-sky-300 hover:bg-slate-800">commit {phase.commitHash}</a>}
                <form action="/api/actions" method="post"><input type="hidden" name="action" value="phase-start" /><input type="hidden" name="phase" value={id} /><button disabled={phase.status !== 'not-started' || (prompt === 'ready' && !info.usable)} className="min-h-11 rounded border border-slate-700 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:text-slate-600">Start</button></form>
                <form action="/api/actions" method="post"><input type="hidden" name="action" value="phase-done" /><input type="hidden" name="phase" value={id} /><button disabled={phase.status === 'done'} className="min-h-11 rounded border border-slate-700 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:text-slate-600">Mark Done</button></form>
              </div>
            </div>
          )
        })}
      </div>
      <a href="#build-panel" className="fixed bottom-24 right-4 grid h-14 w-14 place-items-center rounded-full bg-cyan-500 text-xl font-semibold text-slate-950 shadow-lg md:hidden">Go</a>
    </section>
  )
}
