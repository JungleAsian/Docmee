import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Serves a Claude-generated HTML mockup so the devtool can render it in a
// sandboxed iframe for approval. Files live in tools/logs/mockups/screen-N.html.
const mockupsDir = path.resolve(process.cwd(), '..', 'logs', 'mockups')

export function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = Number(params.id)
  if (!Number.isInteger(id) || id < 0) {
    return new Response('Invalid mockup id', { status: 400 })
  }
  const file = path.join(mockupsDir, `screen-${id}.html`)
  if (!file.startsWith(mockupsDir) || !existsSync(file)) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#0f172a;color:#cbd5e1;padding:2rem">No mockup has been generated for this screen yet.</body>',
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
    )
  }
  return new Response(readFileSync(file, 'utf8'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}
