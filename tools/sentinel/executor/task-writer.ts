import fs from 'node:fs'
import path from 'node:path'
import { tasksDir } from '../lib/paths.js'
import type { SentinelIssue } from '../lib/issues.js'
import type { PermissionEnvelope } from './permissions.js'

/**
 * Build a scoped task file for an AI provider. Cybersecure-by-design (Platform
 * Principle 8): we construct the task from Sentinel's own typed issue fields —
 * never from raw external content — and embed the permission envelope so the
 * agent operates inside a minimal blast radius.
 */
export function writeTaskFile(issue: SentinelIssue, envelope: PermissionEnvelope): string {
  fs.mkdirSync(tasksDir, { recursive: true })
  const file = path.join(tasksDir, `${issue.id}.task.md`)
  const lines = [
    `# Sentinel Task — ${issue.id}`,
    '',
    `Source: ${issue.source}`,
    `Environment: ${issue.environment}`,
    `Severity: ${issue.severity}`,
    `Category: ${issue.category}`,
    `Assigned agent: ${issue.assignedAgent}`,
    '',
    '## Diagnosis',
    issue.diagnosis,
    '',
    '## Evidence',
    ...issue.evidence.map((e) => `- ${e}`),
    '',
    '## Source signals',
    ...issue.sourceSignals.map((s) => `- ${s}`),
    '',
    '## Suggested fix',
    issue.suggestedFix,
    '',
    '## Permission envelope (do NOT exceed)',
    `Allowed: ${envelope.allowedActions.join(', ')}`,
    `Denied:  ${envelope.deniedActions.join(', ')}`,
    '',
    '## Rules',
    '- Stay within the allowed actions. Never perform a denied action.',
    '- Make the smallest change that resolves the issue.',
    '- Report what you changed so Sentinel can verify the signal cleared.'
  ]
  fs.writeFileSync(file, `${lines.join('\n')}\n`)
  return file
}

export function taskLogPath(issueId: string): string {
  return path.join(tasksDir, `${issueId}.log`)
}
