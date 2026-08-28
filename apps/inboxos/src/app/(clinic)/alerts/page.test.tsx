import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AlertsPage', () => {
  it('renders the alert feed as a horizontally scrollable data table with the required columns', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8')

    expect(source).toContain('overflow-x-auto')
    expect(source).toContain('<table')
    for (const column of ['Read status', 'Priority', 'Alert', 'Details', 'Channel/mode', 'Date/time', 'Conversation', 'Actions']) {
      expect(source).toContain(`>${column}</th>`)
    }
  })
})
