import { issuesFile } from './paths.js'
import { readJsonFile, writeJsonFile } from './json-store.js'

export type IssueSource = 'forge' | 'guardian' | 'aegis' | 'heartbeat' | 'devtools-healer' | 'cortex' | 'tunnel'
export type IssueEnvironment = 'development' | 'production'
export type SentinelSeverity = 'info' | 'warning' | 'critical'
export type SentinelStatus = 'detected' | 'assigned' | 'fixing' | 'waiting-approval' | 'resolved' | 'failed' | 'ignored' | 'interrupted'
export type SentinelRisk = 'low' | 'medium' | 'high'

/**
 * Unified issue record. Every sub-system writes incidents using this one shape
 * (Platform Principle 5 — one handoff contract). Optional fields carry
 * sub-system specifics (Forge/Guardian/Aegis schema additions).
 */
export interface SentinelIssue {
  id: string
  source: IssueSource
  environment: IssueEnvironment
  createdAt: string
  updatedAt: string
  phase: string
  severity: SentinelSeverity
  category: string
  status: SentinelStatus
  diagnosis: string
  evidence: string[]
  sourceSignals: string[]
  suggestedFix: string
  riskLevel: SentinelRisk
  requiresApproval: boolean
  assignedAgent: string
  assignedProvider: string
  attempts: number
  resolution: string

  // Forge
  buildPhase?: string
  phaseStatus?: string
  claudeSessionPct?: number

  // Guardian / Aegis shared
  checkCategory?: string
  checkName?: string
  consecutiveFailures?: number

  // Guardian
  recoveryAttemptsBeforeEscalation?: number
  guardianLockedUntil?: string

  // Aegis
  clinicId?: string
  affectedFeature?: string
  patientImpact?: boolean
  complianceRisk?: boolean
}

export type IssueDraft = Pick<
  SentinelIssue,
  'source' | 'environment' | 'phase' | 'severity' | 'category' | 'diagnosis' | 'evidence' | 'sourceSignals' | 'suggestedFix' | 'riskLevel' | 'requiresApproval' | 'assignedAgent' | 'assignedProvider'
> &
  Partial<SentinelIssue>

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 90)
}

/** Stable id so repeated detections of the same condition de-duplicate. */
export function issueId(draft: Pick<SentinelIssue, 'source' | 'category' | 'phase' | 'checkName'>) {
  return `${draft.source}-${slug(`${draft.category}-${draft.phase}-${draft.checkName ?? ''}`)}`
}

export function readIssues(): SentinelIssue[] {
  return readJsonFile<SentinelIssue[]>(issuesFile, [])
}

export function writeIssues(issues: SentinelIssue[]) {
  writeJsonFile(issuesFile, issues)
}

/**
 * Merge freshly-detected drafts into the persisted queue. Existing non-resolved
 * issues keep their status/attempts/resolution; resolved+ignored history is
 * retained (capped) so the queue does not grow unbounded.
 */
export function mergeIssues(drafts: IssueDraft[]): SentinelIssue[] {
  const now = new Date().toISOString()
  const previous = readIssues()
  const previousById = new Map(previous.map((issue) => [issue.id, issue]))
  const seen = new Set<string>()

  const next: SentinelIssue[] = drafts.map((draft) => {
    const id = draft.id ?? issueId(draft)
    seen.add(id)
    const existing = previousById.get(id)
    const keepStatus = existing && existing.status !== 'resolved' && existing.status !== 'ignored'
    return {
      attempts: existing?.attempts ?? 0,
      resolution: existing?.resolution ?? '',
      ...draft,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      status: keepStatus ? existing!.status : 'detected'
    } satisfies SentinelIssue
  })

  // Carry forward issues that were resolved/ignored, plus any active issue from a
  // DIFFERENT source not covered by this draft set (so one scanner doesn't wipe another's queue).
  const retained = previous.filter((issue) => {
    if (seen.has(issue.id)) return false
    return issue.status === 'resolved' || issue.status === 'ignored' || !drafts.some((d) => d.source === issue.source)
  })

  return [...next, ...retained].slice(0, 400)
}

/** Replace only the issues for a single source, preserving every other source's issues. */
export function mergeIssuesForSource(source: IssueSource, drafts: IssueDraft[]): SentinelIssue[] {
  const now = new Date().toISOString()
  const previous = readIssues()
  const previousById = new Map(previous.map((issue) => [issue.id, issue]))
  const seen = new Set<string>()

  const next: SentinelIssue[] = drafts.map((d) => {
    const draft = { ...d, source }
    const id = draft.id ?? issueId(draft)
    seen.add(id)
    const existing = previousById.get(id)
    const keepStatus = existing && existing.status !== 'resolved' && existing.status !== 'ignored'
    return {
      attempts: existing?.attempts ?? 0,
      resolution: existing?.resolution ?? '',
      ...draft,
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      status: keepStatus ? existing!.status : 'detected'
    } satisfies SentinelIssue
  })

  const retained = previous.filter((issue) => {
    if (issue.source !== source) return true // other sources untouched
    if (seen.has(issue.id)) return false // re-detected → replaced by `next`
    return issue.status === 'resolved' || issue.status === 'ignored' // keep this source's history only
  })

  return [...next, ...retained].slice(0, 400)
}

export function updateIssue(id: string, patch: Partial<SentinelIssue>): SentinelIssue | null {
  const issues = readIssues()
  const idx = issues.findIndex((issue) => issue.id === id)
  if (idx === -1) return null
  issues[idx] = { ...issues[idx], ...patch, updatedAt: new Date().toISOString() }
  writeIssues(issues)
  return issues[idx]
}

export function activeIssues(issues = readIssues()) {
  return issues.filter((issue) => !['resolved', 'ignored'].includes(issue.status))
}

export function issueSummary(issues = readIssues()) {
  const active = activeIssues(issues)
  return {
    active: active.length,
    critical: active.filter((i) => i.severity === 'critical').length,
    warning: active.filter((i) => i.severity === 'warning').length,
    info: active.filter((i) => i.severity === 'info').length,
    approval: active.filter((i) => i.requiresApproval || i.status === 'waiting-approval').length,
    safe: active.filter((i) => !i.requiresApproval).length
  }
}
