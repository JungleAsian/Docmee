// PWA foundation guards (Req 23). These assert the installability contract that
// was previously broken — the manifest referenced icon files that did not exist,
// so the panel could never be installed. They keep the manifest, icons, offline
// page and service worker in sync.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public')

function readPublic(name: string): string {
  return readFileSync(join(PUBLIC_DIR, name), 'utf8')
}

describe('PWA manifest', () => {
  const manifest = JSON.parse(readPublic('manifest.json'))

  it('declares the installability fields', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
    expect(manifest.start_url).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toMatch(/^#/)
    expect(manifest.background_color).toMatch(/^#/)
  })

  it('references icon files that actually exist on disk', () => {
    expect(Array.isArray(manifest.icons)).toBe(true)
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      const path = join(PUBLIC_DIR, icon.src.replace(/^\//, ''))
      expect(existsSync(path), `${icon.src} must exist`).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(0)
    }
  })

  it('ships both 192 and 512 px icons and a maskable variant', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    const purposes = manifest.icons.map((i: { purpose?: string }) => i.purpose ?? 'any')
    expect(purposes.some((p: string) => p.includes('maskable'))).toBe(true)
  })

  it('ships an apple-touch-icon for iOS install', () => {
    expect(existsSync(join(PUBLIC_DIR, 'apple-touch-icon.png'))).toBe(true)
  })
})

describe('service worker', () => {
  const sw = readPublic('sw.js')

  it('precaches the offline fallback and icons', () => {
    expect(existsSync(join(PUBLIC_DIR, 'offline.html'))).toBe(true)
    expect(sw).toContain('/offline.html')
    expect(sw).toContain('/icon-192.png')
    expect(sw).toContain('/icon-512.png')
  })

  it('serves the offline page on a failed navigation', () => {
    expect(sw).toContain("request.mode === 'navigate'")
    expect(sw).toContain('OFFLINE_URL')
  })

  it('bumps the cache version so the new shell is picked up', () => {
    expect(sw).toMatch(/docmee-inbox-v\d+/)
  })

  it('handles push + notificationclick for mobile alerts (Req 39)', () => {
    expect(sw).toContain("addEventListener('push'")
    expect(sw).toContain('showNotification')
    expect(sw).toContain("addEventListener('notificationclick'")
    // Clicking an alert focuses an existing window or opens the panel.
    expect(sw).toContain('openWindow')
  })
})
