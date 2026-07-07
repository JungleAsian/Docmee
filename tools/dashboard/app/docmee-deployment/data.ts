import fs from 'node:fs'
import path from 'node:path'

const toolsRoot = path.resolve(process.cwd(), '..')
const coverageFile = path.join(toolsRoot, 'logs', 'rev1-feature-coverage.json')
const deploymentRecordsFile = path.join(toolsRoot, 'logs', 'docmee-deployment-records.json')
const uiDevelopmentRecordsFile = path.join(toolsRoot, 'logs', 'ui-development-records.json')
const developmentSourcesFile = path.join(toolsRoot, 'logs', 'development-sources.json')

export type StageStatus = 'complete' | 'pending' | 'needs-audit'
export type FeatureStatus = 'complete' | 'partial' | 'missing'
export type DeploymentFeature = {
  id: number
  phase: string
  area: string
  feature: string
  status: FeatureStatus
  backendStatus?: StageStatus
  frontendStatus?: StageStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  evidence: string
  nextStep: string
}
export type DeploymentStageRecord = {
  id: 'backend' | 'frontend'
  title: string
  route: string
  statusField: 'backendStatus' | 'frontendStatus'
  completeMeaning: string
  detailFields: string[]
  summary: {
    designedFeatures: number
    complete: number
    pending: number
    needsAudit: number
  }
}
export type DeploymentRecords = {
  record: string
  updatedAt: string
  source: string
  groups: DeploymentStageRecord[]
  notes: string[]
}
export type DevelopmentSources = Partial<Record<'backend' | 'frontend' | 'ui', { url: string; syncedAt?: string; status?: string; message?: string; itemCount?: number }>>
export type UiDevelopmentRecord = {
  id: number
  screen: string
  phase: string
  featuresCovered: string
  status: string
  priority: 'critical' | 'high' | 'medium' | 'low'
  source: string
  nextStep: string
}

export function readDeploymentFeatures() {
  if (!fs.existsSync(coverageFile)) return [] as DeploymentFeature[]
  try {
    return JSON.parse(fs.readFileSync(coverageFile, 'utf8')) as DeploymentFeature[]
  } catch {
    return [] as DeploymentFeature[]
  }
}

export function readDeploymentRecords() {
  if (!fs.existsSync(deploymentRecordsFile)) return null as DeploymentRecords | null
  try {
    return JSON.parse(fs.readFileSync(deploymentRecordsFile, 'utf8')) as DeploymentRecords
  } catch {
    return null as DeploymentRecords | null
  }
}

export function readDevelopmentSources() {
  if (!fs.existsSync(developmentSourcesFile)) return {} as DevelopmentSources
  try {
    return JSON.parse(fs.readFileSync(developmentSourcesFile, 'utf8')) as DevelopmentSources
  } catch {
    return {} as DevelopmentSources
  }
}

export function readUiDevelopmentRecords() {
  if (!fs.existsSync(uiDevelopmentRecordsFile)) return [] as UiDevelopmentRecord[]
  try {
    return JSON.parse(fs.readFileSync(uiDevelopmentRecordsFile, 'utf8')) as UiDevelopmentRecord[]
  } catch {
    return [] as UiDevelopmentRecord[]
  }
}

export function deploymentRecordFor(id: DeploymentStageRecord['id']) {
  return readDeploymentRecords()?.groups.find((group) => group.id === id) ?? null
}

export function backendStage(item: DeploymentFeature): StageStatus {
  if (item.backendStatus) return item.backendStatus
  return item.status === 'complete' ? 'complete' : 'pending'
}

export function frontendStage(item: DeploymentFeature): StageStatus {
  if (item.frontendStatus) return item.frontendStatus
  return item.status === 'complete' ? 'needs-audit' : 'pending'
}

export function stageTone(status: StageStatus) {
  if (status === 'complete') return 'border-emerald-700 bg-emerald-950/30 text-emerald-200'
  if (status === 'needs-audit') return 'border-cyan-700 bg-cyan-950/30 text-cyan-100'
  return 'border-amber-700 bg-amber-950/30 text-amber-200'
}

export function priorityTone(priority: DeploymentFeature['priority']) {
  if (priority === 'critical') return 'border-red-700 bg-red-950/40 text-red-100'
  if (priority === 'high') return 'border-orange-700 bg-orange-950/30 text-orange-100'
  if (priority === 'medium') return 'border-amber-700 bg-amber-950/30 text-amber-100'
  return 'border-slate-700 bg-slate-800 text-slate-200'
}

export function stageLabel(status: StageStatus) {
  if (status === 'complete') return 'Complete'
  if (status === 'needs-audit') return 'Needs audit'
  return 'Pending'
}

export function priorityDot(priority: DeploymentFeature['priority']) {
  if (priority === 'critical') return 'red' as const
  if (priority === 'high') return 'orange' as const
  if (priority === 'medium') return 'amber' as const
  return 'slate' as const
}

export function stageDot(status: StageStatus) {
  if (status === 'complete') return 'green' as const
  if (status === 'needs-audit') return 'cyan' as const
  return 'amber' as const
}

export function countBy<T extends string>(rows: DeploymentFeature[], read: (row: DeploymentFeature) => T) {
  return rows.reduce<Record<T, number>>((acc, row) => {
    const key = read(row)
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {} as Record<T, number>)
}

export function shortText(value: string, max = 240) {
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}...` : clean
}
