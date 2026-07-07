import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// The dashboard's /api/* routes spawn daemons, run deploys, kill process trees,
// and rewrite .env — and they're unauthenticated. Two guards run on every
// request:
//   1. Tailscale identity gate — keeps the control plane private to the operator
//      even when exposed over a tailnet (`tailscale serve`).
//   2. CSRF same-origin check — blocks state-changing methods driven cross-site.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function middleware(request: NextRequest) {
  // 1) Tailscale identity gate — applies to EVERY route (pages + api).
  const denied = tailscaleGate(request)
  if (denied) return denied

  // 2) CSRF check, only for state-changing methods.
  if (!MUTATING_METHODS.has(request.method)) return NextResponse.next()

  const secFetchSite = request.headers.get('sec-fetch-site')
  // Modern browsers tag the request: same-origin / none are first-party; anything
  // else (cross-site, same-site) is a third-party context we reject.
  if (secFetchSite) {
    if (secFetchSite === 'same-origin' || secFetchSite === 'none') return NextResponse.next()
    return forbidden('Cross-site request blocked')
  }

  // No Sec-Fetch-Site: fall back to an Origin host check when present.
  const origin = request.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host === request.headers.get('host')) return NextResponse.next()
    } catch {
      // Malformed Origin → reject below.
    }
    return forbidden('Cross-site request blocked')
  }

  // Neither header → non-browser client (curl, internal tooling). Allow.
  return NextResponse.next()
}

// When the dashboard is exposed via `tailscale serve`, Tailscale injects an
// authoritative `Tailscale-User-Login` header identifying the tailnet user — a
// remote user cannot forge it (Serve overwrites any client-supplied value).
// Next.js binds to 127.0.0.1, so a request WITHOUT this header can only be local
// loopback (the operator on this machine) and is allowed. A request WITH the
// header must match DEVTOOLS_ALLOWED_TS_USERS, otherwise we fail closed. This
// keeps the command-running control plane private to the operator even inside
// their own tailnet. NOTE: this assumes Next stays bound to 127.0.0.1 — never
// run it on 0.0.0.0 (see the guarded dev:mobile script).
function tailscaleGate(request: NextRequest): NextResponse | null {
  const identity = request.headers.get('tailscale-user-login')?.toLowerCase().trim()
  if (!identity) return null

  const allow = (process.env.DEVTOOLS_ALLOWED_TS_USERS ?? '')
    .split(',')
    .map((entry) => entry.toLowerCase().trim())
    .filter(Boolean)
  if (allow.length > 0 && allow.includes(identity)) return null

  const message = allow.length === 0
    ? 'DevTools is exposed over Tailscale but no operator allowlist is configured. Add DEVTOOLS_ALLOWED_TS_USERS to tools/dashboard/.env.local and restart the dashboard.'
    : `Forbidden: ${identity} is not on the DevTools operator allowlist.`
  return forbidden(message)
}

function forbidden(message: string) {
  return new NextResponse(message, { status: 403 })
}

export const config = {
  // Every route except Next internals + static icon assets, so the identity gate
  // protects the pages too — not just /api.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|lineicons).*)'],
}
