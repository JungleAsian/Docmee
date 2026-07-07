import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ocrImage } from '../botbase/ocr.js'

const originalStub = process.env['LLM_STUB']

beforeEach(() => {
  process.env['LLM_STUB'] = 'true'
})

afterEach(() => {
  if (originalStub === undefined) delete process.env['LLM_STUB']
  else process.env['LLM_STUB'] = originalStub
})

describe('ocrImage', () => {
  it('returns the deterministic stub text under LLM_STUB (no engine load)', async () => {
    const result = await ocrImage(Buffer.from('not-a-real-image'))
    expect(result.text).toContain('Horario de atención')
    expect(result.confidence).toBeGreaterThan(0)
  })
})
