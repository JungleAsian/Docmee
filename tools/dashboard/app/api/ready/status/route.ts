import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

const readyFile = path.resolve(process.cwd(), '..', 'logs', 'ready.json')

export function GET() {
  if (!fs.existsSync(readyFile)) return NextResponse.json({ ready: false, critical: 1, warning: 0, pass: 0 })
  try {
    const data = JSON.parse(fs.readFileSync(readyFile, 'utf8')) as { ready?: boolean; summary?: { critical?: number; warning?: number; pass?: number } }
    return NextResponse.json({
      ready: Boolean(data.ready),
      critical: data.summary?.critical ?? 0,
      warning: data.summary?.warning ?? 0,
      pass: data.summary?.pass ?? 0
    })
  } catch {
    return NextResponse.json({ ready: false, critical: 1, warning: 0, pass: 0 })
  }
}

