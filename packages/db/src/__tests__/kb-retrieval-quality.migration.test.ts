import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260925000001_kb_retrieval_quality.sql', import.meta.url)), 'utf8')

describe('KB retrieval quality migration', () => {
  it('adds canonical fact and content identity for deterministic conflict handling', () => {
    expect(migration).toMatch(/canonical_fact_key/i)
    expect(migration).toMatch(/content_hash/i)
    expect(migration).toMatch(/authority/i)
  })

  it('stores aggregate retrieval telemetry without raw patient text', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS knowledge_retrieval_metrics/i)
    expect(migration).toMatch(/query_hash/i)
    expect(migration).not.toMatch(/raw_query|raw_answer/i)
  })
})
