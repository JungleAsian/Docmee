/**
 * Auth token handling.
 *
 * Sprint-0 note: the contract v0 exposes only `GET /auth/session` (no credential
 * exchange yet), so "signing in" stores a bearer token client-side and the panel
 * resolves the session from it. When the real `/auth/login` lands, only
 * `signIn()` changes — the rest of the app already reads the token from here.
 */
export const TOKEN_COOKIE = "docmee_token";

/** Read the bearer token (browser only). */
export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string): void {
  if (typeof document === "undefined") return;
  // 8h session; Lax keeps it off cross-site requests. Secure in production.
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${8 * 60 * 60}; SameSite=Lax${secure}`;
}

export function clearToken(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}
