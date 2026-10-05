import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const sheet = postcss.parse(read('../app/globals.css'))

// `inMedia` picks rules inside an @media block (the mobile override) versus the
// base rule (which lives inside an @layer), so the two are never merged together.
function declarations(selector: string, inMedia = false) {
  const result: Record<string, string> = {}
  sheet.walkRules((rule) => {
    const parent = rule.parent
    const isInMedia = parent?.type === 'atrule' && (parent as postcss.AtRule).name === 'media'
    if (isInMedia !== inMedia) return
    if (!rule.selectors.includes(selector)) return
    rule.walkDecls((declaration) => {
      result[declaration.prop] = declaration.value
    })
  })
  return result
}

describe('top-bar logo on every page', () => {
  it.each([
    ['clinic pages', '../app/(clinic)/layout.tsx'],
    ['Studio pages', '../app/(admin)/layout.tsx'],
  ])('renders the logo as the first item of the %s top bar', (_label, file) => {
    const source = read(file)
    const header = source.slice(source.indexOf('<header className="crm-top-header'))
    expect(source).toContain("import { TopbarLogo } from '@/shared/components/TopbarLogo'")
    const firstChild = header.split('\n').slice(1).find((line) => line.trim() !== '')
    expect(firstChild?.trim()).toBe('<TopbarLogo />')
  })

  it('no longer draws a second logo inside the inbox conversation list', () => {
    const list = read('./components/ConversationList.tsx')
    expect(list).not.toContain('crm-inbox-panel-brand')
    expect(list).not.toContain('brand/docmee-logo')
  })

  it('links home and names the link for assistive technology', () => {
    const component = read('./components/TopbarLogo.tsx')
    expect(component).toContain("href = '/inbox'")
    expect(component).toContain("aria-label={t('app.name')}")
    expect(component).toContain('alt=""')
  })

  it('sizes the logo by height and keeps it from shrinking', () => {
    expect(declarations('.crm-topbar-logo').flex).toBe('0 0 auto')
    const img = declarations('.crm-topbar-logo img')
    expect(img.height).toBe('44px')
    expect(img.width).toBe('auto')
  })

  it('uses a smaller logo on phones so the top bar controls still fit', () => {
    expect(declarations('.crm-topbar-logo img', true).height).toBe('32px')
  })
})
