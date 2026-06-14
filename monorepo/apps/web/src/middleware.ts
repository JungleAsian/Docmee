import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_COOKIE } from "./lib/auth";

const PUBLIC_PATHS = ["/login"];

/**
 * Route guard: unauthenticated users are sent to /login; authenticated users
 * never see /login. Token presence only — the panel still resolves the real
 * session via GET /auth/session.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasToken = Boolean(request.cookies.get(TOKEN_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasToken && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (hasToken && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals, the MSW worker, and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|mockServiceWorker.js).*)"],
};
