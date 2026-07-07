import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

// LLM-backed EN->ES translation with a persistent disk cache. The runtime
// SpanishTranslator sends any UI text its static dictionary did not cover here;
// each unique string is translated once via the configured LLM and cached to
// tools/logs/translations-es.json, so subsequent loads are instant and offline.
// Degrades gracefully (returns the input unchanged) when no LLM key is set.
const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const cacheFile = path.join(logsRoot, 'translations-es.json')
const envFile = path.join(toolsRoot, '.env.tools')

function readEnv(): Map<string, string> {
  const values = new Map<string, string>()
  for (const file of [envFile, path.join(toolsRoot, '..', '.env')]) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
      const idx = trimmed.indexOf('=')
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
      if (value && !values.has(key)) values.set(key, value)
    }
  }
  return values
}

function loadCache(): Record<string, string> {
  if (!existsSync(cacheFile)) return {}
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

function saveCache(cache: Record<string, string>) {
  mkdirSync(logsRoot, { recursive: true })
  writeFileSync(cacheFile, `${JSON.stringify(cache, null, 2)}\n`)
}

// Only translate human-readable UI text — skip data (numbers, hashes, paths,
// URLs, env-style constants) so the toggle never garbles commit hashes/log lines.
function isTranslatable(value: string): boolean {
  const t = value.trim()
  if (t.length < 2 || t.length > 600) return false
  if (!/[A-Za-z]/.test(t)) return false
  if (/^[0-9a-f]{7,40}$/i.test(t)) return false
  if (/^(https?:\/\/|\/|\.\/|~\/|[A-Za-z]:\\)/.test(t)) return false
  if (/^[A-Z0-9_]{3,}$/.test(t) && t.includes('_')) return false
  return true
}

type Engine = { provider: 'openai' | 'anthropic' | 'gemini'; url: string; key: string; model: string }

const trimBase = (value: string) => value.replace(/\/+$/, '')

// Use whichever LLM key is configured in .env.tools. Grok (xAI) and GLM (Zhipu)
// are OpenAI-compatible, so they reuse the 'openai' request shape. Set
// TRANSLATE_PROVIDER to force one when several keys are present. Gemini and
// GLM (glm-4-flash) both have free tiers.
function resolveEngines(env: Map<string, string>): Engine[] {
  const builders: Record<string, () => Engine | null> = {
    deepseek: () => {
      const key = env.get('DEEPSEEK_API_KEY')
      if (!key) return null
      const base = trimBase(env.get('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com')
      return { provider: 'openai', url: `${base}/chat/completions`, key, model: env.get('DEEPSEEK_MODEL') || 'deepseek-chat' }
    },
    openai: () => {
      const key = env.get('OPENAI_API_KEY')
      if (!key) return null
      return { provider: 'openai', url: 'https://api.openai.com/v1/chat/completions', key, model: env.get('OPENAI_MODEL') || 'gpt-4o-mini' }
    },
    anthropic: () => {
      const key = env.get('ANTHROPIC_API_KEY')
      if (!key) return null
      return { provider: 'anthropic', url: 'https://api.anthropic.com/v1/messages', key, model: env.get('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001' }
    },
    gemini: () => {
      const key = env.get('GOOGLE_GEMINI_API_KEY')
      if (!key) return null
      const model = env.get('GEMINI_MODEL') || 'gemini-2.0-flash'
      return { provider: 'gemini', url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, key, model }
    },
    grok: () => {
      const key = env.get('GROK_API_KEY')
      if (!key) return null
      const base = trimBase(env.get('GROK_BASE_URL') || 'https://api.x.ai/v1')
      return { provider: 'openai', url: `${base}/chat/completions`, key, model: env.get('GROK_MODEL') || 'grok-2-latest' }
    },
    glm: () => {
      const key = env.get('GLM_API_KEY')
      if (!key) return null
      const base = trimBase(env.get('GLM_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4')
      return { provider: 'openai', url: `${base}/chat/completions`, key, model: env.get('GLM_MODEL') || 'glm-4-flash' }
    }
  }
  const order = ['deepseek', 'openai', 'anthropic', 'gemini', 'grok', 'glm']
  const forced = (env.get('TRANSLATE_PROVIDER') || '').trim().toLowerCase()
  const names = forced && builders[forced] ? [forced] : order
  return names.map((name) => builders[name]?.() ?? null).filter((engine): engine is Engine => Boolean(engine))
}

async function llmTranslate(strings: string[], engine: Engine): Promise<string[] | null> {
  const prompt = [
    'Translate each English software-dashboard UI string into neutral Latin-American Spanish.',
    'Keep product/proper names unchanged: Docmee, Claude, Codex, Grok, Gemini, Notion, GitHub, Discord, VPS, Redis, Postgres, Supabase, PM2, API, UI, URL, PID.',
    'Keep numbers, %, units, file paths, and placeholders intact.',
    'Return ONLY a JSON array of strings — same length and order as the input, no prose.',
    '',
    `Input: ${JSON.stringify(strings)}`
  ].join('\n')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    let content = ''
    if (engine.provider === 'openai') {
      const response = await fetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.key}` },
        body: JSON.stringify({ model: engine.model, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      content = data.choices?.[0]?.message?.content ?? ''
    } else if (engine.provider === 'anthropic') {
      const response = await fetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': engine.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: engine.model, max_tokens: 8192, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const data = await response.json() as { content?: Array<{ text?: string }> }
      content = (data.content ?? []).map((part) => part.text ?? '').join('')
    } else {
      const response = await fetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0 } }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
      content = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('')
    }
    const match = content.match(/\[[\s\S]*\]/)
    if (!match) return null
    const parsed = JSON.parse(match[0]) as unknown
    if (!Array.isArray(parsed) || parsed.length !== strings.length) return null
    return parsed.map((item) => (typeof item === 'string' ? item : ''))
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Minimal live call to report an engine's HTTP status (401 bad key, 404 bad
// model/endpoint, 200 ok) without exposing the key. Used by GET ?probe=1.
async function probeEngine(engine: Engine): Promise<number> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    let response: Response
    if (engine.provider === 'openai') {
      response = await fetch(engine.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.key}` }, body: JSON.stringify({ model: engine.model, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }), signal: controller.signal })
    } else if (engine.provider === 'anthropic') {
      response = await fetch(engine.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': engine.key, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: engine.model, max_tokens: 5, messages: [{ role: 'user', content: 'Hi' }] }), signal: controller.signal })
    } else {
      response = await fetch(engine.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Hi' }] }] }), signal: controller.signal })
    }
    return response.status
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}

// Diagnostic: is a translation engine configured? ?probe=1 live-tests each. (No secrets.)
export async function GET(request: Request) {
  const engines = resolveEngines(readEnv())
  if (new URL(request.url).searchParams.get('probe')) {
    const results = []
    for (const engine of engines) results.push({ model: engine.model, status: await probeEngine(engine) })
    return NextResponse.json({ active: engines.length > 0, engines: results })
  }
  return NextResponse.json({ active: engines.length > 0, model: engines[0]?.model ?? null, candidates: engines.length })
}

export async function POST(request: Request) {
  let strings: string[] = []
  try {
    const body = await request.json() as { strings?: unknown }
    if (Array.isArray(body.strings)) strings = body.strings.filter((s): s is string => typeof s === 'string')
  } catch {
    return NextResponse.json({})
  }

  const unique = [...new Set(strings.map((s) => s.trim()).filter(isTranslatable))]
  const cache = loadCache()
  const misses = unique.filter((s) => !(s in cache))

  if (misses.length > 0) {
    const engines = resolveEngines(readEnv())
    let changed = false
    // Try each configured engine in turn; a later one (e.g. Grok/GLM) picks up
    // whatever an earlier one (e.g. a dead DeepSeek key) failed to translate.
    for (const engine of engines) {
      const remaining = misses.filter((source) => !(source in cache))
      if (remaining.length === 0) break
      for (let i = 0; i < remaining.length; i += 40) {
        const chunk = remaining.slice(i, i + 40)
        const out = await llmTranslate(chunk, engine)
        if (!out) break // this engine failed — fall through to the next one
        chunk.forEach((source, index) => {
          const translated = out[index]?.trim()
          if (translated) { cache[source] = translated; changed = true }
        })
      }
    }
    if (changed) saveCache(cache)
  }

  const result: Record<string, string> = {}
  for (const source of unique) result[source] = cache[source] ?? source
  return NextResponse.json(result)
}
