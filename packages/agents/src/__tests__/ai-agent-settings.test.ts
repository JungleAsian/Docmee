import { describe, expect, it } from 'vitest'
import { resolveAiAgentSettings } from '../workflows/ai-agent-settings.js'

describe('AI agent settings', () => {
  it('preserves clinic defaults for legacy nodes', () => {
    expect(resolveAiAgentSettings({}, { chatProvider: 'openai', model: 'clinic-model' })).toEqual({ provider: 'openai', model: 'gpt-5.5', maxTokens: 512 })
  })
  it('does not leak another providers model into an override', () => {
    expect(resolveAiAgentSettings({ agentProvider: 'claude', agentModel: 'chosen-model', agentMaxTokens: '2048' }, { chatProvider: 'openai', model: 'clinic-model' })).toEqual({ provider: 'claude', model: 'chosen-model', maxTokens: 2048 })
  })
  it.each(['openai', 'claude'])('uses the selected service default for inherited %s nodes', (provider) => {
    const expected = provider === 'claude' ? 'claude-sonnet-5' : 'gpt-5.5'
    expect(resolveAiAgentSettings({ agentProvider: 'inherit', agentModel: '' }, { chatProvider: provider, model: 'clinic-model' }).model).toBe(expected)
  })
  it('uses the service default after switching providers with a blank model', () => {
    expect(resolveAiAgentSettings({ agentProvider: 'claude', agentModel: '' }, { chatProvider: 'openai', model: 'clinic-model' })).toEqual({ provider: 'claude', model: 'claude-sonnet-5', maxTokens: 512 })
  })
  it.each([{ agentProvider: 'unknown' }, { agentMaxTokens: '-1' }, { agentMaxTokens: '999999' }, { agentMaxTokens: 'NaN' }, { agentMaxTokens: [512] }, { agentModel: 123 }, { agentModel: 'https://evil.test' }, { apiKey: 'secret' }])('rejects unsafe configuration %o', (config) => {
    expect(() => resolveAiAgentSettings(config, {})).toThrow()
  })
})
