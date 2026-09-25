export interface KbRetrievalCacheKeyInput {
  clinicId: string
  revision: number
  normalizedQuery: string
  language?: string | null
  doctorId?: string | null
  intent?: string | null
}

export function kbRetrievalCacheKey(input: KbRetrievalCacheKeyInput): string {
  return JSON.stringify([
    input.clinicId,
    input.revision,
    input.normalizedQuery,
    input.language ?? '',
    input.doctorId ?? '',
    input.intent ?? '',
  ])
}

export interface KbRetrievalCache<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  clear(): void
}

export function createKbRetrievalCache<T>(options: {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
} = {}): KbRetrievalCache<T> {
  const ttlMs = Math.max(1, options.ttlMs ?? 30_000)
  const maxEntries = Math.max(1, options.maxEntries ?? 500)
  const now = options.now ?? Date.now
  const entries = new Map<string, { value: T; expiresAt: number }>()

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (entry.expiresAt <= now()) {
        entries.delete(key)
        return undefined
      }
      entries.delete(key)
      entries.set(key, entry)
      return entry.value
    },
    set(key, value) {
      entries.delete(key)
      entries.set(key, { value, expiresAt: now() + ttlMs })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined
        if (oldest === undefined) break
        entries.delete(oldest)
      }
    },
    clear() {
      entries.clear()
    },
  }
}
