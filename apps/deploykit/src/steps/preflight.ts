import { statfs } from 'node:fs/promises'

export interface PreflightCheck {
  name: string
  ok: boolean
  detail: string
}

export interface PreflightResult {
  ok: boolean
  checks: PreflightCheck[]
}

const MIN_NODE_MAJOR = 20
const MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB headroom for deps + release

function checkNode(): PreflightCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10)
  const ok = major >= MIN_NODE_MAJOR
  return {
    name: 'Node.js 20+',
    ok,
    detail: ok ? `Node ${process.versions.node}` : `Node ${process.versions.node} found, need ${MIN_NODE_MAJOR}+`,
  }
}

async function checkDiskSpace(targetDir: string): Promise<PreflightCheck> {
  try {
    const stats = await statfs(targetDir)
    const free = stats.bsize * stats.bavail
    const ok = free >= MIN_FREE_BYTES
    const freeGb = (free / 1024 / 1024 / 1024).toFixed(1)
    return {
      name: 'Disk space',
      ok,
      detail: ok ? `${freeGb} GB free` : `${freeGb} GB free, need 2 GB`,
    }
  } catch (error) {
    return { name: 'Disk space', ok: false, detail: `Could not read disk usage: ${describe(error)}` }
  }
}

async function checkInternet(): Promise<PreflightCheck> {
  try {
    const res = await fetch('https://api.github.com', { method: 'HEAD' })
    const ok = res.ok || res.status === 403 // 403 (rate limited) still proves connectivity
    return { name: 'Internet connectivity', ok, detail: ok ? 'Reached api.github.com' : `Unexpected status ${res.status}` }
  } catch (error) {
    return { name: 'Internet connectivity', ok: false, detail: `No connection: ${describe(error)}` }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Verify the machine can host Docmee before we touch anything: Node 20+, enough
 * disk for the release and dependencies, and outbound internet to GitHub.
 */
export async function preflight(targetDir: string = process.cwd()): Promise<PreflightResult> {
  const checks = [checkNode(), await checkDiskSpace(targetDir), await checkInternet()]
  return { ok: checks.every((check) => check.ok), checks }
}
