import { readIssues, type IssueSource } from '../lib/issues.js'

export type Rescan = (source: IssueSource) => void

/**
 * Post-fix signal verification. After an agent claims a fix, we re-run the source
 * scanner and confirm the issue's stable id is no longer active. A fix is only
 * "resolved" when the underlying signal clears — not when the agent says so.
 */
export function verifyResolved(issueId: string, source: IssueSource, rescan: Rescan): boolean {
  rescan(source)
  const stillActive = readIssues().some((i) => i.id === issueId && !['resolved', 'ignored'].includes(i.status))
  return !stillActive
}
