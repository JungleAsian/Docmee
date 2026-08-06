import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

const ASSETS: Record<string, string> = {
  bowing: 'docmee-mascot-bowing.png',
  'clipboard-pose': 'docmee-mascot-clipboard-pose.png',
  clipboard: 'docmee-mascot-clipboard.png',
  confused: 'docmee-mascot-confused.png',
  'crossed-arms': 'docmee-mascot-crossed-arms.png',
  'first-aid': 'docmee-mascot-first-aid.png',
  heart: 'docmee-mascot-heart.png',
  idea: 'docmee-mascot-idea.png',
  laptop: 'docmee-mascot-laptop.png',
  pill: 'docmee-mascot-pill.png',
  syringe: 'docmee-mascot-syringe.png',
  'thumbs-up-pose': 'docmee-mascot-thumbs-up-pose.png',
  'thumbs-up': 'docmee-mascot-thumbs-up.png',
  'waving-pose': 'docmee-mascot-waving-pose.png',
  waving: 'docmee-mascot-waving.png',
  'phone-dark': 'docmee-mascot-phone-dark.png',
  'wordmark-wide': 'docmee-mascot-wordmark-wide.png',
  'wordmark-tools': 'docmee-mascot-wordmark-tools.png',
  hologram: 'docmee-mascot-hologram.png',
  'login-hologram': 'docmee-mascot-login-hologram.png',
  'kb-crossed-arms': 'docmee-mascot-kb-crossed-arms.png',
  analytics: 'docmee-mascot-analytics.png',
}

export const dynamic = 'force-static'

export async function GET(_request: Request, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params
  const file = ASSETS[asset]
  if (!file) return new NextResponse('Not found', { status: 404 })

  const candidates = [
    path.join(process.cwd(), 'apps', 'inboxos', 'public', 'brand', 'page-banners', file),
    path.join(process.cwd(), 'public', 'brand', 'page-banners', file),
  ]

  let bytes: Uint8Array | null = null
  for (const fullPath of candidates) {
    try {
      bytes = await readFile(fullPath)
      break
    } catch {
      // Try the next runtime path. The standalone server runs from the monorepo root.
    }
  }

  if (!bytes) return new NextResponse('Not found', { status: 404 })

  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new NextResponse(body, {
    headers: {
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type': 'image/png',
    },
  })
}
