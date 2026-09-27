import type { ResponseDiagnostics as Diagnostics } from './types'
import type { TeachingCopy } from './copy'

export function ResponseDiagnostics({ diagnostics, c }: { diagnostics: Diagnostics; c: TeachingCopy }) {
  const node = diagnostics.workflowNode
    ? `${diagnostics.workflowNode.workflowName} · ${diagnostics.workflowNode.nodeId}`
    : c.helpMode
  return <details className="rounded border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-2 text-[11px]">
    <summary className="cursor-pointer font-semibold">{c.diagnostics}</summary>
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1">
      <dt>{c.clinicUsed}</dt><dd className="break-words">{diagnostics.clinic.name}</dd>
      <dt>{c.nodeUsed}</dt><dd className="break-words">{node}</dd>
      <dt>{c.kbUsed}</dt><dd>{diagnostics.kbMatches}</dd>
      <dt>{c.retrievalUsed}</dt><dd>{diagnostics.retrievalMode}</dd>
      <dt>{c.source}</dt><dd className="break-words">{diagnostics.sources.map(source => `${source.title} (v${source.documentVersion})`).join(', ') || '—'}</dd>
    </dl>
  </details>
}
