import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { NextResponse } from 'next/server'
import { getUsdToCad } from '../../../lib/currency'

const toolsRoot = path.resolve(process.cwd(), '..')
const envFile = path.join(toolsRoot, '.env.tools')
const envExampleFile = path.join(toolsRoot, '.env.tools.example')
const backlogFile = path.join(toolsRoot, 'logs', 'backlog.json')

function settingsRedirect(request: Request, key: 'message' | 'error', value: string, pathname = '/settings') {
  const safePath = pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/settings'
  const url = new URL(safePath, 'http://127.0.0.1:4000')
  url.searchParams.set(key, value)
  return NextResponse.redirect(url, 303)
}

function openEnvFile() {
  if (process.platform === 'win32') {
    spawn('notepad.exe', [envFile], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  if (process.platform === 'darwin') {
    spawn('open', [envFile], { detached: true, stdio: 'ignore' }).unref()
    return
  }
  spawn('xdg-open', [envFile], { detached: true, stdio: 'ignore' }).unref()
}

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const localAppData = process.env.LOCALAPPDATA
  const pnpmExe = localAppData ? path.join(localAppData, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

function runTool(args: string[]) {
  const result = spawnSync(pnpmCommand(), ['tool', ...args], {
    cwd: toolsRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  return result.status === 0
}

function runScript(script: string) {
  const result = spawnSync(pnpmCommand(), [script], {
    cwd: toolsRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    windowsHide: true
  })
  return result.status === 0
}

void runScript

function backlogCount() {
  if (!existsSync(backlogFile)) return 0
  try {
    const backlog = JSON.parse(readFileSync(backlogFile, 'utf8')) as unknown
    return Array.isArray(backlog) ? backlog.length : 0
  } catch {
    return 0
  }
}

function parseEnv(content: string) {
  return Object.fromEntries(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=')
        return [line.slice(0, index), line.slice(index + 1)]
      })
  )
}

function readEnvContent() {
  return existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
}

function upsertEnvValues(values: Record<string, string>) {
  const content = readEnvContent()
  const lines = content ? content.split(/\r?\n/) : []
  const seen = new Set<string>()
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/)
    if (!match) return line
    const name = match[1]
    if (!(name in values)) return line
    seen.add(name)
    return `${name}=${values[name]}`
  })
  for (const [name, value] of Object.entries(values)) {
    if (!seen.has(name)) next.push(`${name}=${value}`)
  }
  writeFileSync(envFile, `${next.join('\n').replace(/\n*$/, '')}\n`)
}

function setupStatus() {
  const required = [
    'TOOLS_DB_URL',
    'TOOLS_DB_SERVICE_KEY',
    'MONOREPO_ROOT',
    'NEXT_PUBLIC_DASHBOARD_PORT',
    'WEBHOOK_TARGET',
    'DEV_LICENSE_SIGNING_KEY'
  ]
  const env = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
  const missing = required.filter((name) => !env[name])
  const issues = [
    existsSync(envFile) ? '' : '.env.tools',
    missing.length === 0 ? '' : `required settings (${missing.join(', ')})`,
    backlogCount() >= 45 ? '' : 'backlog'
  ].filter(Boolean)
  return { ok: issues.length === 0, issues }
}

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''
  const isFormPost = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')
  const body = isFormPost
    ? Object.fromEntries(await request.formData()) as { action?: string }
    : await request.json().catch(() => ({})) as { action?: string }

  if (body.action === 'create') {
    if (existsSync(envFile)) {
      return isFormPost
        ? settingsRedirect(request, 'message', '.env.tools already exists')
        : NextResponse.json({ message: '.env.tools already exists' })
    }
    if (!existsSync(envExampleFile)) {
      return isFormPost
        ? settingsRedirect(request, 'error', '.env.tools.example was not found')
        : NextResponse.json({ error: '.env.tools.example was not found' }, { status: 404 })
    }
    copyFileSync(envExampleFile, envFile)
    return isFormPost
      ? settingsRedirect(request, 'message', 'Created .env.tools from the example file')
      : NextResponse.json({ message: 'Created .env.tools from the example file' })
  }

  if (body.action === 'auto-setup') {
    const setupOk = runTool(['setup'])
    const backlogOk = backlogCount() >= 45
    runTool(['agents', 'reset'])
    const status = setupStatus()
    const ok = setupOk && backlogOk && status.issues.filter((issue) => issue !== 'backlog').length === 0
    const message = ok
      ? 'Local setup is ready. Add service keys only when you want Discord, Notion, AI, Meta, or VPS features.'
      : `Local setup prepared, but still needs: ${status.issues.join(', ')}`
    return isFormPost
      ? settingsRedirect(request, ok ? 'message' : 'error', message)
      : NextResponse.json(ok ? { message } : { error: message }, { status: ok ? 200 : 500 })
  }

  if (body.action === 'open') {
    if (!existsSync(envFile)) {
      return isFormPost
        ? settingsRedirect(request, 'error', '.env.tools has not been created yet')
        : NextResponse.json({ error: '.env.tools has not been created yet' }, { status: 404 })
    }
    openEnvFile()
    return isFormPost
      ? settingsRedirect(request, 'message', 'Opened .env.tools in your local editor')
      : NextResponse.json({ message: 'Opened .env.tools in your local editor' })
  }

  if (body.action === 'seed-backlog') {
    const ok = runTool(['backlog', 'init'])
    return isFormPost
      ? settingsRedirect(request, ok ? 'message' : 'error', ok ? 'Seeded the local DevTools backlog' : 'Backlog seed failed')
      : NextResponse.json(ok ? { message: 'Seeded the local DevTools backlog' } : { error: 'Backlog seed failed' }, { status: ok ? 200 : 500 })
  }

  if (body.action === 'check') {
    const status = setupStatus()
    const message = status.ok ? 'Setup check passed' : `Setup needs attention: ${status.issues.join(', ')}`
    return isFormPost
      ? settingsRedirect(request, status.ok ? 'message' : 'error', message)
      : NextResponse.json(status.ok ? { message } : { error: message }, { status: status.ok ? 200 : 500 })
  }

  if (body.action === 'public-url-switch') {
    if (!existsSync(envFile)) {
      return isFormPost
        ? settingsRedirect(request, 'error', '.env.tools has not been created yet')
        : NextResponse.json({ error: '.env.tools has not been created yet' }, { status: 404 })
    }
    const mode = String((body as Record<string, unknown>).mode ?? '').trim()
    const ngrokUrl = String((body as Record<string, unknown>).ngrokUrl ?? '').trim().replace(/\/$/, '')
    const domainUrl = String((body as Record<string, unknown>).domainUrl ?? '').trim().replace(/\/$/, '')
    const selectedUrl = mode === 'ngrok' ? ngrokUrl : mode === 'domain' ? domainUrl : ''
    if (!['ngrok', 'domain'].includes(mode)) {
      return isFormPost
        ? settingsRedirect(request, 'error', 'Choose ngrok or permanent domain')
        : NextResponse.json({ error: 'Choose ngrok or permanent domain' }, { status: 400 })
    }
    if (!/^https?:\/\/[^/\s]+/i.test(selectedUrl)) {
      return isFormPost
        ? settingsRedirect(request, 'error', 'Enter a valid public URL that starts with http:// or https://')
        : NextResponse.json({ error: 'Enter a valid public URL that starts with http:// or https://' }, { status: 400 })
    }
    upsertEnvValues({
      PUBLIC_URL_MODE: mode,
      NGROK_URL: ngrokUrl,
      PERMANENT_DOMAIN_URL: domainUrl,
      APP_URL: selectedUrl
    })
    const label = mode === 'ngrok' ? 'ngrok temporary URL' : 'permanent domain'
    return isFormPost
      ? settingsRedirect(request, 'message', `APP_URL now uses the ${label}`)
      : NextResponse.json({ message: `APP_URL now uses the ${label}` })
  }

  if (body.action === 'cost-currency') {
    if (!existsSync(envFile)) {
      return isFormPost
        ? settingsRedirect(request, 'error', '.env.tools has not been created yet')
        : NextResponse.json({ error: '.env.tools has not been created yet' }, { status: 404 })
    }
    const currency = String((body as Record<string, unknown>).currency ?? '').trim().toLowerCase()
    if (!['usd', 'cad', 'gtq'].includes(currency)) {
      return isFormPost
        ? settingsRedirect(request, 'error', 'Choose USD, CAD, or GTQ')
        : NextResponse.json({ error: 'Choose USD, CAD, or GTQ' }, { status: 400 })
    }
    upsertEnvValues({ COST_DISPLAY_CURRENCY: currency })
    const label = currency.toUpperCase()
    const returnTo = String((body as Record<string, unknown>).returnTo ?? '/settings')
    return isFormPost
      ? settingsRedirect(request, 'message', `Cost display now uses ${label}`, returnTo)
      : NextResponse.json({ message: `Cost display now uses ${label}` })
  }

  if (body.action === 'refresh-exchange-rate') {
    const exchange = await getUsdToCad(true)
    return isFormPost
      ? settingsRedirect(request, 'message', `Exchange rate refreshed: 1 USD = ${exchange.rates.CAD.toFixed(4)} CAD / ${exchange.rates.GTQ.toFixed(4)} GTQ`)
      : NextResponse.json({ message: `Exchange rate refreshed`, exchange })
  }

  return isFormPost
    ? settingsRedirect(request, 'error', 'Unknown settings action')
    : NextResponse.json({ error: 'Unknown settings action' }, { status: 400 })
}
