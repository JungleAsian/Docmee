import path from 'node:path'
import { readJson } from '../lib/read-json'
import { Icon } from '../icon'

export const dynamic = 'force-dynamic'

type JournalType = 'note' | 'decision' | 'blocker' | 'summary'
type JournalEntry = {
  id: string
  ts: string
  type: JournalType
  title: string
  body?: string
  tags?: string[]
  taskId?: number
  pinned?: boolean
}

const toolsRoot = path.resolve(process.cwd(), '..')
const journalFile = path.join(toolsRoot, 'logs', 'journal.json')

const TYPES: JournalType[] = ['note', 'decision', 'blocker', 'summary']
const typeTone: Record<JournalType, string> = {
  note: 'border-slate-700 text-slate-300',
  decision: 'border-cyan-700 text-cyan-200',
  blocker: 'border-red-700 text-red-300',
  summary: 'border-emerald-700 text-emerald-200'
}

export default function JournalPage({ searchParams }: { searchParams?: { type?: string } }) {
  const all = readJson<JournalEntry[]>(journalFile, [])
  const fType = searchParams?.type as JournalType | undefined
  let entries = fType ? all.filter((e) => e.type === fType) : all
  entries = entries.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.ts.localeCompare(a.ts))

  const chip = (href: string, label: string, active: boolean) => (
    <a key={label} href={href} className={`rounded-md border px-2.5 py-1 ${active ? 'border-cyan-600 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>{label}</a>
  )

  return (
    <section className="mx-auto max-w-4xl w-full">
      <div>
        <h1 className="text-2xl font-semibold">Journal</h1>
        <p className="mt-1 text-sm text-slate-400">Project memory — decisions, blockers, notes, and session summaries so work doesn&apos;t start cold. Pin what matters.</p>
      </div>

      <details className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40">
        <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium text-slate-200">+ New entry</summary>
        <form action="/api/actions" method="post" className="space-y-2 border-t border-slate-800 px-4 py-3">
          <input type="hidden" name="action" value="journal-add" />
          <div className="flex flex-wrap gap-2">
            <select name="type" defaultValue="note" className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input name="title" required placeholder="Title (e.g. 'Use Ed25519 for license keys')" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100" />
          </div>
          <textarea name="body" rows={3} placeholder="Details (optional) — the why, context, links" className="w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs text-slate-100" />
          <div className="flex flex-wrap items-center gap-2">
            <input name="tags" placeholder="tags, comma, separated" className="rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" />
            <input name="task" placeholder="backlog # (optional)" className="w-32 rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100" />
            <button className="ml-auto rounded-md bg-cyan-500 px-4 py-1.5 text-sm font-medium text-slate-950 hover:bg-cyan-400">Save</button>
          </div>
        </form>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs">
        {chip('/journal', 'All', !fType)}
        {TYPES.map((t) => chip(`/journal?type=${t}`, t, fType === t))}
      </div>

      <ul className="mt-3 space-y-2">
        {entries.map((e) => (
          <li key={e.id} className={`rounded-lg border bg-slate-900/40 px-4 py-3 ${e.pinned ? 'border-amber-800/70' : 'border-slate-800'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-100">
                  {e.pinned && <span title="Pinned">📌</span>}
                  <span className={`rounded border px-1.5 text-[11px] ${typeTone[e.type]}`}>{e.type}</span>
                  <span className="truncate">{e.title}</span>
                </p>
                {e.body && <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-400">{e.body}</p>}
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                  <span>{e.ts.replace('T', ' ').replace(/\..*$/, '')}</span>
                  {typeof e.taskId === 'number' && <a href="/backlog" className="text-cyan-300 underline">#{e.taskId}</a>}
                  {e.tags?.map((t) => <span key={t} className="rounded bg-slate-800 px-1.5">{t}</span>)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="journal-pin" />
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="off" value={e.pinned ? '1' : '0'} />
                  <button className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800" title={e.pinned ? 'Unpin' : 'Pin'}>{e.pinned ? 'Unpin' : 'Pin'}</button>
                </form>
                <form action="/api/actions" method="post">
                  <input type="hidden" name="action" value="journal-remove" />
                  <input type="hidden" name="id" value={e.id} />
                  <button className="inline-flex items-center justify-center rounded border border-red-800 p-1 text-red-300 hover:bg-red-950/40" title="Delete" aria-label="Delete entry"><Icon name="trash" className="h-3.5 w-3.5" /></button>
                </form>
              </div>
            </div>
          </li>
        ))}
        {entries.length === 0 && (
          <li className="rounded-lg border border-slate-800 px-4 py-10 text-center text-sm text-slate-400">No entries yet. Capture a decision, blocker, or summary above.</li>
        )}
      </ul>
    </section>
  )
}
