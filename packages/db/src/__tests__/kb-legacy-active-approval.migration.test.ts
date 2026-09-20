import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260920000005_legacy_active_kb_approval.sql', import.meta.url),
  'utf8',
)

describe('legacy active KB approval migration', () => {
  it('migrates only the historic staff-published active rows into explicit approval provenance', () => {
    expect(migration).toMatch(/WHERE status = 'active'\s+AND approved_at IS NULL/i)
    expect(migration).toContain("'{approvalProvenance}'")
    expect(migration).toContain('legacy_active_before_governed_upgrade')
    expect(migration).toContain('approved_at = updated_at')
  })

  it('does not reactivate or relabel legacy chunks', () => {
    expect(migration).not.toMatch(/UPDATE knowledge_chunks/i)
    expect(migration).not.toMatch(/SET document_version/i)
  })
})
