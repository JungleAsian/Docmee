import type { ChatProvider } from '@docmee/llm'

/** Persist references and bounded generation settings, never credentials. */
export function resolveAiAgentSettings(config: Record<string, unknown>, clinic: { chatProvider?: string; model?: string }) {
  for (const key of ['apiKey', 'api_key', 'agentApiKey', 'baseURL']) {
    if (config[key] !== undefined) throw new Error('AI Agent credentials and endpoints belong in clinic settings, not the workflow.')
  }
  const selected = String(config['agentProvider'] ?? '')
  if (!['', 'inherit', 'claude', 'openai'].includes(selected)) throw new Error('Choose Claude, OpenAI, or the clinic default for the AI Agent.')
  const inherited: ChatProvider = ['openai', 'custom', 'gemini'].includes(clinic.chatProvider ?? '') ? clinic.chatProvider as ChatProvider : 'claude'
  const provider: ChatProvider = selected === 'claude' || selected === 'openai' ? selected : inherited
  if (config['agentModel'] !== undefined && typeof config['agentModel'] !== 'string') throw new Error('AI Agent model must be a model ID string.')
  const override = String(config['agentModel'] ?? '').trim()
  if (override && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(override)) throw new Error('Enter a valid AI model ID, not a URL or credential.')
  const raw = config['agentMaxTokens']
  if (raw !== undefined && typeof raw !== 'string' && typeof raw !== 'number') throw new Error('AI Agent output limit must be a number.')
  const maxTokens = raw === undefined || raw === '' ? 512 : Number(raw)
  if (!Number.isInteger(maxTokens) || maxTokens < 128 || maxTokens > 4096) throw new Error('AI Agent output limit must be an integer from 128 to 4096 tokens.')
  return { provider, model: override || (provider === inherited ? clinic.model?.trim() : '') || '', maxTokens }
}
