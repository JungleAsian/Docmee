// J.zel — per-clinic AI assistant config (Studio → Automations → AI Assistant).
// One clinic = one J.zel: chat provider, model, base URL, persona, and knowledge
// sources are stored in clinic.settings.aiAssistant. Pure reader + defaults for the
// panel; the API mirrors the same shape/defaults in apps/api lib/ai-assistant.ts.
//
// Keep pure (no I/O) so it stays trivially testable.
import type { ClinicSettings } from './types'

export type ChatProvider = 'claude' | 'openai' | 'custom' | 'gemini'
/** Intent-classification backends. DeepSeek is the default; chat providers can also classify. */
export type IntentProvider = 'deepseek' | ChatProvider
/** KB embedding backends (Anthropic has no embeddings, so Claude/DeepSeek are excluded). */
export type EmbedProvider = 'local' | 'openai' | 'gemini' | 'custom'

/** Chat providers a clinic can pick for J.zel, in menu order. */
export const CHAT_PROVIDERS: { id: ChatProvider; label: string; hint: string }[] = [
  { id: 'claude', label: 'Claude (Anthropic)', hint: 'Default' },
  { id: 'openai', label: 'OpenAI (GPT-4o)', hint: 'GPT models' },
  { id: 'custom', label: 'Custom / OpenAI-compatible', hint: 'Azure · Groq · OpenRouter · self-hosted' },
  { id: 'gemini', label: 'Google Gemini', hint: 'Gemini models' },
]

/** Intent-classification providers offered in the panel (Custom omitted — tiny task). */
export const INTENT_PROVIDERS: { id: IntentProvider; label: string; hint: string }[] = [
  { id: 'deepseek', label: 'DeepSeek', hint: 'Default · cheap' },
  { id: 'claude', label: 'Claude', hint: 'Anthropic' },
  { id: 'openai', label: 'OpenAI', hint: 'GPT' },
  { id: 'gemini', label: 'Gemini', hint: 'Google' },
]

/** KB embedding providers offered in the panel. */
export const EMBED_PROVIDERS: { id: EmbedProvider; label: string; hint: string }[] = [
  { id: 'openai', label: 'OpenAI', hint: 'Default · text-embedding-3' },
  { id: 'gemini', label: 'Google Gemini', hint: 'text-embedding-004' },
  { id: 'custom', label: 'Custom / OpenAI-compatible', hint: 'uses the Base URL above' },
]

/** Claude model suggestions (used when provider === 'claude'). */
export const AI_MODELS = [
  { id: 'claude-opus-4-8', label: 'Opus 4.8', hint: 'Best quality' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'Balanced' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', hint: 'Fastest / cheapest' },
] as const

/** Model suggestions per provider for the datalist (free-text still allowed). */
export const MODEL_SUGGESTIONS: Record<ChatProvider, string[]> = {
  claude: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  gemini: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  custom: [],
}

export const DEFAULT_CHAT_MODEL: Record<ChatProvider, string> = {
  claude: 'claude-opus-4-8',
  openai: 'gpt-4o',
  custom: '',
  gemini: 'gemini-2.0-flash',
}

export interface AiAssistantConfig {
  /** Master switch for J.zel in this clinic. */
  enabled: boolean
  /** Chat backend: claude | openai | custom (OpenAI-compatible) | gemini. */
  chatProvider: ChatProvider
  /** Model id for the chosen provider. */
  model: string
  /** Base URL for the 'custom' provider (OpenAI-compatible endpoint). */
  baseURL: string
  /** Intent-classification backend (routing). DeepSeek by default. */
  intentProvider: IntentProvider
  /** KB embedding backend. OpenAI by default. Switching requires a KB re-index. */
  embedProvider: EmbedProvider
  /** Embedding model id (provider default when blank). */
  embedModel: string
  name: string
  persona: string
  useKb: boolean
  useHelp: boolean
  kbThreshold: number
}

export const DEFAULT_AI_ASSISTANT: AiAssistantConfig = {
  enabled: true,
  chatProvider: 'claude',
  model: 'claude-opus-4-8',
  baseURL: '',
  intentProvider: 'deepseek',
  embedProvider: 'local',
  embedModel: '',
  name: 'J.zel',
  persona: '',
  useKb: true,
  useHelp: true,
  kbThreshold: 0.78,
}

function isProvider(value: unknown): value is ChatProvider {
  return value === 'claude' || value === 'openai' || value === 'custom' || value === 'gemini'
}

function isIntentProvider(value: unknown): value is IntentProvider {
  return value === 'deepseek' || isProvider(value)
}

function isEmbedProvider(value: unknown): value is EmbedProvider {
  return value === 'local' || value === 'openai' || value === 'gemini' || value === 'custom'
}

/** Read the clinic's J.zel config, falling back to defaults for missing fields. */
export function readAiAssistant(settings: ClinicSettings | null | undefined): AiAssistantConfig {
  const raw = (settings?.aiAssistant ?? {}) as Partial<AiAssistantConfig>
  const chatProvider = isProvider(raw.chatProvider) ? raw.chatProvider : 'claude'
  const model =
    typeof raw.model === 'string' && raw.model.trim() !== ''
      ? raw.model.trim()
      : DEFAULT_CHAT_MODEL[chatProvider]
  return {
    enabled: raw.enabled !== false,
    chatProvider,
    model,
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL : '',
    intentProvider: isIntentProvider(raw.intentProvider) ? raw.intentProvider : 'deepseek',
    embedProvider: isEmbedProvider(raw.embedProvider) ? raw.embedProvider : 'local',
    embedModel: typeof raw.embedModel === 'string' ? raw.embedModel : '',
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name : DEFAULT_AI_ASSISTANT.name,
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    useKb: raw.useKb !== false,
    useHelp: raw.useHelp !== false,
    kbThreshold: typeof raw.kbThreshold === 'number' && raw.kbThreshold >= 0 && raw.kbThreshold <= 1 ? raw.kbThreshold : 0.78,
  }
}
