import { describe, expect, it } from 'vitest'
import { createKbRetrievalCache, kbRetrievalCacheKey } from '../botbase/kb-retrieval-cache.js'

describe('KB retrieval cache', () => {
  it('includes clinic, revision, query, language, doctor, and intent in its key', () => {
    expect(kbRetrievalCacheKey({
      clinicId: 'clinic-a', revision: 7, normalizedQuery: 'hours', language: 'en', doctorId: 'doctor-a', intent: 'hours',
    })).not.toBe(kbRetrievalCacheKey({
      clinicId: 'clinic-a', revision: 8, normalizedQuery: 'hours', language: 'en', doctorId: 'doctor-a', intent: 'hours',
    }))
  })

  it('expires entries and never reuses one after the KB revision changes', () => {
    let now = 1_000
    const cache = createKbRetrievalCache<string>({ ttlMs: 30_000, now: () => now })
    const first = kbRetrievalCacheKey({ clinicId: 'clinic-a', revision: 1, normalizedQuery: 'hours', language: 'en', intent: 'hours' })
    const revised = kbRetrievalCacheKey({ clinicId: 'clinic-a', revision: 2, normalizedQuery: 'hours', language: 'en', intent: 'hours' })

    cache.set(first, 'old')
    expect(cache.get(first)).toBe('old')
    expect(cache.get(revised)).toBeUndefined()
    now += 30_001
    expect(cache.get(first)).toBeUndefined()
  })

  it('evicts the least-recently-used entry at the bound', () => {
    const cache = createKbRetrievalCache<string>({ maxEntries: 2 })
    cache.set('a', 'A')
    cache.set('b', 'B')
    expect(cache.get('a')).toBe('A')
    cache.set('c', 'C')

    expect(cache.get('a')).toBe('A')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('C')
  })
})
