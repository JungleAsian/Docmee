import Link from 'next/link'
import { BuildProgressGauge } from '../build-progress-gauge'
import {
  backendStage,
  countBy,
  deploymentRecordFor,
  frontendStage,
  priorityDot,
  readDevelopmentSources,
  readDeploymentFeatures,
  shortText,
  stageDot,
  stageLabel,
  type DeploymentFeature,
  type StageStatus
} from './data'
import { StatusDot } from '../status-dot'

type StageKind = 'backend' | 'frontend'

const stageCopy: Record<StageKind, {
  title: string
  eyebrow: string
  description: string
  primaryLabel: string
  secondaryLabel: string
  route: string
  oppositeRoute: string
  oppositeLabel: string
  completeLabel: string
  pendingLabel: string
  auditLabel: string
  recordTitle: string
  recordIntro: string
  processTitle: string
  process: string[]
  checklist: string[]
  finalNote: string
  defaultSourceUrl: string
}> = {
  backend: {
    title: 'Docmee Deployment - Backend',
    eyebrow: 'Backend deployment lane',
    description: 'Backend/local-code deployment records for APIs, data, workers, integrations, tests, and operational wiring.',
    primaryLabel: 'Backend complete',
    secondaryLabel: 'Backend pending',
    route: '/docmee-deployment-backend',
    oppositeRoute: '/docmee-deployment-frontend',
    oppositeLabel: 'Open Frontend',
    completeLabel: 'Complete',
    pendingLabel: 'Pending',
    auditLabel: 'Needs audit',
    recordTitle: 'Backend Work Records',
    recordIntro: 'Grouped backend records. Expand an item to see the implementation evidence and the non-backend follow-up.',
    processTitle: 'Backend Workflow',
    process: ['Run readiness', 'Review backend records', 'Verify services', 'Deploy package', 'Export report'],
    checklist: [
      'Confirm environment values are present.',
      'Confirm API, workers, database, and integrations are reachable.',
      'Confirm tests and deployment checks are recorded.',
      'Deploy or verify the VPS package.',
      'Export the deployment report after verification.'
    ],
    finalNote: 'Backend completion does not automatically mean the UI is product accepted. Frontend acceptance remains separate.',
    defaultSourceUrl: 'https://app.notion.com/p/38441c470daf8186bd57cafb883bcfcc'
  },
  frontend: {
    title: 'Docmee Deployment - Frontend',
    eyebrow: 'Frontend deployment lane',
    description: 'Frontend/product acceptance records for visible screens, mobile layout, workflow clarity, labels, and design fidelity.',
    primaryLabel: 'Frontend accepted',
    secondaryLabel: 'Frontend pending',
    route: '/docmee-deployment-frontend',
    oppositeRoute: '/docmee-deployment-backend',
    oppositeLabel: 'Open Backend',
    completeLabel: 'Accepted',
    pendingLabel: 'Pending',
    auditLabel: 'Needs audit',
    recordTitle: 'Frontend Acceptance Records',
    recordIntro: 'Grouped frontend records. Expand an item to see the acceptance details and backend implementation context.',
    processTitle: 'Frontend Workflow',
    process: ['Run readiness', 'Review UI records', 'Launch locally', 'Verify VPS screen', 'Export report'],
    checklist: [
      'Confirm each screen or workflow is visible in the running app.',
      'Confirm the UI does not look like a placeholder.',
      'Confirm mobile layout, spacing, and labels work.',
      'Confirm English and Spanish text are present where needed.',
      'Export the acceptance report after product review.'
    ],
    finalNote: 'Frontend acceptance should only be marked complete after the running app passes visual and workflow review.',
    defaultSourceUrl: 'https://app.notion.com/p/38441c470daf8180ac53ca24439be793'
  }
}

function stageFor(kind: StageKind, item: DeploymentFeature): StageStatus {
  return kind === 'backend' ? backendStage(item) : frontendStage(item)
}

function groupedByArea(rows: DeploymentFeature[]) {
  return rows.reduce<Record<string, DeploymentFeature[]>>((acc, row) => {
    acc[row.area] = acc[row.area] ?? []
    acc[row.area].push(row)
    return acc
  }, {})
}

function percent(done: number, total: number) {
  if (!total) return 0
  return Math.round((done / total) * 100)
}

function stagePercent(status: StageStatus) {
  if (status === 'complete') return 100
  if (status === 'needs-audit') return 50
  return 0
}

function stageGaugeState(status: StageStatus) {
  if (status === 'complete') return 'complete' as const
  if (status === 'needs-audit') return 'halted' as const
  return 'stopped' as const
}

export function DocmeeDeploymentStage({ kind }: { kind: StageKind }) {
  const copy = stageCopy[kind]
  const source = readDevelopmentSources()[kind]
  const sourceUrl = source?.url || copy.defaultSourceUrl
  const features = readDeploymentFeatures().sort((a, b) => a.id - b.id)
  const record = deploymentRecordFor(kind)
  const complete = features.filter((item) => stageFor(kind, item) === 'complete')
  const needsAudit = features.filter((item) => stageFor(kind, item) === 'needs-audit')
  const pending = features.filter((item) => stageFor(kind, item) === 'pending')
  const focusRows = kind === 'backend' ? [...complete, ...pending, ...needsAudit] : [...needsAudit, ...pending, ...complete]
  const progress = percent(complete.length, features.length)
  const phaseCounts = countBy(focusRows, (item) => item.phase)
  const areaCounts = countBy(focusRows, (item) => item.area)
  const areaGroups = groupedByArea(focusRows)
  const heartbeatState = kind === 'backend'
    ? complete.length === features.length ? 'normal' : 'delayed'
    : needsAudit.length > 0 ? 'checking' : 'normal'

  return (
    <section>
      <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-col items-stretch gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-cyan-200/80">{copy.eyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold">{copy.title}</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-400">{copy.description}</p>
            {record && <p className="mt-2 text-xs text-slate-500">Record group: {record.title} · Source: {record.statusField}</p>}
            {source && <p className={source.status === 'error' ? 'mt-2 text-xs text-red-300' : 'mt-2 text-xs text-slate-500'}>{source.message ?? 'Notion source linked.'}{source.syncedAt ? ` Synced ${new Date(source.syncedAt).toLocaleString()}.` : ''}</p>}
          </div>
          <div className="responsive-actions">
            <Link href={sourceUrl} target="_blank" className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              Open Notion Source
            </Link>
            <form action="/api/actions" method="post" className="flex min-w-0 flex-col gap-2 sm:flex-row">
              <input type="hidden" name="action" value="set-development-source" />
              <input type="hidden" name="lane" value={kind} />
              <input type="hidden" name="redirectTo" value={copy.route} />
              <input name="sourceUrl" defaultValue={sourceUrl} className="min-h-11 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 sm:w-72" aria-label={`${kind} Notion source URL`} />
              <button className="min-h-11 rounded-md border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">Set Notion Source</button>
            </form>
            <Link href="/docmee-deployment" className="min-h-11 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
              Deployment Home
            </Link>
            <Link href={copy.oppositeRoute} className="min-h-11 rounded-md border border-cyan-700 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-950/40">
              {copy.oppositeLabel}
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs text-slate-500">Heartbeat</p>
            <div className="mt-3 flex items-center gap-3">
              <span className={`heartbeat-heart ${heartbeatState === 'normal' ? 'heartbeat-heart-live text-emerald-300' : 'text-cyan-200'}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
                  <path d="M12 21s-7.2-4.6-9.5-9.1C.6 8.1 2.8 4 6.8 4c2 0 3.7 1 5.2 2.9C13.5 5 15.2 4 17.2 4c4 0 6.2 4.1 4.3 7.9C19.2 16.4 12 21 12 21Z" />
                </svg>
              </span>
              <div>
                <p className="text-sm font-semibold">{heartbeatState === 'normal' ? 'Normal' : 'Checking'}</p>
                <p className="text-xs text-slate-500">Stage monitor</p>
              </div>
            </div>
          </div>
          <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
            <p className="text-xs text-slate-500">Designed features</p>
            <p className="mt-2 text-3xl font-semibold">{features.length}</p>
          </div>
          <div className="rounded-md border border-emerald-900 bg-emerald-950/20 p-4">
            <p className="text-xs text-emerald-200/70">{copy.primaryLabel}</p>
            <p className="mt-2 text-3xl font-semibold text-emerald-200">{complete.length}</p>
          </div>
          <div className="rounded-md border border-amber-900 bg-amber-950/20 p-4">
            <p className="text-xs text-amber-200/70">{copy.auditLabel}</p>
            <p className="mt-2 text-3xl font-semibold text-amber-200">{needsAudit.length}</p>
          </div>
          <div className="rounded-md border border-cyan-900 bg-cyan-950/20 p-4">
            <p className="text-xs text-cyan-200/70">Progress</p>
            <div className="mt-3">
              <BuildProgressGauge
                percent={progress}
                state={progress === 100 ? 'complete' : progress > 0 ? 'halted' : 'stopped'}
                label={`${progress}% ${kind === 'frontend' ? 'accepted' : 'complete'}`}
                message={`${complete.length}/${features.length} records`}
              />
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {copy.process.map((step, index) => (
              <div key={step} className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
                <BuildProgressGauge
                  percent={index === 0 ? 100 : progress}
                  state={index === 0 || progress === 100 ? 'complete' : progress > 0 ? 'halted' : 'stopped'}
                  size="sm"
                  centerText={String(index + 1)}
                  label={`Step ${index + 1}`}
                  message={step}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 rounded-md border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold">{copy.recordTitle}</h2>
          <p className="mt-2 text-sm text-slate-400">{copy.recordIntro}</p>
          <div className="mt-4 space-y-4">
            {Object.entries(areaGroups).map(([area, rows]) => (
              <details key={area} open={kind === 'backend'} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                <summary className="flex cursor-pointer list-none flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-100">{area}</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      {rows.filter((item) => stageFor(kind, item) === 'complete').length}/{rows.length} {kind === 'frontend' ? 'accepted' : 'complete'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <BuildProgressGauge
                      percent={percent(rows.filter((item) => stageFor(kind, item) === 'complete').length, rows.length)}
                      state={rows.every((item) => stageFor(kind, item) === 'complete') ? 'complete' : 'halted'}
                      showLabel={false}
                      size="sm"
                    />
                    <span className="rounded border border-slate-700 px-2 py-1 text-xs text-cyan-200 details-toggle-label">Collapse</span>
                  </div>
                </summary>
                <div className="mt-3 space-y-3">
                  {rows.map((item) => {
                    const stage = stageFor(kind, item)
                    return (
                      <details key={item.id} className="rounded-md border border-slate-800 bg-slate-900/70 p-3">
                        <summary className="flex cursor-pointer list-none flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <BuildProgressGauge
                            percent={stagePercent(stage)}
                            state={stageGaugeState(stage)}
                            size="sm"
                            showLabel={false}
                            centerText={String(item.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-slate-500">Req {item.id} · {item.phase}</p>
                            <h4 className="mt-1 text-sm font-semibold text-slate-100">{item.feature}</h4>
                            <p className="mt-2 text-xs leading-5 text-slate-400">{shortText(kind === 'backend' ? item.evidence : item.nextStep)}</p>
                          </div>
                          <div className="responsive-record-row-actions flex items-center gap-2">
                            <StatusDot tone={stageDot(stage)} label={stageLabel(stage)} />
                            <StatusDot tone={priorityDot(item.priority)} label={`Priority: ${item.priority}`} />
                            <span className="rounded border border-slate-700 px-2 py-1 text-xs text-cyan-200 details-toggle-label">Collapse</span>
                          </div>
                        </summary>
                        <div className="mt-4 grid gap-3">
                          <div className="rounded border border-cyan-900/70 bg-cyan-950/20 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200/80">{kind === 'backend' ? 'Completed backend details' : 'Frontend acceptance details'}</p>
                            <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-cyan-100">{kind === 'backend' ? item.evidence : item.nextStep}</p>
                          </div>
                          <div className="rounded border border-slate-800 bg-slate-900/70 p-3">
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kind === 'backend' ? 'Frontend follow-up' : 'Backend context'}</p>
                            <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-slate-300">{kind === 'backend' ? item.nextStep : item.evidence}</p>
                          </div>
                        </div>
                      </details>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">{copy.processTitle}</h2>
            <div className="mt-3 space-y-2">
              {copy.checklist.map((item, index) => (
                <div key={item} className="flex gap-3 rounded border border-slate-800 px-3 py-2 text-sm">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-cyan-950 text-xs text-cyan-100">{index + 1}</span>
                  <span className="leading-6 text-slate-300">{item}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2">
              <Link href={kind === 'frontend' ? '/frontend-build-control' : '/ready'} className="min-h-11 rounded-md bg-cyan-500 px-4 py-3 text-center text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                {kind === 'frontend' ? 'Open Frontend Start Check' : 'Run Ready Check'}
              </Link>
              <Link href={kind === 'frontend' ? '/frontend-build-control' : '/build-control'} className="min-h-11 rounded-md border border-cyan-700 px-4 py-3 text-center text-sm text-cyan-100 hover:bg-cyan-950/40">
                {kind === 'frontend' ? 'Open Frontend Build Control' : 'Open Backend Build Control'}
              </Link>
              <Link href="/deploy" className="min-h-11 rounded-md border border-slate-700 px-4 py-3 text-center text-sm text-slate-200 hover:bg-slate-800">
                Open Deployment Actions
              </Link>
              <Link href="/post-deployment" className="min-h-11 rounded-md border border-slate-700 px-4 py-3 text-center text-sm text-slate-200 hover:bg-slate-800">
                Open Deployment Report
              </Link>
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Grouped by Phase</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(phaseCounts).map(([phase, count]) => (
                <div key={phase} className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm">
                  <span>{phase}</span>
                  <span className="rounded bg-slate-800 px-2 py-1 text-xs">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-slate-800 bg-slate-900 p-4">
            <h2 className="text-sm font-semibold">Grouped by Category</h2>
            <div className="mt-3 space-y-2">
              {Object.entries(areaCounts).map(([area, count]) => (
                <div key={area} className="flex items-center justify-between rounded border border-slate-800 px-3 py-2 text-sm">
                  <span>{area}</span>
                  <span className="rounded bg-slate-800 px-2 py-1 text-xs">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-md border border-amber-900/70 bg-amber-950/20 p-4">
            <h2 className="text-sm font-semibold text-amber-100">Stage Rule</h2>
            <p className="mt-2 text-sm leading-6 text-amber-100/80">{copy.finalNote}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
