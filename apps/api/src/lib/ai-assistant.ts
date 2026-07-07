// J.zel per-clinic AI assistant config (Studio → Automations → AI Assistant).
// One clinic = one J.zel: chat provider, model, base URL, persona, and knowledge
// sources live in clinic.settings.aiAssistant. Shared by the inbox assist route and
// J.zel chat. Keep in sync with apps/inboxos shared/aiAssistant.ts.
import type { Clinic } from '@docmee/db'
import {
  chatComplete,
  defaultChatModel,
  embed,
  type ChatProvider,
  type IntentProvider,
  type EmbedProvider,
} from '@docmee/llm'
import { resolveClinicAiKey } from './clinic-ai-key.js'

// Claude model menu (used when chatProvider === 'claude'); other providers take a free-text model.
export const AI_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5']
export const CHAT_PROVIDERS: ChatProvider[] = ['claude', 'openai', 'custom', 'gemini']

export interface AiAssistantConfig {
  enabled: boolean
  /** Chat backend: claude | openai | custom (OpenAI-compatible) | gemini. */
  chatProvider: ChatProvider
  /** Model id for the chosen provider. */
  model: string
  /** Base URL for the 'custom' provider (OpenAI-compatible endpoint). */
  baseURL: string
  /** Intent-classification backend (routing). DeepSeek by default. */
  intentProvider: IntentProvider
/** KB embedding backend. Local by default; external providers require keys. Switching requires a KB re-index. */
  embedProvider: EmbedProvider
  /** Embedding model id (provider default when blank). */
  embedModel: string
  name: string
  persona: string
  useKb: boolean
  useHelp: boolean
  kbThreshold: number
}

function validProvider(v: unknown): v is ChatProvider {
  return v === 'claude' || v === 'openai' || v === 'custom' || v === 'gemini'
}

function validIntentProvider(v: unknown): v is IntentProvider {
  return v === 'deepseek' || validProvider(v)
}

function validEmbedProvider(v: unknown): v is EmbedProvider {
  return v === 'openai' || v === 'gemini' || v === 'custom' || v === 'local'
}

export function readAiAssistant(clinic: Clinic): AiAssistantConfig {
  const raw = ((clinic.settings as { aiAssistant?: Partial<AiAssistantConfig> }).aiAssistant ??
    {}) as Partial<AiAssistantConfig>
  const chatProvider = validProvider(raw.chatProvider) ? raw.chatProvider : 'claude'
  const model =
    typeof raw.model === 'string' && raw.model.trim() !== ''
      ? raw.model.trim()
      : defaultChatModel(chatProvider)
  return {
    enabled: raw.enabled !== false,
    chatProvider,
    model,
    baseURL: typeof raw.baseURL === 'string' ? raw.baseURL.trim() : '',
    intentProvider: validIntentProvider(raw.intentProvider) ? raw.intentProvider : 'deepseek',
    embedProvider: validEmbedProvider(raw.embedProvider) ? raw.embedProvider : 'local',
    embedModel: typeof raw.embedModel === 'string' ? raw.embedModel.trim() : '',
    name: typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : 'J.zel',
    persona: typeof raw.persona === 'string' ? raw.persona : '',
    useKb: raw.useKb !== false,
    useHelp: raw.useHelp !== false,
    kbThreshold: typeof raw.kbThreshold === 'number' && raw.kbThreshold >= 0 && raw.kbThreshold <= 1 ? raw.kbThreshold : 0.78,
  }
}

type Complete = (
  system: string,
  userMessage: string,
  maxTokens?: number,
  history?: { role: 'user' | 'assistant'; content: string }[],
) => Promise<string>

/**
 * Raw provider-dispatched `complete()` for this clinic (no persona prepend): picks
 * the clinic's chat provider + model + key (Integrations → env fallback) + baseURL.
 */
export function resolveChat(cfg: AiAssistantConfig, settings: unknown): Complete {
  const apiKey = resolveClinicAiKey(settings, cfg.chatProvider)
  return (system, userMessage, maxTokens, history) =>
    chatComplete({
      provider: cfg.chatProvider,
      system,
      message: userMessage,
      history: history ?? [],
      maxTokens,
      apiKey,
      model: cfg.model,
      baseURL: cfg.baseURL,
    })
}

/**
 * `resolveChat` with the clinic persona prepended — for callers (the inbox agents)
 * that build their own system prompt and expect the persona layered on top.
 */
export function bindComplete(cfg: AiAssistantConfig, settings: unknown): Complete {
  const base = resolveChat(cfg, settings)
  const persona = cfg.persona.trim()
  if (!persona) return base
  return (system, userMessage, maxTokens, history) =>
    base(`${persona}\n\n${system}`, userMessage, maxTokens, history)
}

/** Embedder bound to the clinic's embed provider/model/key — used for KB query embeddings. */
export function resolveEmbed(cfg: AiAssistantConfig, settings: unknown): (text: string) => Promise<number[]> {
  const apiKey = resolveClinicAiKey(settings, cfg.embedProvider)
  return (text: string) =>
    embed({
      provider: cfg.embedProvider,
      text,
      apiKey,
      model: cfg.embedModel,
      baseURL: cfg.baseURL,
    })
}
