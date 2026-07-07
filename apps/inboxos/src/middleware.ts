import { NextResponse, type NextRequest } from 'next/server'

const PROTECTED_PREFIXES = [
  '/alerts',
  '/analytics',
  '/calendar',
  '/help',
  '/inbox',
  '/metrics',
  '/qos',
  '/reports',
  '/studio',
]

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
  if (!isProtected) return NextResponse.next()

  const hasSessionMarker = request.cookies.get('docmee-session')?.value === '1'
  if (hasSessionMarker) return NextResponse.next()

  const forwardedProto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(/:$/, '')
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host
  const loginUrl = new URL('/login', `${forwardedProto}://${forwardedHost}`)
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/alerts/:path*',
    '/analytics/:path*',
    '/calendar/:path*',
    '/help/:path*',
    '/inbox/:path*',
    '/metrics/:path*',
    '/qos/:path*',
    '/reports/:path*',
    '/studio/:path*',
  ],
}
