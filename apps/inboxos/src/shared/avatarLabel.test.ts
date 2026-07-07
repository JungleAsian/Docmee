import { describe, expect, it } from 'vitest'
import { avatarLabel } from './format'

describe('avatarLabel', () => {
  it('takes the first letters of the first two words of a name', () => {
    expect(avatarLabel('Carlos Romero')).toBe('CR')
    expect(avatarLabel('José María Pérez')).toBe('JM')
  })

  it('handles social handles, dropping the @ and separators', () => {
    expect(avatarLabel('@ana.soler')).toBe('AS')
    expect(avatarLabel('diego.garcia')).toBe('DG')
  })

  it('falls back to the last two digits of a phone handle', () => {
    expect(avatarLabel('+34 612 04 88 21')).toBe('21')
  })

  it('returns a placeholder for empty input', () => {
    expect(avatarLabel('')).toBe('?')
    expect(avatarLabel(null)).toBe('?')
    expect(avatarLabel(undefined)).toBe('?')
  })
})
