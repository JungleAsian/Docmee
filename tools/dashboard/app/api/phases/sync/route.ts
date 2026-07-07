import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { NextResponse } from 'next/server'

const toolsRoot = path.resolve(process.cwd(), '..')

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const localAppData = process.env.LOCALAPPDATA
  const pnpmExe = localAppData ? path.join(localAppData, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

function redirect(request: Request, key: 'message' | 'error', value: string) {
  const referer = request.headers.get('referer') ?? 'http://127.0.0.1:4000/phases'
  const url = new URL(referer)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url, 303)
}

export async function POST(request: Request) {
  const result = spawnSync(pnpmCommand(), ['tool', 'phase', 'sync'], {
    cwd: toolsRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return redirect(
    request,
    result.status === 0 ? 'message' : 'error',
    result.status === 0 ? 'Phase prompts synced from Notion' : output || 'Phase prompt sync failed'
  )
}
