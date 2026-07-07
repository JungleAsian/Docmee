// Only file permitted to import @anthropic-ai/sdk
import Anthropic from '@anthropic-ai/sdk'

export interface ClaudeTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Normalize a turn history plus the new user message into a valid Anthropic
 * message list: it must begin with a user turn and must never contain two
 * consecutive turns from the same role. We drop any leading assistant turns and
 * merge consecutive same-role turns (CRE-45 multi-turn memory). Exported for
 * unit testing — this normalization is what keeps the API from 400-ing on a
 * history that starts mid-assistant or has back-to-back patient messages.
 */
export function buildMessages(history: ClaudeTurn[], userMessage: string): ClaudeTurn[] {
  const all: ClaudeTurn[] = [...history, { role: 'user', content: userMessage }]
  while (all.length > 0 && all[0]!.role !== 'user') all.shift()
  const merged: ClaudeTurn[] = []
  for (const turn of all) {
    const last = merged[merged.length - 1]
    if (last && last.role === turn.role) last.content += `\n${turn.content}`
    else merged.push({ role: turn.role, content: turn.content })
  }
  return merged
}

export async function claudeComplete(
  system: string,
  userMessage: string,
  maxTokens = 1024,
  history: ClaudeTurn[] = [],
  apiKey?: string,
  // Per-call model override (J.zel's per-clinic model lives in clinic.settings.aiAssistant).
  // Falls back to the LLM_MODEL env var, then the historical default so other
  // callers (e.g. the patient-facing agent worker) are unaffected.
  model?: string,
): Promise<string> {
  if (process.env['LLM_STUB'] === 'true') return 'STUB_RESPONSE'
  // Per-clinic key when the clinic has connected one (Integrations → "login to
  // the service"); otherwise fall back to the server's env key.
  const client = new Anthropic({ apiKey: apiKey?.trim() || process.env['ANTHROPIC_API_KEY'] })
  const msg = await client.messages.create({
    model: model?.trim() || process.env['LLM_MODEL']?.trim() || 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: buildMessages(history, userMessage),
  })
  const block = msg.content[0]
  return block?.type === 'text' ? block.text : ''
}
