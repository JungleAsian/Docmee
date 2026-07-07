// Multi-provider chat completion for J.zel. One uniform contract; per-clinic
// config (provider + model + key + baseURL) picks the backend. Claude runs on
// @anthropic-ai/sdk; OpenAI + Custom (any OpenAI-compatible baseURL: Azure, Groq,
// OpenRouter, Together, Mistral, Ollama, vLLM, LM Studio) run on the openai SDK;
// Gemini runs on raw fetch (no extra dependency). The single non-Claude file
// boundary mirrors providers/claude.ts + providers/openai.ts.
import OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { claudeComplete } from './providers/claude.js'

export type ChatProvider = 'claude' | 'openai' | 'custom' | 'gemini'
export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}
export interface ChatOpts {
  provider: ChatProvider
  system: string
  message: string
  history?: ChatTurn[]
  maxTokens?: number
  apiKey?: string
  model: string
  /** Base URL for the 'custom' (OpenAI-compatible) provider. */
  baseURL?: string
}

const DEFAULT_CHAT_MODEL: Record<ChatProvider, string> = {
  claude: 'claude-opus-4-8',
  openai: 'gpt-4o',
  custom: '',
  gemini: 'gemini-2.0-flash',
}

/** Sensible default model id for a provider when the clinic hasn't set one. */
export function defaultChatModel(provider: ChatProvider): string {
  return DEFAULT_CHAT_MODEL[provider] ?? DEFAULT_CHAT_MODEL.claude
}

/** Provider-agnostic chat completion. Returns the assistant's text. */
export async function chatComplete(opts: ChatOpts): Promise<string> {
  if (process.env['LLM_STUB'] === 'true') return 'STUB_RESPONSE'
  switch (opts.provider) {
    case 'openai':
    case 'custom':
      return openaiChat(opts)
    case 'gemini':
      return geminiChat(opts)
    case 'claude':
    default:
      return claudeComplete(opts.system, opts.message, opts.maxTokens, opts.history, opts.apiKey, opts.model)
  }
}

async function openaiChat(o: ChatOpts): Promise<string> {
  const apiKey = o.apiKey?.trim() || process.env['OPENAI_API_KEY']
  // 'custom' points the OpenAI SDK at an OpenAI-compatible endpoint; 'openai' uses the default.
  const baseURL = o.provider === 'custom' ? o.baseURL?.trim() || undefined : undefined
  const client = new OpenAI({ apiKey, baseURL })
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: o.system },
    ...(o.history ?? []).map(
      (t): ChatCompletionMessageParam => ({ role: t.role, content: t.content }),
    ),
    { role: 'user', content: o.message },
  ]
  const res = await client.chat.completions.create({
    model: o.model,
    max_tokens: o.maxTokens ?? 1024,
    messages,
  })
  return res.choices[0]?.message?.content ?? ''
}

async function geminiChat(o: ChatOpts): Promise<string> {
  const apiKey = o.apiKey?.trim() || process.env['GEMINI_API_KEY'] || ''
  // Gemini roles are 'user' / 'model'; system goes in systemInstruction.
  const contents = [
    ...(o.history ?? []).map((t) => ({
      role: t.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: t.content }],
    })),
    { role: 'user', parts: [{ text: o.message }] },
  ]
  const body = {
    systemInstruction: { parts: [{ text: o.system }] },
    contents,
    generationConfig: { maxOutputTokens: o.maxTokens ?? 1024 },
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    o.model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Gemini API error ${res.status}: ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
}
