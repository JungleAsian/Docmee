import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const sheet = postcss.parse(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'))

function declarations(selector: string) {
  const result: Record<string, string> = {}
  sheet.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value
    })
  })
  return result
}

describe('top-bar action control contract', () => {
  it('keeps a 44px interactive target around the visible circle', () => {
    const target = declarations('.crm-topbar-action-btn')

    expect(target.width).toBe('44px')
    expect(target['min-width']).toBe('44px')
    expect(target.height).toBe('44px')
    expect(target.background).toBe('transparent')
    expect(declarations('.crm-topbar-action-btn::before').inset).toBe('6px')
  })

  it('uses a smaller glyph and a visible keyboard focus ring', () => {
    const glyph = declarations('.crm-topbar-action-btn > svg')
    const focus = declarations('.crm-topbar-action-btn:focus-visible')

    expect(glyph.width).toBe('14px')
    expect(glyph.height).toBe('14px')
    expect(focus.outline).toBe('2px solid var(--crm-primary-color)')
    expect(focus['outline-offset']).toBe('2px')
  })

  it('anchors the notification badge to the full hit target', () => {
    const badge = declarations('.crm-topbar-action-badge')

    expect(badge.position).toBe('absolute')
    expect(badge['z-index']).toBe('2')
    expect(badge.top).toBe('0')
    expect(badge.right).toBe('0')
  })
})
