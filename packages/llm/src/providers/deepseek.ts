// Intent classification. DeepSeek (openai-compatible) is the default; a clinic can
// override the intent provider (Claude / OpenAI / Custom / Gemini), in which case
// the same classification prompt + parse run through the multi-provider chat
// dispatcher. Returns exactly one of the 10 locked intents.
import OpenAI from 'openai'
import { chatComplete, defaultChatModel, type ChatProvider } from '../chat.js'

export type Intent =
  | 'greeting'
  | 'booking_request'
  | 'reschedule_request'
  | 'cancel_request'
  | 'appointment_status_check'
  | 'general_question'
  | 'emergency'
  | 'human_handoff_request'
  | 'stop_optout'
  | 'out_of_scope'

/** DeepSeek (default) or any chat provider can do intent classification. */
export type IntentProvider = 'deepseek' | ChatProvider

const INTENTS: Intent[] = [
  'greeting',
  'booking_request',
  'reschedule_request',
  'cancel_request',
  'appointment_status_check',
  'general_question',
  'emergency',
  'human_handoff_request',
  'stop_optout',
  'out_of_scope',
]

function classifySystemPrompt(): string {
  return (
    `You are an intent classifier for a medical clinic's patient messaging assistant. ` +
    `Classify the patient message into exactly one of these intents: ${INTENTS.join(', ')}. ` +
    `Reply with only the intent name, nothing else.`
  )
}

function parseIntent(raw: string): Intent {
  const v = (raw ?? '').trim().toLowerCase()
  return (INTENTS as string[]).includes(v) ? (v as Intent) : 'out_of_scope'
}

export interface IntentOpts {
  provider?: IntentProvider
  model?: string
  apiKey?: string
  /** Base URL for the 'custom' (OpenAI-compatible) provider. */
  baseURL?: string
}

export async function classifyIntent(message: string, opts?: IntentOpts): Promise<Intent> {
  if (process.env['LLM_STUB'] === 'true') return 'general_question'
  const provider = opts?.provider ?? 'deepseek'
  if (provider === 'deepseek') {
    return classifyWithDeepseek(message, opts?.model, opts?.apiKey)
  }
  // Override: route the same classification through the multi-provider chat dispatcher.
  const raw = await chatComplete({
    provider,
    system: classifySystemPrompt(),
    message,
    maxTokens: 20,
    apiKey: opts?.apiKey,
    model: opts?.model?.trim() || defaultChatModel(provider),
    baseURL: opts?.baseURL,
  })
  return parseIntent(raw)
}

async function classifyWithDeepseek(
  message: string,
  model?: string,
  apiKey?: string,
): Promise<Intent> {
  const client = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: apiKey?.trim() || process.env['DEEPSEEK_API_KEY'],
  })
  const response = await client.chat.completions.create({
    model: model?.trim() || 'deepseek-chat',
    messages: [
      { role: 'system', content: classifySystemPrompt() },
      { role: 'user', content: message },
    ],
    max_tokens: 20,
    temperature: 0,
  })
  return parseIntent(response.choices[0]?.message.content ?? '')
}
