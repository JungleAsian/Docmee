import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const sheet = postcss.parse(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'))

// Inspect the semantic role contract, not exact theme colors or source formatting.
function declarations(selector: string, context: string) {
  const result: Record<string, string> = {}
  sheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    const parent = rule.parent
    const scope = parent?.type === 'atrule' ? parent.params : 'base'
    if (scope !== context) return
    rule.walkDecls((decl) => { result[decl.prop] = decl.value })
  })
  return result
}

describe('glass surface fallback contract', () => {
  it('uses a solid baseline without requiring backdrop support', () => {
    expect(declarations('[data-docmee-glass="outer"]', 'base').background).toBe('var(--crm-glass-solid)')
  })
  it('turns off filtering and restores solid surfaces for reduced transparency and print', () => {
    const result = declarations('[data-docmee-glass="outer"]', '(prefers-reduced-transparency: reduce), print')
    expect(result.background).toBe('var(--crm-glass-solid)')
    expect(result['backdrop-filter']).toBe('none')
    expect(result['-webkit-backdrop-filter']).toBe('none')
  })
  it('uses system colors in forced colors', () => {
    const result = declarations('[data-docmee-glass="outer"]', '(forced-colors: active)')
    expect(result.background).toBe('Canvas')
    expect(result.color).toBe('CanvasText')
  })
  it('never blurs dense surfaces', () => {
    expect(declarations('[data-docmee-glass="dense"]', 'base')['backdrop-filter']).toBe('none')
  })
  it('avoids nested filtering in header controls and loading content', () => {
    for (const selector of ['.crm-header-search', '.crm-user-profile', '.docmee-help-search', '.docmee-auth-loading-overlay']) {
      expect(declarations(selector, 'base')['backdrop-filter']).toBe('none')
      expect(declarations(selector, 'base')['-webkit-backdrop-filter']).toBe('none')
    }
  })
})
