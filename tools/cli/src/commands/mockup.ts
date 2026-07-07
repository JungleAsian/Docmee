import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { Command } from 'commander'
import { PDFDocument } from 'pdf-lib'
import { log } from '../lib/logger.js'
import { toolsRoot, logsDir } from '../lib/paths.js'
import { claudeCodeCommand, claudeCodeEnvironment } from '../lib/claude-code.js'
import { logActivity } from '../lib/activity.js'

const libraryDir = path.join(toolsRoot, 'mockup-library')
const REPORT_NAME = 'UI-Design-Report.pdf'
const designRunFile = path.join(logsDir, 'design-run.json')
const mockupQueueFile = path.join(logsDir, 'mockup-queue.json')
const mockupBuildQueueFile = path.join(logsDir, 'mockup-build-queue.json')
const mockupsOutDir = path.join(logsDir, 'mockups')
const repoRoot = path.resolve(toolsRoot, '..')
const MOCKUP_TIMEOUT_MS = 8 * 60 * 1000

function readDesignRun(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(designRunFile, 'utf8')) as Record<string, unknown> } catch { return {} }
}
function touchDesignRun(partial: Record<string, unknown>) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(designRunFile, `${JSON.stringify({ ...readDesignRun(), ...partial, workflow: 'claude-design', heartbeatAt: new Date().toISOString() }, null, 2)}\n`)
}
function killTree(pid?: number) {
  if (!pid) return
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
    else process.kill(pid, 'SIGKILL')
  } catch { /* gone */ }
}

// Single headless Claude run for one mockup prompt (the prompt writes the file).
function runClaudeMockup(prompt: string, message: string): Promise<number> {
  return new Promise((resolve) => {
    let settled = false
    const child = spawn(claudeCodeCommand(), ['--print', '--dangerously-skip-permissions', '--add-dir', repoRoot], {
      cwd: repoRoot, env: claudeCodeEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    })
    const heartbeat = setInterval(() => touchDesignRun({ pid: process.pid, status: 'running', message }), 10000)
    const finish = (code: number) => { if (settled) return; settled = true; clearInterval(heartbeat); clearTimeout(timer); resolve(code) }
    const timer = setTimeout(() => { killTree(child.pid); finish(124) }, MOCKUP_TIMEOUT_MS)
    child.stdout.on('data', (chunk) => log('mockup', String(chunk).trim()))
    child.stderr.on('data', (chunk) => log('mockup', String(chunk).trim(), 'warn'))
    child.on('error', () => finish(1))
    child.on('close', (exit) => finish(exit ?? 1))
    child.stdin.end(prompt)
  })
}

// Headless Chrome/Edge is used to render the standalone mockup HTML to PDF, then
// pdf-lib merges the screens into one report. No browser download needed.
function findBrowser(): string | null {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH
  const pf = process.env.PROGRAMFILES || 'C:/Program Files'
  const pf86 = process.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)'
  const local = process.env.LOCALAPPDATA || ''
  const candidates = [
    path.join(pf, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf86, 'Google/Chrome/Application/chrome.exe'),
    local && path.join(local, 'Google/Chrome/Application/chrome.exe'),
    path.join(pf, 'Microsoft/Edge/Application/msedge.exe'),
    path.join(pf86, 'Microsoft/Edge/Application/msedge.exe')
  ].filter(Boolean) as string[]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null
}

function renderToPdf(browser: string, htmlPath: string, pdfPath: string): boolean {
  const result = spawnSync(browser, [
    '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
    `--print-to-pdf=${pdfPath}`, '--virtual-time-budget=5000',
    pathToFileURL(htmlPath).href
  ], { stdio: 'ignore', windowsHide: true, timeout: 90000 })
  return result.status === 0 && fs.existsSync(pdfPath)
}

// Print-friendly wrapper so each mockup fits the page and nothing is cut across
// page breaks: a wide page for desktop layouts, images constrained to the page
// width, and break-inside:avoid on media + common block/card containers so an
// image or card never straddles (overlaps) two pages.
function withPageSize(html: string): string {
  const style = [
    '<style>',
    '@page { size: 1280px 1810px; margin: 0 }',
    'html, body { margin: 0 !important; }',
    'img, svg, video, canvas, picture, iframe { max-width: 100% !important; height: auto; }',
    'img, svg, video, canvas, figure, picture, table, pre, blockquote,',
    '[class*="card"], [class*="panel"], [class*="tile"], [class*="box"], [class*="screen"], [class*="phone"], [class*="device"]',
    '  { break-inside: avoid !important; page-break-inside: avoid !important; }',
    'section, article, header, footer, li, tr { break-inside: avoid; page-break-inside: avoid; }',
    '</style>'
  ].join(' ')
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${style}</head>`) : style + html
}

function screenLabel(file: string): string {
  return file.replace(/\.html$/i, '').replace(/[_]+/g, ' · ').replace(/-/g, ' ')
}

function coverHtml(screens: string[], date: string): string {
  const items = screens.map((s) => `<li>${screenLabel(s)}</li>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:1280px 1810px;margin:0}body{font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:130px 120px;color:#0f172a}h1{font-size:58px;margin:0}p{color:#64748b;font-size:24px;margin-top:8px}ul{margin-top:48px;font-size:26px;line-height:2;color:#334155}.bar{height:6px;width:140px;background:#06b6d4;margin:28px 0}</style></head><body><h1>UI Design Report</h1><div class="bar"></div><p>Docmee &mdash; mockup screens (${screens.length}) &middot; ${date}</p><ul>${items}</ul></body></html>`
}

async function appendPdf(target: PDFDocument, pdfPath: string): Promise<void> {
  const src = await PDFDocument.load(fs.readFileSync(pdfPath))
  const pages = await target.copyPages(src, src.getPageIndices())
  pages.forEach((page) => target.addPage(page))
}

export const mockupCmd = new Command('mockup').description('Mockup library tools')

mockupCmd
  .command('report')
  .description('Export every mockup screen in the library to a single UI Design Report PDF (saved only in the library)')
  .action(async () => {
    const browser = findBrowser()
    if (!browser) { log('mockup', 'No Chrome/Edge found to render the PDF. Set CHROME_PATH.', 'error'); process.exitCode = 1; return }
    if (!fs.existsSync(libraryDir)) { log('mockup', `No mockup library at ${libraryDir}.`, 'error'); process.exitCode = 1; return }
    const screens = fs.readdirSync(libraryDir).filter((file) => file.toLowerCase().endsWith('.html')).sort()
    if (screens.length === 0) { log('mockup', 'No mockup screens (.html) in the library.', 'warn'); process.exitCode = 1; return }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-design-report-'))
    const report = await PDFDocument.create()
    const date = new Date().toISOString().slice(0, 10)

    // Cover page
    const coverHtmlPath = path.join(tmp, 'cover.html')
    const coverPdfPath = path.join(tmp, 'cover.pdf')
    fs.writeFileSync(coverHtmlPath, coverHtml(screens, date))
    if (renderToPdf(browser, coverHtmlPath, coverPdfPath)) await appendPdf(report, coverPdfPath)

    // Each screen
    let ok = 0
    for (const [index, screen] of screens.entries()) {
      const htmlPath = path.join(tmp, `screen-${index}.html`)
      const pdfPath = path.join(tmp, `screen-${index}.pdf`)
      fs.writeFileSync(htmlPath, withPageSize(fs.readFileSync(path.join(libraryDir, screen), 'utf8')))
      if (renderToPdf(browser, htmlPath, pdfPath)) { await appendPdf(report, pdfPath); ok += 1 }
      else log('mockup', `Failed to render ${screen}.`, 'warn')
    }

    if (report.getPageCount() === 0) { log('mockup', 'Nothing rendered — no report written.', 'error'); process.exitCode = 1; return }
    report.setTitle('UI Design Report')
    report.setSubject('Docmee mockup screens')
    const out = path.join(libraryDir, REPORT_NAME)
    fs.writeFileSync(out, await report.save())
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore temp cleanup */ }

    log('mockup', `UI Design Report saved to library: ${out} (${ok}/${screens.length} screens, ${report.getPageCount()} pages).`)
    logActivity({ actor: 'user', event: 'mockup.report', severity: 'success', source: 'ui', message: `UI Design Report exported — ${ok}/${screens.length} screen(s) → library.` })
  })

mockupCmd
  .command('generate-all')
  .description('Sequentially generate every queued mockup screen (queue written by the dashboard)')
  .action(async () => {
    let queue: Array<{ id: number; prompt: string }> = []
    try { queue = JSON.parse(fs.readFileSync(mockupQueueFile, 'utf8')) } catch { queue = [] }
    if (!Array.isArray(queue) || queue.length === 0) {
      touchDesignRun({ status: 'complete', message: 'No mockups queued.' })
      log('mockup', 'No mockups queued.', 'warn')
      return
    }
    const total = queue.length
    let generated = 0
    let failed = 0
    touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), total, processed: 0, message: `Generating ${total} mockup(s)…` })
    logActivity({ actor: 'claude', event: 'mockup.generate-all.start', severity: 'info', source: 'ui', message: `Generating ${total} mockup screen(s) sequentially.` })
    for (const [index, item] of queue.entries()) {
      const state = readDesignRun()
      if (state.status === 'stopped' || state.status === 'stopping') { log('mockup', 'Stopped by user.', 'warn'); break }
      touchDesignRun({ status: 'running', total, processed: index, currentId: item.id, message: `(${index + 1}/${total}) Generating mockup for screen #${item.id}…` })
      const code = await runClaudeMockup(item.prompt, `Mockup screen #${item.id} (${index + 1}/${total})`)
      const wrote = fs.existsSync(path.join(mockupsOutDir, `screen-${item.id}.html`))
      if (code === 0 && wrote) generated += 1
      else { failed += 1; log('mockup', `Screen #${item.id} mockup not generated (exit ${code}).`, 'warn') }
    }
    touchDesignRun({ status: 'complete', total, processed: total, currentId: null, message: `Mockups done: ${generated} generated, ${failed} failed.` })
    logActivity({ actor: 'claude', event: 'mockup.generate-all.done', severity: failed ? 'warn' : 'success', source: 'ui', message: `Mockup generation finished — ${generated}/${total} generated${failed ? `, ${failed} failed` : ''}.` })
    try { fs.unlinkSync(mockupQueueFile) } catch { /* ignore */ }
    log('mockup', `Mockup generation complete: ${generated}/${total} generated, ${failed} failed.`)
  })

mockupCmd
  .command('build-all')
  .description('Sequentially build every queued approved screen from its mockup (queue written by the dashboard)')
  .action(async () => {
    let queue: Array<{ id: number; prompt: string }> = []
    try { queue = JSON.parse(fs.readFileSync(mockupBuildQueueFile, 'utf8')) } catch { queue = [] }
    if (!Array.isArray(queue) || queue.length === 0) {
      touchDesignRun({ status: 'complete', message: 'No approved screens queued to build.' })
      log('mockup', 'No approved screens queued to build.', 'warn')
      return
    }
    const total = queue.length
    let built = 0
    let failed = 0
    touchDesignRun({ pid: process.pid, status: 'running', startedAt: new Date().toISOString(), total, processed: 0, message: `Building ${total} approved screen(s)…` })
    logActivity({ actor: 'claude', event: 'mockup.build-all.start', severity: 'info', source: 'ui', message: `Building ${total} approved screen(s) sequentially.` })
    for (const [index, item] of queue.entries()) {
      const state = readDesignRun()
      if (state.status === 'stopped' || state.status === 'stopping') { log('mockup', 'Stopped by user.', 'warn'); break }
      touchDesignRun({ status: 'running', total, processed: index, currentId: item.id, message: `(${index + 1}/${total}) Building screen #${item.id} from its mockup…` })
      const code = await runClaudeMockup(item.prompt, `Build screen #${item.id} (${index + 1}/${total})`)
      if (code === 0) built += 1
      else { failed += 1; log('mockup', `Screen #${item.id} build failed (exit ${code}).`, 'warn') }
    }
    touchDesignRun({ status: 'complete', total, processed: total, currentId: null, message: `Build done: ${built} built, ${failed} failed.` })
    logActivity({ actor: 'claude', event: 'mockup.build-all.done', severity: failed ? 'warn' : 'success', source: 'ui', message: `Approve & build finished — ${built}/${total} built${failed ? `, ${failed} failed` : ''}.` })
    try { fs.unlinkSync(mockupBuildQueueFile) } catch { /* ignore */ }
    log('mockup', `Approve & build complete: ${built}/${total} built, ${failed} failed.`)
  })

mockupCmd
  .command('stop')
  .description('Stop a running bulk mockup generation and clear its state')
  .action(() => {
    const state = readDesignRun()
    killTree(typeof state.pid === 'number' ? state.pid : undefined)
    fs.writeFileSync(designRunFile, `${JSON.stringify({ status: 'stopped', pid: 0, message: 'Mockup run stopped by user.', heartbeatAt: new Date().toISOString(), workflow: 'claude-design' }, null, 2)}\n`)
    try { fs.unlinkSync(mockupQueueFile) } catch { /* ignore */ }
    try { fs.unlinkSync(mockupBuildQueueFile) } catch { /* ignore */ }
    log('mockup', 'Bulk mockup run stopped.')
  })
