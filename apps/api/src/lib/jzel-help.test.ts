import { describe, expect, it } from 'vitest'
import { helpForJzelRoute } from './jzel-help.js'

describe('helpForJzelRoute', () => {
  it('keeps Workflow Builder and Automations guidance separate', () => {
    expect(helpForJzelRoute('/studio/workflows')?.source).toBe('Workflow Builder')
    expect(helpForJzelRoute('/studio/automations')?.source).toBe('Automations')
  })

  it('does not accept untrusted or unknown routes as help context', () => {
    expect(helpForJzelRoute('https://example.test/studio/workflows')).toBeNull()
    expect(helpForJzelRoute('/studio/unknown')).toBeNull()
  })
})
