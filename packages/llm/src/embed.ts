// Multi-provider text embeddings for the clinic KB. OpenAI is the default (and the
// default model reuses providers/openai.ts so existing 1536-dim vectors stay
// comparable). Custom = any OpenAI-compatible embeddings endpoint (baseURL).
// Gemini uses raw fetch. Embeddings are stored as JSON (knowledge_chunks.metadata
// .embedding.v) and compared with in-process cosine, so dimensions may differ across
// providers — the only rule is that a clinic's query + chunks use the SAME provider/
// model, which is why switching requires a KB re-index.
import OpenAI from 'openai'
import { embedText } from './providers/openai.js'

export type EmbedProvider = 'openai' | 'gemini' | 'custom' | 'local'

export interface EmbedOpts {
  provider: EmbedProvider
  text: string
  apiKey?: string
  model?: string
  baseURL?: string
}

const DEFAULT_EMBED_MODEL: Record<EmbedProvider, string> = {
  openai: 'text-embedding-3-small',
  gemini: 'text-embedding-004',
  custom: '',
  local: 'docmee-local-hash-1536',
}

export function defaultEmbedModel(provider: EmbedProvider): string {
  return DEFAULT_EMBED_MODEL[provider] ?? DEFAULT_EMBED_MODEL.openai
}

export async function embed(o: EmbedOpts): Promise<number[]> {
  if (process.env['LLM_STUB'] === 'true') return new Array(1536).fill(0) as number[]
  switch (o.provider) {
    case 'local':
      return localEmbed(o.text)
    case 'gemini':
      return geminiEmbed(o)
    case 'custom':
      return openaiEmbed(o, true)
    case 'openai':
    default: {
      const model = o.model?.trim()
      // Default openai/text-embedding-3-small path reuses embedText (1536 dims) so
      // it stays byte-identical to vectors written before this change.
      if (!model || model === 'text-embedding-3-small') return embedText(o.text, o.apiKey)
      return openaiEmbed(o, false)
    }
  }
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function tokens(value: string): string[] {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 2)
}

function hashToken(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function localEmbed(text: string): number[] {
  const dimensions = 1536
  const vector = new Array(dimensions).fill(0) as number[]
  const terms = tokens(text)
  if (terms.length === 0) return vector

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i]!
    const unigram = hashToken(term) % dimensions
    vector[unigram] += 1

    const next = terms[i + 1]
    if (next) {
      const bigram = hashToken(`${term} ${next}`) % dimensions
      vector[bigram] += 0.8
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  if (norm === 0) return vector
  return vector.map((value) => value / norm)
}

async function openaiEmbed(o: EmbedOpts, custom: boolean): Promise<number[]> {
  const apiKey = o.apiKey?.trim() || process.env['OPENAI_API_KEY']
  const baseURL = custom ? o.baseURL?.trim() || undefined : undefined
  const client = new OpenAI({ apiKey, baseURL })
  const res = await client.embeddings.create({
    model: o.model?.trim() || 'text-embedding-3-small',
    input: o.text,
  })
  return res.data[0]?.embedding ?? []
}

async function geminiEmbed(o: EmbedOpts): Promise<number[]> {
  const apiKey = o.apiKey?.trim() || process.env['GEMINI_API_KEY'] || ''
  const model = o.model?.trim() || 'text-embedding-004'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:embedContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: { parts: [{ text: o.text }] } }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini embed error ${res.status}: ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as { embedding?: { values?: number[] } }
  return json.embedding?.values ?? []
}
