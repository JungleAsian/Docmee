import Link from 'next/link'
import { notFound } from 'next/navigation'
import { readCustomAis } from '../../lib/custom-ais'

type PageProps = { params: { id: string } }

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-200">{value}</p>
    </div>
  )
}

export default function CustomAiPage({ params }: PageProps) {
  const ai = readCustomAis().find((item) => item.id === params.id)
  if (!ai) notFound()

  const handoff = [
    `Continue Docmee work using ${ai.name} (role: ${ai.role}).`,
    '',
    'Current DevTools state:',
    `- Provider: ${ai.name}`,
    `- Role: ${ai.role}`,
    `- Model: ${ai.model ?? 'not set'}`,
    `- Key variable: ${ai.keyVar ?? 'not set'}`,
    `- Endpoint: ${ai.baseUrl ?? 'provider default'}`,
    '',
    'Rules:',
    '- Build locally first; do not deploy to VPS until local validation passes.',
    '- Stay within this role; hand back to Claude or Codex for out-of-role work.',
    '- Update DevTools logs, Notion, and GitHub when work is verified.',
    '- Do not expose secrets or edit .env files unless explicitly requested.'
  ].join('\n')

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{ai.name}</h1>
          <p className="mt-1 text-xs font-medium uppercase tracking-wide text-cyan-200/80">{ai.role}</p>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">A connected AI in DevTools. Connect the account, then hand off Docmee work for its role.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ai.consoleUrl && (
            <a href={ai.consoleUrl} target="_blank" rel="noreferrer" className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white">Connect {ai.name}</a>
          )}
          <Link href="/agents" className="min-h-11 rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Manage AIs</Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-4">
        <Card label="Role" value={ai.role} />
        <Card label="Model" value={ai.model ?? 'not set'} />
        <Card label="Key variable" value={ai.keyVar ?? 'not set'} />
        <Card label="Endpoint" value={ai.baseUrl ?? 'provider default'} />
      </div>

      <div className="mt-5 rounded-md border border-slate-800 bg-slate-900 p-4">
        <h2 className="text-sm font-semibold">Handoff Prompt</h2>
        <p className="mt-1 text-xs text-slate-400">Use this when handing Docmee work to {ai.name}.</p>
        <textarea readOnly value={handoff} className="mt-3 h-[320px] w-full resize-none rounded-md border border-slate-700 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100" />
      </div>
    </section>
  )
}
