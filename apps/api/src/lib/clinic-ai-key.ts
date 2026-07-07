// Per-clinic AI key resolution + key-bound LLM wrappers.
//
// The Integrations page ("login to the service") lets a clinic connect its own
// Anthropic / OpenAI key, stored AES-256-GCM encrypted in
// clinics.settings.integrations.<provider>.apiKeyEnc. Here we decrypt it (when
// present) and bind it to the LLM provider calls so this clinic's inference runs
// on its own key; when a clinic has not connected one, the provider falls back to
// the server env key (ANTHROPIC_API_KEY / OPENAI_API_KEY) — undefined is passed
// straight through.
import { decryptValue } from '@docmee/shared'
import { claudeComplete, embedText } from '@docmee/llm'

type AiProvider = 'claude' | 'openai' | 'gemini' | 'custom'
type History = { role: 'user' | 'assistant'; content: string }[]

/** Decrypt this clinic's stored provider key, or undefined if none/invalid. */
export function resolveClinicAiKey(settings: unknown, provider: AiProvider): string | undefined {
  if (!settings || typeof settings !== 'object') return undefined
  const integrations = (settings as Record<string, unknown>)['integrations']
  if (!integrations || typeof integrations !== 'object') return undefined
  const entry = (integrations as Record<string, unknown>)[provider]
  if (!entry || typeof entry !== 'object' || !('apiKeyEnc' in entry)) return undefined
  const enc = (entry as { apiKeyEnc?: unknown }).apiKeyEnc
  if (typeof enc !== 'string' || enc === '') return undefined
  try {
    return decryptValue(enc)
  } catch {
    return undefined
  }
}

/**
 * claudeComplete bound to a clinic key (env fallback when undefined) and,
 * optionally, a specific model (J.zel's per-clinic model; env/default fallback
 * when undefined).
 */
export function completeWithClinicKey(apiKey?: string, model?: string) {
  return (system: string, userMessage: string, maxTokens?: number, history?: History) =>
    claudeComplete(system, userMessage, maxTokens, history, apiKey, model)
}

/** embedText bound to a clinic key (env fallback when undefined). */
export function embedWithClinicKey(apiKey?: string) {
  return (text: string) => embedText(text, apiKey)
}
