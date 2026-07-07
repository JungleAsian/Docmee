import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cosineSimilarity, rankChunks, searchKb, type EmbeddedChunk } from '../botbase/kb-retriever.js'

const chunk = (title: string, embedding: number[]): EmbeddedChunk => ({
  title,
  content: `${title} content`,
  embedding,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cosineSimilarity', () => {
  it('identical vectors → 1', () => {
    expect(cosineSimilarity([1, 0, 1], [1, 0, 1])).toBeCloseTo(1)
  })

  it('orthogonal vectors → 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
  })

  it('zero vector → 0 (no NaN)', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('rankChunks', () => {
  const chunks = [chunk('exact', [1, 0, 0]), chunk('orthogonal', [0, 1, 0]), chunk('similar', [0.9, 0.1, 0])]

  it('filters below threshold and sorts by similarity desc', () => {
    const matches = rankChunks([1, 0, 0], chunks, 0.5, 5)
    expect(matches.map((m) => m.title)).toEqual(['exact', 'similar'])
    expect(matches[0]!.similarity).toBeGreaterThan(matches[1]!.similarity)
  })

  it('respects the limit', () => {
    expect(rankChunks([1, 0, 0], chunks, 0, 1)).toHaveLength(1)
  })
})

describe('searchKb', () => {
  it('embeds the query and ranks the clinic chunks', async () => {
    const embed = vi.fn().mockResolvedValue([1, 0, 0])
    const matches = await searchKb('hi', [chunk('exact', [1, 0, 0]), chunk('off', [0, 1, 0])], embed, 0.5)
    expect(embed).toHaveBeenCalledWith('hi')
    expect(matches.map((m) => m.title)).toEqual(['exact'])
  })

  it('short-circuits with no chunks (no embedding call)', async () => {
    const embed = vi.fn()
    const matches = await searchKb('hi', [], embed)
    expect(matches).toEqual([])
    expect(embed).not.toHaveBeenCalled()
  })
})
