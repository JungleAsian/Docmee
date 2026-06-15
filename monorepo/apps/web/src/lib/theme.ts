/**
 * Theme handling. The active theme is stored in a cookie so the server can set
 * `<html class="dark">` on first paint (no flash), and the client toggle flips
 * the live class + cookie together.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "docmee_theme";

export function isTheme(value: string | undefined): value is Theme {
  return value === "light" || value === "dark";
}

/** Read the current theme from the live <html> class (browser only). */
export function getActiveTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Apply a theme to <html> and persist it (browser only). */
export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax${secure}`;
}
