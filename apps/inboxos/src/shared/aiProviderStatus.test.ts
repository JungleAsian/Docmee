import { describe, expect, it } from 'vitest'
import { summarizeAiProviderReadiness, type ClinicAiProviderStatus } from './aiProviderStatus'

const connectedClaude: ClinicAiProviderStatus = {
  provider: 'claude',
  connected: true,
  source: 'clinic',
  last4: '1234',
  validatedAt: '2026-07-26T12:00:00.000Z',
}

describe('summarizeAiProviderReadiness', () => {
  it('treats a connected clinic credential as ready even when global providers are missing', () => {
    expect(summarizeAiProviderReadiness([connectedClaude], [])).toEqual({
      icon: 'claude',
      state: 'ready',
      source: 'clinic',
    })
  })

  it('prefers a connected clinic credential over a global fallback', () => {
    expect(
      summarizeAiProviderReadiness(
        [connectedClaude],
        [{ provider: 'anthropic', configured: true, fallback: true }],
      ),
    ).toEqual({
      icon: 'claude',
      state: 'ready',
      source: 'clinic',
    })
  })

  it('uses global readiness when the clinic has no connected credential', () => {
    expect(
      summarizeAiProviderReadiness(
        [],
        [{ provider: 'openai', configured: true, fallback: false }],
      ),
    ).toEqual({
      icon: 'openai',
      state: 'ready',
      source: 'global',
    })
  })

  it('reports missing when neither clinic nor global credentials are configured', () => {
    expect(summarizeAiProviderReadiness([], [])).toEqual({
      icon: 'openai',
      state: 'missing',
      source: 'none',
    })
  })
})
