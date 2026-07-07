// Small presentation helpers shared across the inbox UI.
import type { PanelLanguage } from './types'

/** Compact relative time ("5m", "2h", "3d") with an absolute fallback. */
export function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000))
  if (diffSec < 60) return `${diffSec}s`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d`
  return new Date(iso).toLocaleDateString()
}

/**
 * Up to two uppercase initials for an avatar, derived from a contact handle or
 * patient name. A worded handle ("Carlos Romero", "@ana.soler") yields the first
 * letters of its first two word-parts ("CR", "AS"); a pure phone handle, which has
 * no letters, falls back to its last two digits ("21") so each contact still gets a
 * stable, distinguishable badge. Empty input yields "?".
 */
export function avatarLabel(handle: string | null | undefined): string {
  if (!handle) return '?'
  // Split on anything that isn't a letter/number; drop the leading @ etc.
  const parts = handle.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const lettered = parts.filter((p) => /\p{L}/u.test(p))
  if (lettered.length > 0) {
    return lettered
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('')
  }
  // No letters anywhere (a phone number) — use the last two digits.
  const digits = handle.replace(/\D/g, '')
  if (digits.length >= 2) return digits.slice(-2)
  if (digits.length === 1) return digits
  return '?'
}

/** Locale-aware date+time for detail views. */
export function formatDateTime(iso: string, language: PanelLanguage): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(language === 'es' ? 'es-ES' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

/** Just the clock time (HH:MM) for message bubbles. */
export function formatTime(iso: string, language: PanelLanguage): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(language === 'es' ? 'es-ES' : 'en-US', { timeStyle: 'short' })
}

/** A day label for the conversation's date separators (e.g. "Today · 20 Jun"). */
export function formatDay(iso: string, language: PanelLanguage, todayLabel: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const day = d.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
    day: 'numeric',
    month: 'short',
  })
  const isToday = d.toDateString() === new Date().toDateString()
  return isToday ? `${todayLabel} · ${day}` : day
}
