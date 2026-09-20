import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL('../../supabase/migrations/20260920000001_kb_freshness.sql', import.meta.url),
  'utf8',
)

describe('KB freshness migration safety', () => {
  it('keeps an uncertain legacy v1 chunk withdrawn when its document is already v2', () => {
    // Fixture represented by the migration boundary: a document was edited to v2/current
    // text, while its pre-migration chunk still contains the old v1 text. The migration
    // must never relabel or activate that old text as v2 evidence.
    expect(migration).toMatch(/UPDATE knowledge_chunks\s+SET is_active = false/i)
    expect(migration).not.toMatch(/SET document_version = d\.version/i)
    expect(migration).not.toMatch(/approved_at = COALESCE\(approved_at, updated_at\)/i)
  })

  it('treats an absent embedding metadata object as missing rather than ready', () => {
    expect(migration).toContain("NOT COALESCE((c.metadata -> 'embedding') ? 'v', false)")
  })
})
