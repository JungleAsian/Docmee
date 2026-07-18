import { describe, expect, it, vi } from 'vitest'
import { hybridClarificationMessage, resolveHybridFlowBranch } from '../custom-flow-hybrid.js'

const candidates = [
  { index: 0, op: 'yes' as const, keywords: [], next: 'book' },
  { index: 1, op: 'no' as const, keywords: [], next: 'end' },
]

describe('custom-flow hybrid branch classifier', () => {
  it('maps a high-confidence model option to an existing configured edge', async () => {
    const complete = vi.fn().mockResolvedValue('{"option":"option_0","confidence":0.94}')
    await expect(resolveHybridFlowBranch({ message: 'go ahead please', candidates, complete })).resolves.toEqual({
      kind: 'route',
      next: 'book',
      confidence: 0.94,
    })
    expect(complete.mock.calls[0]![1]).toContain('<patient_reply>')
  })

  it('clarifies instead of taking a low-confidence booking edge', async () => {
    const complete = vi.fn().mockResolvedValue('{"option":"option_0","confidence":0.89}')
    await expect(resolveHybridFlowBranch({ message: 'maybe', candidates, complete })).resolves.toEqual({
      kind: 'clarify',
      reason: 'low_confidence',
    })
  })

  it('rejects model-invented options and provider failures', async () => {
    await expect(
      resolveHybridFlowBranch({
        message: 'anything',
        candidates,
        complete: vi.fn().mockResolvedValue('{"option":"book_now","confidence":1}'),
      }),
    ).resolves.toEqual({ kind: 'clarify', reason: 'invalid_output' })
    await expect(
      resolveHybridFlowBranch({
        message: 'anything',
        candidates,
        complete: vi.fn().mockRejectedValue(new Error('offline')),
      }),
    ).resolves.toEqual({ kind: 'clarify', reason: 'provider_error' })
  })

  it('uses deterministic retry copy', () => {
    expect(hybridClarificationMessage(candidates, 'en')).toContain('yes or no')
    expect(hybridClarificationMessage(candidates, 'es')).toContain('sí o no')
  })
})
