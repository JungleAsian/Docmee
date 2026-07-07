import fs from 'node:fs'
import path from 'node:path'

// User-added AI providers connected to DevTools (beyond the built-in
// Claude/Codex/Grok/Gemini). Each gets a role + a /ai/[id] connect page and a
// sidebar entry under the AI group. Stored in tools/logs/custom-ais.json.
const file = path.resolve(process.cwd(), '..', 'logs', 'custom-ais.json')

export const AI_ROLES = [
  'Builder',
  'Reviewer',
  'Designer',
  'Researcher',
  'Orchestrator',
  'Translator',
  'Tester',
  'Assistant'
] as const

export type CustomAi = {
  id: string
  name: string
  role: string
  model?: string
  baseUrl?: string
  consoleUrl?: string
  keyVar?: string
}

export function readCustomAis(): CustomAi[] {
  if (!fs.existsSync(file)) return []
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8')) as CustomAi[]
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

export function writeCustomAis(list: CustomAi[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
}

export function slugifyAiId(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}
