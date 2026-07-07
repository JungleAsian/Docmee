import { existsSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const form = await request.formData()
  const payload = form.get('payload') ?? 'text-message'
  const localAppData = process.env.LOCALAPPDATA
  const pnpmExe = process.platform === 'win32' && localAppData ? path.join(localAppData, 'pnpm', 'pnpm.exe') : 'pnpm'
  const command = process.platform === 'win32' && existsSync(pnpmExe) ? pnpmExe : process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'
  const result = spawnSync(command, ['tool', 'webhook', 'send', '--payload', String(payload)], {
    cwd: path.resolve(process.cwd(), '..'),
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  return NextResponse.json({
    ok: result.status === 0,
    payload,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  }, { status: result.status === 0 ? 200 : 500 })
}
