import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('CostMonitoringPage', () => {
  it('does not render the Cost assumptions card', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8')

    expect(source).not.toContain('Cost assumptions')
  })
})
