import type { SentinelAgentRole } from '../config/schema.js'

export interface PermissionEnvelope {
  allowedActions: string[]
  deniedActions: string[]
  maxRestartsPerHour?: number
  cooldownSeconds?: number
  escalateAfterAttempts?: number
}

/** DevTools Healer envelope (Platform + Daemon spec). The only deterministic recoverer. */
export const HEALER_PERMISSIONS: PermissionEnvelope = {
  allowedActions: ['kill-dashboard-process', 'clear-next-cache', 'restart-dashboard-process', 'kill-port-conflict', 'refresh-derived-deployment-records'],
  deniedActions: ['modify-source-files', 'run-git-commands', 'modify-env-files', 'touch-build-watcher', 'modify-phase-state'],
  maxRestartsPerHour: 3,
  cooldownSeconds: 120,
  escalateAfterAttempts: 3
}

/** Scoped envelopes handed to AI agents in their task file. Minimal blast radius. */
export const AGENT_PERMISSIONS: Record<SentinelAgentRole, PermissionEnvelope> = {
  diagnostics: { allowedActions: ['run-pnpm-tool-diagnose'], deniedActions: ['modify-source-files', 'run-git-commands'] },
  'dashboard-ui': { allowedActions: ['edit-dashboard-files', 'clear-next-cache', 'restart-dashboard-process'], deniedActions: ['run-git-commands', 'modify-env-files', 'modify-phase-state'] },
  'cli-build': { allowedActions: ['edit-cli-files', 'run-build', 'run-gates'], deniedActions: ['modify-phase-state', 'modify-env-files'] },
  'git-github': { allowedActions: ['propose-rebase-strategy', 'run-git-status'], deniedActions: ['force-push', 'modify-source-files'] },
  'claude-session': { allowedActions: ['read-usage-guard'], deniedActions: ['modify-source-files', 'run-git-commands'] },
  'notion-integration': { allowedActions: ['notion-mcp-read', 'notion-mcp-write'], deniedActions: ['modify-source-files', 'run-git-commands'] },
  deployment: { allowedActions: ['propose-deploy-subcommands'], deniedActions: ['execute-deploy-without-approval', 'modify-env-files'] }
}

export function isActionAllowed(envelope: PermissionEnvelope, action: string) {
  if (envelope.deniedActions.includes(action)) return false
  return envelope.allowedActions.includes(action)
}
