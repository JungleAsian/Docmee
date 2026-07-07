import { NextResponse } from 'next/server'

// Simplest possible health route — no DB calls, no log reads, no external calls.
// If this returns 200, the dashboard process is alive and routing correctly.
// Sentinel's Beacon polls this; the DevTools Healer verifies recovery against it.
const startedAt = Date.now()

export const dynamic = 'force-dynamic'

export function GET() {
  return NextResponse.json(
    { status: 'ok', uptime: Math.round((Date.now() - startedAt) / 1000), version: process.env.APP_VERSION ?? '0.1.0' },
    { headers: { 'cache-control': 'no-store' } }
  )
}
