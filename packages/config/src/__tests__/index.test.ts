import { describe, it, expect } from 'vitest'
import { isLlmStub, isDevelopment, parseBaseConfig } from '../index.js'

describe('@docmee/config', () => {
  it('parseBaseConfig returns defaults', () => {
    const cfg = parseBaseConfig()
    expect(cfg.NODE_ENV).toBeDefined()
  })

  it('isLlmStub returns boolean', () => {
    expect(typeof isLlmStub()).toBe('boolean')
  })

  it('isDevelopment returns boolean', () => {
    expect(typeof isDevelopment()).toBe('boolean')
  })
})
