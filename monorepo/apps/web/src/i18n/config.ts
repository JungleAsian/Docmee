import { LOCALES, type Locale } from "@docmee/contracts";

/** Supported panel locales come from the contract (es default for Guatemala). */
export const locales = LOCALES;
export const defaultLocale: Locale = "es";

/** Cookie that carries the active panel locale (set from the session's `locale`). */
export const LOCALE_COOKIE = "docmee_locale";

export function isLocale(value: string | undefined): value is Locale {
  return value === "es" || value === "en";
}
