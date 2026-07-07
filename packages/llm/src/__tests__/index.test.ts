import { describe, it, expect } from 'vitest'
import { createStubProvider } from '../index.js'

describe('@docmee/llm', () => {
  it('stub provider returns a response', async () => {
    const provider = createStubProvider()
    const res = await provider.complete([{ role: 'user', content: 'hello' }])
    expect(res.content).toContain('LLM_STUB')
    expect(res.model).toBe('stub')
  })
})
