import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('AlertsPage', () => {
  it('renders the alert feed as a horizontally scrollable data table with the required columns', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'page.tsx'), 'utf8')

    expect(source).toContain('overflow-x-auto')
    expect(source).toContain('<table')
    for (const expression of [
      "t('alerts.table.readStatus')",
      "t('alerts.table.priority')",
      "t('alerts.table.alert')",
      "t('alerts.table.details')",
      "t('alerts.table.channelMode')",
      "t('alerts.table.dateTime')",
      "t('alerts.table.conversation')",
      "t('alerts.table.actions')",
    ]) {
      expect(source).toContain(expression)
    }
    expect(source).toContain("t('alerts.table.background')")
    expect(source).not.toContain("language === 'es' ? 'Alertas en segundo plano' : 'Background alerts'")
  })
})
