import type { Locale } from "@docmee/contracts";
import { LOCALE_COOKIE } from "../i18n/config";

/** Persist the chosen panel locale (browser only). next-intl reads this cookie. */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${365 * 24 * 60 * 60}; SameSite=Lax`;
}
