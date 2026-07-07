import fs from 'node:fs'
import path from 'node:path'

// Mirrors the CLI auto-selection policy (lib/llm.ts) for display/transparency:
// Auto prefers the first funded cheap API drafter, else Claude direct.
const PREFERENCE: Array<{ id: string; label: string; key: string }> = [
  { id: 'deepseek', label: 'DeepSeek', key: 'DEEPSEEK_API_KEY' },
  { id: 'gemini', label: 'Gemini', key: 'GOOGLE_GEMINI_API_KEY' },
  { id: 'grok', label: 'Grok', key: 'GROK_API_KEY' },
  { id: 'glm', label: 'GLM', key: 'GLM_API_KEY' },
  { id: 'codex', label: 'Codex', key: 'OPENAI_API_KEY' }
]

export type AutoAi = {
  choice: string
  choiceLabel: string
  detected: Array<{ id: string; label: string }>
  preference: Array<{ id: string; label: string }>
}

function readEnvKeys(toolsRoot: string): Set<string> {
  const set = new Set<string>()
  try {
    for (const line of fs.readFileSync(path.join(toolsRoot, '.env.tools'), 'utf8').split(/\r?\n/)) {
      const t = line.trim()
      if (!t || t.startsWith('#') || !t.includes('=')) continue
      const i = t.indexOf('=')
      const value = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
      if (value) set.add(t.slice(0, i).trim())
    }
  } catch {
    // no .env.tools → no API keys → Auto falls back to Claude
  }
  return set
}

export function resolveAutoAi(toolsRoot: string): AutoAi {
  const keys = readEnvKeys(toolsRoot)
  const detected = PREFERENCE.filter((p) => keys.has(p.key)).map((p) => ({ id: p.id, label: p.label }))
  return {
    choice: detected[0]?.id ?? 'claude',
    choiceLabel: detected[0]?.label ?? 'Claude',
    detected,
    preference: PREFERENCE.map((p) => ({ id: p.id, label: p.label }))
  }
}
