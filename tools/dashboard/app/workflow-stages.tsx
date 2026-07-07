import Link from 'next/link'

// Shared dev → deploy stage strip shown on every lane page so they all read in
// the same pipeline order, with the current stage highlighted.
const STAGES = [
  { key: 'develop', label: 'Develop', href: '/workflow' },
  { key: 'verify', label: 'Verify', href: '/gates' },
  { key: 'deploy', label: 'Deploy', href: '/deploy' },
  { key: 'monitor', label: 'Monitor', href: '/install-monitor' }
] as const

export function WorkflowStages({ active }: { active: (typeof STAGES)[number]['key'] }) {
  return (
    <nav aria-label="Workflow stages" className="mb-4 flex flex-wrap items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/40 p-2 text-[11px]">
      <Link href="/workflow" className="mr-1 font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200">Workflow</Link>
      {STAGES.map((stage, index) => (
        <span key={stage.key} className="flex items-center gap-1.5">
          <Link
            href={stage.href}
            className={`rounded-md border px-2 py-0.5 font-medium leading-5 ${active === stage.key ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100' : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'}`}
          >
            {index + 1}. {stage.label}
          </Link>
          {index < STAGES.length - 1 && <span className="text-slate-500" aria-hidden="true">→</span>}
        </span>
      ))}
    </nav>
  )
}
