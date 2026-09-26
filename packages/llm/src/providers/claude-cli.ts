import { spawn } from 'node:child_process'

const WINDOW_MS = 60_000
const MAX_OUTPUT_BYTES = 80_000
const TIMEOUT_MS = 60_000

export class ClaudeCliUnavailableError extends Error {
  constructor(readonly code: 'disabled' | 'not_permitted' | 'busy' | 'quota' | 'failed' | 'timeout' | 'empty_output') {
    super('The managed Claude CLI transport is unavailable.')
    this.name = 'ClaudeCliUnavailableError'
  }
}

let inFlight = 0
const clinicWindows = new Map<string, { startedAt: number; requests: number }>()

function positiveInteger(name: string): number | null {
  const value = Number(process.env[name])
  return Number.isInteger(value) && value > 0 ? value : null
}

export function isClaudeCliAvailable(): boolean {
  return process.env['CLAUDE_CLI_ENABLED'] === 'true' && positiveInteger('CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE') !== null
}

function claimCapacity(clinicId: string): () => void {
  if (!isClaudeCliAvailable()) throw new ClaudeCliUnavailableError('disabled')
  const limit = positiveInteger('CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE')!
  const globalLimit = positiveInteger('CLAUDE_CLI_MAX_CONCURRENT') ?? 1
  if (inFlight >= globalLimit) throw new ClaudeCliUnavailableError('busy')
  const now = Date.now()
  const current = clinicWindows.get(clinicId)
  const window = !current || now - current.startedAt >= WINDOW_MS ? { startedAt: now, requests: 0 } : current
  if (window.requests >= limit) throw new ClaudeCliUnavailableError('quota')
  window.requests += 1
  clinicWindows.set(clinicId, window)
  inFlight += 1
  return () => { inFlight -= 1 }
}

export function buildClaudeCliArgs(model: string): string[] {
  return [
    '-p',
    '--model', model,
    '--output-format', 'text',
    '--max-turns', '1',
    '--restricted',
    '--tools', '',
    '--disallowedTools', 'mcp__*',
    '--permission-prompts', 'none',
    '--no-session-persistence',
    '--system-prompt', 'Follow the structured request provided on standard input. Do not use tools or external sources.',
  ]
}

export function claudeCliChildEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...source }
  delete env['ANTHROPIC_API_KEY']
  return env
}

export async function claudeCliComplete(input: {
  clinicId?: string
  allowClaudeCli?: boolean
  system: string
  message: string
  history?: { role: 'user' | 'assistant'; content: string }[]
  model: string
}): Promise<string> {
  if (!input.allowClaudeCli || !input.clinicId) throw new ClaudeCliUnavailableError('not_permitted')
  const clinicId = input.clinicId
  const release = claimCapacity(clinicId)
  try {
    return await runClaudeCli({ ...input, clinicId, allowClaudeCli: true })
  } finally {
    release()
  }
}

function runClaudeCli(input: Required<Pick<Parameters<typeof claudeCliComplete>[0], 'clinicId' | 'allowClaudeCli' | 'system' | 'message' | 'model'>> & { history?: { role: 'user' | 'assistant'; content: string }[] }): Promise<string> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('claude', buildClaudeCliArgs(input.model), { env: claudeCliChildEnv(), stdio: 'pipe' })
    } catch {
      reject(new ClaudeCliUnavailableError('failed'))
      return
    }
    const stdout = child.stdout
    const stdin = child.stdin
    if (!stdout || !stdin) {
      child.kill()
      reject(new ClaudeCliUnavailableError('failed'))
      return
    }
    let output = ''
    let settled = false
    const finish = (error?: ClaudeCliUnavailableError, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(value ?? '')
    }
    const timeout = setTimeout(() => {
      child.kill()
      finish(new ClaudeCliUnavailableError('timeout'))
    }, TIMEOUT_MS)
    stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) {
        child.kill()
        finish(new ClaudeCliUnavailableError('failed'))
      }
    })
    child.on('error', () => finish(new ClaudeCliUnavailableError('failed')))
    child.on('close', (code) => {
      const value = output.trim()
      if (code !== 0) return finish(new ClaudeCliUnavailableError('failed'))
      if (!value) return finish(new ClaudeCliUnavailableError('empty_output'))
      return finish(undefined, value)
    })
    stdin.on('error', () => finish(new ClaudeCliUnavailableError('failed')))
    stdin.end(JSON.stringify({ system: input.system, history: input.history ?? [], message: input.message }))
  })
}

export function __resetClaudeCliStateForTests(): void {
  inFlight = 0
  clinicWindows.clear()
}