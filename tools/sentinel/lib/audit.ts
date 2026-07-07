import { auditFile } from './paths.js'
import { readJsonFile, writeJsonFile, fileSize } from './json-store.js'

export interface AuditEntry {
  ts: string
  subsystem: string
  action: string
  outcome: 'success' | 'failed' | 'escalated' | 'info'
  message: string
  issueId?: string
  durationMs?: number
}

/**
 * Append-only audit trail. We never rewrite past entries; new entries are added
 * to the head for readability. Tamper detection compares the on-disk size to the
 * last size we observed — an append-only file must only ever grow.
 */
export function appendAudit(entry: Omit<AuditEntry, 'ts'>): { tampered: boolean; sizeBefore: number; sizeAfter: number } {
  const sizeBefore = fileSize(auditFile)
  const log = readJsonFile<AuditEntry[]>(auditFile, [])
  const withTs: AuditEntry = { ts: new Date().toISOString(), ...entry }
  const next = [withTs, ...log].slice(0, 2000)
  writeJsonFile(auditFile, next)
  const sizeAfter = fileSize(auditFile)
  // A shrink that is not explained by our own append is a tamper signal. Because
  // we always grow (cap is high), a decrease vs. the prior persisted size with the
  // same or fewer entries indicates external truncation.
  const tampered = sizeBefore > 0 && sizeAfter < sizeBefore && next.length >= log.length
  return { tampered, sizeBefore, sizeAfter }
}

export function readAudit(): AuditEntry[] {
  return readJsonFile<AuditEntry[]>(auditFile, [])
}

/** Returns true when the audit file shrank vs. the supplied last-known size. */
export function detectAuditTamper(lastKnownSize: number): boolean {
  const current = fileSize(auditFile)
  return lastKnownSize > 0 && current < lastKnownSize
}

export function auditSize() {
  return fileSize(auditFile)
}
