import { logFileFor } from '../lib/paths.js'
import { writeJsonFile, readJsonFile } from '../lib/json-store.js'

export type TrayState = 'starting' | 'healthy' | 'warning' | 'critical' | 'fixing'

export interface TraySubsystem {
  name: string
  status: 'online' | 'offline' | 'not-configured' | 'paused'
  detail?: string
}

export interface TrayModel {
  state: TrayState
  statusLine: string
  activeIssues: number
  subsystems: TraySubsystem[]
  updatedAt: string
}

const TRAY_FILE = logFileFor('sentinel-tray.json')

export interface TrayInput {
  starting: boolean
  agentRunning: boolean
  critical: number
  warning: number
  activeIssues: number
  subsystems: TraySubsystem[]
}

/** Single-state tray colour with the documented precedence. */
export function computeTrayState(input: TrayInput): TrayState {
  if (input.starting) return 'starting'
  if (input.agentRunning) return 'fixing'
  if (input.critical > 0) return 'critical'
  if (input.warning > 0) return 'warning'
  return 'healthy'
}

function statusLineFor(state: TrayState, input: TrayInput): string {
  switch (state) {
    case 'starting':
      return 'Sentinel — Starting'
    case 'fixing':
      return 'Sentinel — Fixing in progress'
    case 'critical':
      return `Sentinel — ${input.critical} critical`
    case 'warning':
      return `Sentinel — ${input.warning} warning`
    default:
      return 'Sentinel — All Healthy'
  }
}

/** Recompute and persist the tray model. The Tauri launcher reads this file to render the tray. */
export function writeTray(input: TrayInput): TrayModel {
  const state = computeTrayState(input)
  const model: TrayModel = {
    state,
    statusLine: statusLineFor(state, input),
    activeIssues: input.activeIssues,
    subsystems: input.subsystems,
    updatedAt: new Date().toISOString()
  }
  writeJsonFile(TRAY_FILE, model)
  return model
}

export function readTray(): TrayModel | null {
  return readJsonFile<TrayModel | null>(TRAY_FILE, null)
}
