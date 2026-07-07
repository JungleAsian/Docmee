import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Serves a saved reference mockup from tools/mockup-library/ for viewing.
const libraryDir = path.resolve(process.cwd(), '..', 'mockup-library')

export function GET(_request: Request, { params }: { params: { name: string } }) {
  // basename() strips any path segments, blocking traversal.
  const name = path.basename(params.name)
  const isHtml = name.endsWith('.html')
  const isPdf = name.endsWith('.pdf')
  if (!isHtml && !isPdf) return new Response('Invalid file', { status: 400 })
  const file = path.join(libraryDir, name)
  if (!file.startsWith(libraryDir) || !existsSync(file)) {
    return new Response('Mockup not found', { status: 404 })
  }
  if (isPdf) {
    return new Response(readFileSync(file), {
      headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${name}"`, 'cache-control': 'no-store' }
    })
  }
  return new Response(readFileSync(file, 'utf8'), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  })
}
