import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ spawn }))

import { chatComplete } from '../chat.js'

import {
  __resetClaudeCliStateForTests,
  buildClaudeCliArgs,
  claudeCliChildEnv,
  claudeCliComplete,
  ClaudeCliUnavailableError,
  isClaudeCliAvailable,
} from '../providers/claude-cli.js'

function child() {
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  const process = Object.assign(new EventEmitter(), { stdout, stdin, kill: vi.fn() })
  return { process, stdout, stdin }
}

describe('managed Claude CLI transport', () => {
  const env = { ...process.env }
  beforeEach(() => {
    spawn.mockReset()
    __resetClaudeCliStateForTests()
    delete process.env['CLAUDE_CLI_ENABLED']
    delete process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE']
    delete process.env['CLAUDE_CLI_MAX_CONCURRENT']
  })
  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...env }
  })

  it('is disabled unless the host explicitly configures it and a clinic quota', async () => {
    expect(isClaudeCliAvailable()).toBe(false)
    await expect(claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 's', message: 'm', model: 'claude-opus-4-8' }))
      .rejects.toMatchObject({ code: 'disabled' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('dispatches the managed CLI only through the explicit transport field', async () => {
    await expect(chatComplete({ provider: 'claude', transport: 'claude_cli', clinicId: 'c-1', allowClaudeCli: true, system: 's', message: 'm', model: 'claude-opus-4-8' }))
      .rejects.toMatchObject({ code: 'disabled' })
    expect(spawn).not.toHaveBeenCalled()
  })
  it('rejects a CLI request without the explicit staff boundary', async () => {
    process.env['CLAUDE_CLI_ENABLED'] = 'true'
    process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE'] = '1'
    await expect(claudeCliComplete({ clinicId: 'c-1', system: 'private system', message: 'private message', model: 'claude-opus-4-8' }))
      .rejects.toMatchObject({ code: 'not_permitted' })
    expect(spawn).not.toHaveBeenCalled()
  })

  it('uses a fresh restricted process, stdin request data, and no API key', async () => {
    process.env['CLAUDE_CLI_ENABLED'] = 'true'
    process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE'] = '1'
    process.env['ANTHROPIC_API_KEY'] = 'must-not-reach-child'
    const fake = child()
    let stdin = ''
    fake.stdin.on('data', (chunk) => { stdin += chunk.toString() })
    spawn.mockReturnValue(fake.process)
    const result = claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 'clinic system', message: 'staff request', model: 'claude-opus-4-8' })
    fake.stdout.end('approved answer')
    fake.process.emit('close', 0)
    await expect(result).resolves.toBe('approved answer')
    expect(spawn).toHaveBeenCalledWith('claude', expect.arrayContaining(['-p', '--restricted', '--no-session-persistence', '--tools', '', '--disallowedTools', 'mcp__*']), expect.objectContaining({ env: expect.not.objectContaining({ ANTHROPIC_API_KEY: expect.anything() }) }))
    expect(stdin).toContain('clinic system')
    expect(stdin).toContain('staff request')
  })

  it('fails with a generic code when the CLI exits without an answer', async () => {
    process.env['CLAUDE_CLI_ENABLED'] = 'true'
    process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE'] = '1'
    const fake = child()
    spawn.mockReturnValue(fake.process)
    const result = claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 'sensitive system', message: 'sensitive message', model: 'claude-opus-4-8' })
    fake.process.emit('close', 1)
    await expect(result).rejects.toBeInstanceOf(ClaudeCliUnavailableError)
  })

  it('enforces the per-clinic quota after a completed request', async () => {
    process.env['CLAUDE_CLI_ENABLED'] = 'true'
    process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE'] = '1'
    const fake = child()
    spawn.mockReturnValue(fake.process)
    const first = claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 's', message: 'm', model: 'claude-opus-4-8' })
    fake.stdout.end('first answer')
    fake.process.emit('close', 0)
    await expect(first).resolves.toBe('first answer')
    await expect(claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 's', message: 'm', model: 'claude-opus-4-8' }))
      .rejects.toMatchObject({ code: 'quota' })
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('times out and kills an unresponsive CLI process', async () => {
    vi.useFakeTimers()
    process.env['CLAUDE_CLI_ENABLED'] = 'true'
    process.env['CLAUDE_CLI_PER_CLINIC_REQUESTS_PER_MINUTE'] = '1'
    const fake = child()
    spawn.mockReturnValue(fake.process)
    const result = claudeCliComplete({ clinicId: 'c-1', allowClaudeCli: true, system: 's', message: 'm', model: 'claude-opus-4-8' })
    const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(fake.process.kill).toHaveBeenCalledTimes(1)
  })
  it('removes an inherited Anthropic API key from the child environment', () => {
    expect(claudeCliChildEnv({ ANTHROPIC_API_KEY: 'key', SAFE: 'value' })).toEqual({ SAFE: 'value' })
    expect(buildClaudeCliArgs('claude-opus-4-8')).toContain('--permission-prompts')
  })
})