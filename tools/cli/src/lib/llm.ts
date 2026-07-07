import fs from 'node:fs'
import path from 'node:path'
import { toolsRoot } from './paths.js'

// Generic chat client used to auto-run a backlog item against a non-Claude
// provider (Claude Code has its own headless runner). Reads keys from
// .env.tools; OpenAI-compatible providers (Codex/Grok/DeepSeek/GLM) share one
// request shape; Gemini and Anthropic have their own.
const envFile = path.join(toolsRoot, '.env.tools')

export type LlmEngine = { provider: 'openai' | 'anthropic' | 'gemini'; url: string; key: string; model: string }

function readEnv(): Map<string, string> {
  const values = new Map<string, string>()
  if (!fs.existsSync(envFile)) return values
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const idx = trimmed.indexOf('=')
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (value && !values.has(trimmed.slice(0, idx).trim())) values.set(trimmed.slice(0, idx).trim(), value)
  }
  return values
}

const trimBase = (value: string) => value.replace(/\/+$/, '')

// Map a backlog assignee to a concrete API engine, or null if it has no runnable
// API key here (e.g. cursor, or a missing key).
export function engineForProvider(provider: string): LlmEngine | null {
  const env = readEnv()
  switch (provider) {
    case 'codex':
    case 'openai': {
      const key = env.get('OPENAI_API_KEY')
      return key ? { provider: 'openai', url: 'https://api.openai.com/v1/chat/completions', key, model: env.get('OPENAI_MODEL') || 'gpt-4o' } : null
    }
    case 'grok': {
      const key = env.get('GROK_API_KEY')
      return key ? { provider: 'openai', url: `${trimBase(env.get('GROK_BASE_URL') || 'https://api.x.ai/v1')}/chat/completions`, key, model: env.get('GROK_MODEL') || 'grok-3' } : null
    }
    case 'deepseek': {
      const key = env.get('DEEPSEEK_API_KEY')
      return key ? { provider: 'openai', url: `${trimBase(env.get('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com')}/chat/completions`, key, model: env.get('DEEPSEEK_MODEL') || 'deepseek-chat' } : null
    }
    case 'glm': {
      const key = env.get('GLM_API_KEY')
      return key ? { provider: 'openai', url: `${trimBase(env.get('GLM_BASE_URL') || 'https://open.bigmodel.cn/api/paas/v4')}/chat/completions`, key, model: env.get('GLM_MODEL') || 'glm-4-flash' } : null
    }
    case 'gemini': {
      const key = env.get('GOOGLE_GEMINI_API_KEY')
      if (!key) return null
      const model = env.get('GEMINI_MODEL') || 'gemini-2.0-flash'
      return { provider: 'gemini', url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, key, model }
    }
    case 'anthropic':
    case 'claude-api': {
      const key = env.get('ANTHROPIC_API_KEY')
      return key ? { provider: 'anthropic', url: 'https://api.anthropic.com/v1/messages', key, model: env.get('ANTHROPIC_MODEL') || 'claude-haiku-4-5-20251001' } : null
    }
    default:
      return null
  }
}

// Auto-selection policy: prefer a funded cheap API drafter (offloads work from
// the Claude Max usage budget) in this order, falling back to Claude direct when
// no API key is configured. Transparent + rule-based by design.
export const AUTO_PREFERENCE = ['deepseek', 'gemini', 'grok', 'glm', 'codex']

export function detectedProviders(): string[] {
  return AUTO_PREFERENCE.filter((provider) => engineForProvider(provider) !== null)
}

export function autoProvider(): string {
  return detectedProviders()[0] ?? 'claude'
}

export async function llmChat(prompt: string, engine: LlmEngine, maxTokens = 4096): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120000)
  try {
    if (engine.provider === 'openai') {
      const response = await fetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${engine.key}` },
        body: JSON.stringify({ model: engine.model, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      return data.choices?.[0]?.message?.content?.trim() || null
    }
    if (engine.provider === 'anthropic') {
      const response = await fetch(engine.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': engine.key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: engine.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
        signal: controller.signal
      })
      if (!response.ok) return null
      const data = await response.json() as { content?: Array<{ text?: string }> }
      return (data.content ?? []).map((part) => part.text ?? '').join('').trim() || null
    }
    const response = await fetch(engine.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: controller.signal
    })
    if (!response.ok) return null
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
    return (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? '').join('').trim() || null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
