import { describe, expect, it } from 'vitest'
import { changeHeaderPanel } from './headerPanels'

describe('exclusive header panels', () => {
  it('opening either panel replaces the other, including automatic updates', () => {
    expect(changeHeaderPanel('customize', 'updates', true)).toBe('updates')
    expect(changeHeaderPanel('updates', 'customize', true)).toBe('customize')
  })
  it('a late outside-dismiss from the previous panel cannot close the new one', () => {
    expect(changeHeaderPanel('customize', 'updates', false)).toBe('customize')
    expect(changeHeaderPanel('updates', 'customize', false)).toBe('updates')
    expect(changeHeaderPanel('updates', 'updates', false)).toBeNull()
  })
})
